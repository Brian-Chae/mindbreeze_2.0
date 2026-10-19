"""진행자 요청·혼합 일괄 변경·재초대·회차 추가 알림 회귀."""

from datetime import timedelta
from uuid import uuid4
import pytest
from app.models.class_scheduling import ClassEffect
from app.models.session import SessionParticipant
from tests.pg.test_sdd216_review_regressions import setup_class, replace
from tests.pg.test_sdd216_write import NOW
from tests.pg.sdd216_helpers import user

pytestmark = pytest.mark.pg


def test_host_request_and_rejection_have_durable_notifications(pg_session):
    from app.services.class_instructor_service import (
        apply_host_request,
        resolve_host_request,
    )

    a, b, cls, rows = setup_class(pg_session)
    row = rows[0]
    row.scheduled_at = NOW + timedelta(minutes=30)
    request = apply_host_request(
        pg_session,
        cls,
        row,
        {"candidate_host_id": b.id, "expected_state_version": row.state_version},
        a,
        NOW,
    )
    assert (
        pg_session.query(ClassEffect)
        .filter_by(session_id=row.id, kind="session_host_change_requested")
        .count()
        == 1
    )
    resolve_host_request(pg_session, cls, row, request, "reject", b, NOW)
    assert (
        pg_session.query(ClassEffect)
        .filter_by(session_id=row.id, kind="session_host_change_resolved")
        .count()
        == 1
    )


def test_bulk_pending_first_does_not_suppress_confirmed_change(pg_session, monkeypatch):
    from app.services.class_membership_service import invite_members
    from app.services import class_effect_service as effects

    a, b, cls, rows = setup_class(pg_session)
    member = user(pg_session, role="client")
    invite_members(pg_session, cls, [member.id], a.id, NOW)
    selected = sorted(rows[:2], key=lambda row: row.id)
    replace(
        pg_session,
        a,
        cls,
        selected,
        [b, a],
        [NOW + timedelta(minutes=30), NOW + timedelta(days=2)],
    )
    intent = (
        pg_session.query(ClassEffect)
        .filter_by(class_id=cls.id, kind="session_updated")
        .one()
    )
    sent = []
    monkeypatch.setattr(
        effects,
        "notify_event",
        lambda event, uid, payload, db, **kwargs: sent.append((event, uid)),
    )
    monkeypatch.setattr(effects, "_schedule_reminders", lambda *args: None)
    effects._deliver(pg_session, intent, NOW)
    assert ("session_updated", member.id) in sent


def test_reinvite_keeps_removed_participant_identity(pg_session):
    from app.services.class_membership_service import invite_members

    a, b, cls, rows = setup_class(pg_session)
    member = user(pg_session, role="client")
    membership = invite_members(pg_session, cls, [member.id], a.id, NOW)[0]
    p = (
        pg_session.query(SessionParticipant)
        .filter_by(session_id=rows[0].id, user_id=member.id)
        .one()
    )
    original = p.id
    p.removed_at = NOW
    membership.status = "completed"
    pg_session.flush()
    invite_members(pg_session, cls, [member.id], a.id, NOW, reactivate=True)
    restored = (
        pg_session.query(SessionParticipant)
        .filter_by(session_id=rows[0].id, user_id=member.id)
        .one()
    )
    assert restored.id == original and restored.removed_at is None


def test_added_session_and_new_member_have_notifications(pg_session):
    from app.services.class_membership_service import invite_members
    from app.services.class_write_service import add_session

    a, b, cls, rows = setup_class(pg_session)
    member = user(pg_session, role="client")
    invite_members(pg_session, cls, [member.id], a.id, NOW)
    assert (
        pg_session.query(ClassEffect)
        .filter_by(class_id=cls.id, kind="class_member_joined")
        .count()
        == 1
    )
    result = add_session(
        pg_session,
        a.id,
        cls.id,
        {
            "operation_key": str(uuid4()),
            "expected_revision": cls.revision,
            "row": {
                "client_key": "added",
                "seq": 9,
                "scheduled_at": (NOW + timedelta(days=60)).isoformat(),
                "host_id": str(a.id),
            },
        },
        now=NOW,
    )
    intent = (
        pg_session.query(ClassEffect)
        .filter_by(class_id=cls.id, kind="class_session_added")
        .one()
    )
    assert str(intent.session_id) in result["session_ids"]


@pytest.mark.parametrize("enabled", [True, False])
def test_urgent_confirmed_change_honors_push_preference(
    pg_session, monkeypatch, enabled
):
    from app.services import class_effect_service as effects, notification_service
    from app.services.class_membership_service import invite_members
    from app.models.notification_outbox import NotificationOutbox

    a, b, cls, rows = setup_class(pg_session)
    member = user(pg_session, role="client")
    invite_members(pg_session, cls, [member.id], a.id, NOW)
    prefs = notification_service.update_preferences(
        str(member.id), {}, {}, pg_session, push_prefs={"session_host_changed": enabled}
    )
    assert prefs["push"]["session_host_changed"] is enabled
    row = rows[0]
    row.scheduled_at = NOW + timedelta(minutes=60)
    intent = ClassEffect(
        class_id=cls.id,
        session_id=row.id,
        kind="session_host_changed",
        effect_key=f"push:{cls.id}",
        payload={"previous_host_id": str(a.id), "new_host_id": str(b.id)},
    )
    pg_session.add(intent)
    pg_session.flush()
    monkeypatch.setattr(effects, "_schedule_reminders", lambda *args: None)
    effects._deliver(pg_session, intent, NOW)
    pg_session.flush()
    pushes = (
        pg_session.query(NotificationOutbox)
        .filter_by(user_id=member.id, channel="push")
        .all()
    )
    assert len(pushes) == int(enabled)
    if pushes:
        assert str(row.id) in pushes[0].payload["deeplink"]
