"""지난 기수 복제·보강·클래스 수명."""

from datetime import datetime, timezone
from uuid import uuid4
import pytest
from fastapi import HTTPException
from app.models.class_program import Class
from app.models.session import Session
from tests.pg.sdd216_helpers import world
from tests.pg.test_sdd216_write import command, NOW, writer

pytestmark = pytest.mark.pg


def test_duplicate_pattern_and_makeup_do_not_change_regular_count(pg_session):
    service = writer()
    org, a, b, parent = world(pg_session)
    assert hasattr(service, "duplicate_class"), "지난 기수 패턴 복제가 필요합니다"
    result = service.create_class(pg_session, a.id, command(a), now=NOW)
    dup = service.duplicate_class(
        pg_session,
        a.id,
        result["class_id"],
        {"operation_key": str(uuid4()), "start_date": "2027-01-04"},
        now=NOW,
    )
    copy = pg_session.query(Class).filter(Class.id == dup["class_id"]).one()
    assert (
        copy.status == "draft"
        and copy.access_code is None
        and copy.recurrence_rule["start_date"] == "2027-01-04"
    )
    assert dup["session_ids"] == []
    assert hasattr(service, "add_session"), "보강 추가가 필요합니다"
    first = (
        pg_session.query(Session)
        .filter(Session.class_id == result["class_id"], Session.seq == 1)
        .one()
    )
    first.status = "cancelled"
    pg_session.commit()
    data = {
        "operation_key": str(uuid4()),
        "expected_revision": 1,
        "makeup_for_session_id": str(first.id),
        "member_ids": [],
        "row": {
            "client_key": "makeup",
            "seq": 9,
            "scheduled_at": "2026-12-24T10:00:00Z",
            "host_id": str(a.id),
            "session_kind": "makeup",
        },
    }
    added = service.add_session(pg_session, a.id, result["class_id"], data, now=NOW)
    assert (
        pg_session.query(Class)
        .filter(Class.id == result["class_id"])
        .one()
        .planned_session_count
        == 8
    )
    assert (
        pg_session.query(Session)
        .filter(Session.id == added["session_ids"][0])
        .one()
        .session_kind
        == "makeup"
    )


def test_cancel_archive_restore_preserves_cancelled_and_rejects_open(pg_session):
    service = writer()
    org, a, b, parent = world(pg_session)
    assert hasattr(service, "transition_class"), "클래스 상태 전이가 필요합니다"
    result = service.create_class(pg_session, a.id, command(a), now=NOW)
    first = (
        pg_session.query(Session)
        .filter(Session.class_id == result["class_id"], Session.seq == 1)
        .one()
    )
    first.status = "open"
    pg_session.commit()
    data = {"operation_key": str(uuid4()), "expected_revision": 1, "action": "cancel"}
    with pytest.raises(HTTPException) as raised:
        service.transition_class(pg_session, a.id, result["class_id"], data, now=NOW)
    assert raised.value.status_code == 409
    first = (
        pg_session.query(Session)
        .filter(Session.class_id == result["class_id"], Session.seq == 1)
        .one()
    )
    first.status = "scheduled"
    pg_session.commit()
    result = service.transition_class(
        pg_session, a.id, result["class_id"], data, now=NOW
    )
    assert result["status"] == "cancelled"
    result = service.transition_class(
        pg_session,
        a.id,
        result["class_id"],
        {
            "operation_key": str(uuid4()),
            "expected_revision": result["revision"],
            "action": "archive",
        },
        now=NOW,
    )
    result = service.transition_class(
        pg_session,
        a.id,
        result["class_id"],
        {
            "operation_key": str(uuid4()),
            "expected_revision": result["revision"],
            "action": "restore",
        },
        now=NOW,
    )
    assert result["status"] == "cancelled"


