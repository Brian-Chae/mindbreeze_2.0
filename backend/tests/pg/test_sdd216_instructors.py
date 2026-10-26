"""V-16/17: 멤버십·마지막 주강사·향후 담당 회차 보호."""

import importlib.util
from datetime import datetime, timezone
import pytest
from fastapi import HTTPException
from app.models.class_program import ClassInstructor
from app.models.session import Session
from tests.pg.sdd216_helpers import world, user

pytestmark = pytest.mark.pg


def service():
    assert importlib.util.find_spec(
        "app.services.class_instructor_service"
    ), "강사 규칙이 필요합니다"
    from app.services import class_instructor_service

    return class_instructor_service


def test_add_duplicate_remove_restore_and_last_lead(pg_session):
    rules = service()
    org, a, b, parent = world(pg_session)
    first = rules.add_instructor(pg_session, parent, b.id, "assistant", a.id)
    second = rules.add_instructor(pg_session, parent, b.id, "assistant", a.id)
    assert first.id == second.id
    with pytest.raises(HTTPException) as raised:
        rules.remove_instructor(pg_session, parent, a.id)
    assert raised.value.status_code == 409
    rules.remove_instructor(pg_session, parent, b.id)
    assert first.status == "removed"
    assert (
        rules.add_instructor(pg_session, parent, b.id, "assistant", a.id).id == first.id
    )
    outsider = user(pg_session)
    with pytest.raises(HTTPException) as raised:
        rules.add_instructor(pg_session, parent, outsider.id, "assistant", a.id)
    assert raised.value.status_code == 409


def test_assigned_future_instructor_cannot_be_removed(pg_session):
    rules = service()
    org, a, b, parent = world(pg_session)
    rules.add_instructor(pg_session, parent, b.id, "assistant", a.id)
    pg_session.add(
        Session(
            type="meditation",
            host_id=b.id,
            class_id=parent.id,
            seq=1,
            status="scheduled",
            host_state="assigned",
            duration_min=60,
            scheduled_at=datetime(2026, 11, 2, 10, tzinfo=timezone.utc),
        )
    )
    pg_session.flush()
    with pytest.raises(HTTPException) as raised:
        rules.remove_instructor(pg_session, parent, b.id)
    assert raised.value.status_code == 409
    assert rules.validate_instructor(pg_session, parent, b.id).status == "active"
    b.status = "suspended"
    pg_session.flush()
    with pytest.raises(HTTPException) as raised:
        rules.validate_instructor(pg_session, parent, b.id)
    assert raised.value.status_code == 409


@pytest.mark.parametrize(
    "minutes,status",
    [(61, "accepted"), (60, "pending_ack"), (15, "error"), (14, "error")],
)
def test_host_change_time_boundaries(pg_session, minutes, status):
    from datetime import timedelta

    rules = service()
    org, a, b, parent = world(pg_session)
    rules.add_instructor(pg_session, parent, b.id, "assistant", a.id)
    now = datetime(2026, 11, 2, 10, tzinfo=timezone.utc)
    row = Session(
        type="meditation",
        host_id=a.id,
        class_id=parent.id,
        seq=1,
        status="scheduled",
        host_state="assigned",
        duration_min=60,
        scheduled_at=now + timedelta(minutes=minutes),
    )
    pg_session.add(row)
    pg_session.flush()
    assert hasattr(rules, "apply_host_request"), "진행자 변경 시점 규칙이 필요합니다"
    command = {
        "candidate_host_id": b.id,
        "request_kind": "change",
        "expected_state_version": row.state_version,
        "reason": "교체",
    }
    if status == "error":
        with pytest.raises(HTTPException) as raised:
            rules.apply_host_request(pg_session, parent, row, command, a, now)
        assert raised.value.status_code == 409
    else:
        request = rules.apply_host_request(pg_session, parent, row, command, a, now)
        assert request.status == status
        assert row.host_id == (b.id if status == "accepted" else a.id)
        if status == "pending_ack":
            with pytest.raises(HTTPException) as raised:
                rules.resolve_host_request(
                    pg_session, parent, row, request, "accept", a, now
                )
            assert raised.value.status_code == 403
            rules.resolve_host_request(
                pg_session, parent, row, request, "accept", b, now
            )
            assert row.host_id == b.id and row.host_state == "assigned"


def test_needs_reassign_keeps_host_parent_and_past_visible(pg_session):
    rules = service()
    org, a, b, parent = world(pg_session)
    assert hasattr(
        rules, "mark_needs_reassign"
    ), "계정 비활성화 재배정 전환이 필요합니다"
    rows = []
    for i, status in enumerate(
        ["ready", "scheduled", "open", "in_progress", "completed", "cancelled"]
    ):
        row = Session(
            type="meditation",
            host_id=a.id,
            class_id=parent.id,
            seq=i + 1,
            status=status,
            host_state="assigned",
            duration_min=60,
        )
        pg_session.add(row)
        rows.append(row)
    pg_session.flush()
    now = datetime.now(timezone.utc)
    changed = rules.mark_needs_reassign(pg_session, a.id, None, now)
    assert len(changed) == 2
    assert [r.host_state for r in rows] == [
        "needs_reassign",
        "needs_reassign",
        "assigned",
        "assigned",
        "assigned",
        "assigned",
    ]
    assert all(r.host_id == a.id and r.hidden_at is None for r in rows)
    assert parent.hidden_at is None
    assert rules.mark_needs_reassign(pg_session, a.id, None, now) == []


def test_guest_downgrade_cannot_strand_another_live_session(pg_session):
    from tests.pg.test_sdd216_review_regressions import setup_class
    from app.services.class_instructor_service import add_instructor
    from fastapi import HTTPException

    a, b, cls, rows = setup_class(pg_session)
    rows[1].host_id = b.id
    rows[1].status = "in_progress"
    pg_session.flush()
    with pytest.raises(HTTPException) as exc:
        add_instructor(pg_session, cls, b.id, "guest", a.id, rows[0].id)
    assert exc.value.status_code == 409


def test_acknowledgement_can_confirm_fresh_conflict(pg_session):
    from tests.pg.test_sdd216_review_regressions import setup_class
    from tests.pg.test_sdd216_write import NOW
    from app.services.class_instructor_service import (
        apply_host_request,
        resolve_host_request,
    )
    from datetime import timedelta

    a, b, cls, rows = setup_class(pg_session)
    row = rows[0]
    row.scheduled_at = NOW + timedelta(minutes=30)
    req = apply_host_request(
        pg_session,
        cls,
        row,
        {"candidate_host_id": b.id, "expected_state_version": row.state_version},
        a,
        NOW,
    )
    rows[1].scheduled_at = row.scheduled_at
    rows[1].host_id = b.id
    pg_session.flush()
    with pytest.raises(HTTPException) as exc:
        resolve_host_request(pg_session, cls, row, req, "accept", b, NOW)
    fingerprint = exc.value.detail["conflict_fingerprint"]
    resolve_host_request(
        pg_session, cls, row, req, "accept", b, NOW, force=True, fingerprint=fingerprint
    )
    assert row.host_id == b.id and req.status == "accepted"