def test_auto_complete_and_rolling_end_date(pg_session):
    from tests.pg.test_sdd216_review_regressions import setup_class
    from app.services import class_rolling_service as rolling
    from datetime import timedelta

    a, b, cls, rows = setup_class(pg_session)
    for row in rows:
        row.status = "completed"
    pg_session.commit()
    assert hasattr(rolling, "finish_class_if_due")
    assert rolling.finish_class_if_due(pg_session, cls, NOW)
    assert cls.status == "completed"
    a, b, cls, rows = setup_class(pg_session, rolling=True)
    cls.ends_on = NOW.date()
    pg_session.commit()
    assert rolling.finish_class_if_due(pg_session, cls, NOW + timedelta(days=1))
    assert cls.status == "completed" and all(r.status == "cancelled" for r in rows)


def test_completed_class_makeup_preserves_member_and_source(pg_session):
    from tests.pg.test_sdd216_review_regressions import setup_class
    from tests.pg.sdd216_helpers import user
    from app.services.class_membership_service import invite_members
    from app.models.session import SessionParticipant

    a, b, cls, rows = setup_class(pg_session)
    member = user(pg_session, role="client")
    membership = invite_members(pg_session, cls, [member.id], a.id, NOW)[0]
    for row in rows:
        row.status = "completed"
    cls.status = "completed"
    membership.status = "completed"
    pg_session.commit()
    result = writer().add_session(
        pg_session,
        a.id,
        cls.id,
        {
            "operation_key": str(uuid4()),
            "expected_revision": cls.revision,
            "makeup_for_session_id": str(rows[0].id),
            "member_ids": [str(member.id)],
            "row": {
                "client_key": "makeup",
                "seq": 9,
                "session_kind": "makeup",
                "scheduled_at": "2027-01-04T10:00:00Z",
                "host_id": str(a.id),
            },
        },
        now=NOW,
    )
    expected = (
        pg_session.query(SessionParticipant)
        .filter_by(session_id=result["session_ids"][0], user_id=member.id)
        .one()
    )
    assert (
        expected.attendance_kind == "makeup"
        and expected.makeup_for_session_id == rows[0].id
    )
    assert cls.status == "completed" and membership.status == "completed"


def test_duplicate_completed_cohort_keeps_opted_in_member_invites(pg_session):
    from tests.pg.test_sdd216_review_regressions import setup_class
    from tests.pg.sdd216_helpers import user
    from app.services.class_membership_service import invite_members

    a, b, cls, rows = setup_class(pg_session)
    member = user(pg_session, role="client")
    membership = invite_members(pg_session, cls, [member.id], a.id, NOW)[0]
    membership.status = "completed"
    cls.status = "completed"
    pg_session.commit()
    result = writer().duplicate_class(
        pg_session,
        a.id,
        cls.id,
        {
            "operation_key": str(uuid4()),
            "start_date": "2027-02-01",
            "invite_members": True,
        },
        now=NOW,
    )
    draft = pg_session.get(Class, result["class_id"])
    assert draft.draft_schedule["member_ids"] == [str(member.id)]


def test_duplicate_key_cannot_be_reused_for_another_source(pg_session):
    org, a, b, parent = world(pg_session)
    source_ids = [
        writer().create_class(
            pg_session, a.id, command(a).model_copy(update={"status": "draft"}), now=NOW
        )["class_id"]
        for _ in range(2)
    ]
    request = {"operation_key": str(uuid4()), "start_date": "2027-03-01"}
    writer().duplicate_class(pg_session, a.id, source_ids[0], request, now=NOW)
    with pytest.raises(HTTPException) as exc:
        writer().duplicate_class(pg_session, a.id, source_ids[1], request, now=NOW)
    assert exc.value.status_code == 409


def test_duplicate_replay_uses_request_not_changed_source(pg_session):
    from app.services.class_write_service import duplicate_class
    from tests.pg.test_sdd216_review_regressions import setup_class

    a, _, source, _ = setup_class(pg_session)
    command = {
        "operation_key": str(uuid4()),
        "start_date": "2027-02-01",
        "invite_members": False,
    }
    result = duplicate_class(pg_session, a.id, source.id, command, now=NOW)
    source.title = "복제 이후 수정된 원본"
    source.recurrence_rule = None
    pg_session.commit()
    assert duplicate_class(pg_session, a.id, source.id, command, now=NOW) == result
