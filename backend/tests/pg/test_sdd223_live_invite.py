"""SDD-223: 진행 중(open/in_progress) 회차에 회원 즉시 초대·입장 (start_now 무관)."""

from uuid import uuid4
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.class_program import ClassMember
from app.models.class_scheduling import ClassEffect
from app.models.session import Session, SessionParticipant
from app.services import class_effect_service as effects
from app.services.class_membership_service import (
    _activate_future,
    invite_emails,
    invite_members,
    live_session,
)
from tests.pg.sdd216_helpers import user
from tests.pg.test_sdd216_review_regressions import setup_class
from tests.pg.test_sdd216_write import NOW

pytestmark = pytest.mark.pg


def participant(db, session, member):
    return (
        db.query(SessionParticipant)
        .filter_by(session_id=session.id, user_id=member.id)
        .first()
    )


def open_first(db, rows, status="open"):
    rows[0].status = status
    db.flush()
    return rows[0]


def test_open_session_gets_expected_participant(pg_session):
    a, b, cls, rows = setup_class(pg_session)
    live = open_first(pg_session, rows)
    member = user(pg_session, role="client")
    invite_members(pg_session, cls, [member.id], a.id, NOW)
    row = participant(pg_session, live, member)
    assert row is not None and row.attendance_status == "expected"


def test_in_progress_session_gets_expected_participant(pg_session):
    a, b, cls, rows = setup_class(pg_session)
    live = open_first(pg_session, rows, "in_progress")
    member = user(pg_session, role="client")
    invite_members(pg_session, cls, [member.id], a.id, NOW)
    assert participant(pg_session, live, member).attendance_status == "expected"


def test_live_session_capacity_enforced(pg_session):
    a, b, cls, rows = setup_class(pg_session)
    live = open_first(pg_session, rows)
    live.max_participants = 1
    first, second = user(pg_session, role="client"), user(pg_session, role="client")
    invite_members(pg_session, cls, [first.id], a.id, NOW)
    with pytest.raises(HTTPException) as err:
        invite_members(pg_session, cls, [second.id], a.id, NOW)
    assert err.value.detail == {"code": "session_capacity"}


def test_future_and_live_sessions_both_covered(pg_session):
    a, b, cls, rows = setup_class(pg_session)
    live = open_first(pg_session, rows)
    member = user(pg_session, role="client")
    invite_members(pg_session, cls, [member.id], a.id, NOW)
    assert participant(pg_session, live, member) is not None
    assert participant(pg_session, rows[1], member) is not None


def test_no_live_session_keeps_future_only(pg_session):
    a, b, cls, rows = setup_class(pg_session)
    assert live_session(pg_session, cls) is None
    member = user(pg_session, role="client")
    invite_members(pg_session, cls, [member.id], a.id, NOW)
    assert participant(pg_session, rows[0], member) is not None


def test_live_session_helper(pg_session):
    a, b, cls, rows = setup_class(pg_session)
    rows[2].status = "open"
    rows[1].status = "in_progress"
    pg_session.flush()
    assert live_session(pg_session, cls).id == rows[1].id


def test_cancelled_and_hidden_sessions_skipped(pg_session):
    a, b, cls, rows = setup_class(pg_session)
    rows[0].status = "cancelled"
    rows[1].status = "open"
    rows[1].hidden_at = NOW
    pg_session.flush()
    assert live_session(pg_session, cls) is None
    member = user(pg_session, role="client")
    invite_members(pg_session, cls, [member.id], a.id, NOW)
    assert participant(pg_session, rows[0], member) is None
    assert participant(pg_session, rows[1], member) is None


def test_attended_participant_untouched(pg_session):
    a, b, cls, rows = setup_class(pg_session)
    live = open_first(pg_session, rows, "in_progress")
    member = user(pg_session, role="client")
    invite_members(pg_session, cls, [member.id], a.id, NOW)
    row = participant(pg_session, live, member)
    row.attendance_status = "attended"
    pg_session.flush()
    invite_members(pg_session, cls, [member.id], a.id, NOW)
    pg_session.refresh(row)
    assert row.attendance_status == "attended"


def test_code_entry_member_joins_live_session(pg_session):
    # session_service._enter_resolved 가 호출하는 via="code" 경로(이메일 초대 수신자 입장)
    a, b, cls, rows = setup_class(pg_session)
    live = open_first(pg_session, rows)
    member = user(pg_session, role="client")
    invite_members(pg_session, cls, [member.id], member.id, NOW, via="code")
    assert participant(pg_session, live, member).attendance_status == "expected"


def test_waitlist_activation_covers_live_session(pg_session):
    a, b, cls, rows = setup_class(pg_session)
    live = open_first(pg_session, rows)
    member = user(pg_session, role="client")
    membership = ClassMember(
        class_id=cls.id, user_id=member.id, kind="member", status="active",
        joined_via="host_invite", activated_at=NOW, joined_at=NOW,
    )
    pg_session.add(membership)
    pg_session.flush()
    _activate_future(pg_session, cls, membership, rows, NOW)
    assert participant(pg_session, live, member).attendance_status == "expected"


def capture_notifications(monkeypatch):
    sent = []
    monkeypatch.setattr(
        effects, "notify_event",
        lambda event, uid, payload, db, **kw: sent.append((event, uid, payload)),
    )
    return sent


def test_class_invited_notification_live_wording(pg_session, monkeypatch):
    a, b, cls, rows = setup_class(pg_session)
    live = open_first(pg_session, rows)
    member = user(pg_session, role="client")
    invite_members(pg_session, cls, [member.id], a.id, NOW)
    sent = capture_notifications(monkeypatch)
    intent = pg_session.query(ClassEffect).filter_by(class_id=cls.id, kind="class_invited").one()
    effects._deliver(pg_session, intent, NOW)
    (_, uid, payload), = sent
    assert uid == member.id and payload["title"] == "클래스 초대"
    assert "지금 입장할 수 있어요" in payload["body"] and f"/class/{live.id}/enter" in payload["body"]
    params = payload["extra"]["params"]
    assert params["start_now"] is True and params["session_id"] == str(live.id)


def test_class_invited_notification_without_live_keeps_default(pg_session, monkeypatch):
    a, b, cls, rows = setup_class(pg_session)
    member = user(pg_session, role="client")
    invite_members(pg_session, cls, [member.id], a.id, NOW)
    sent = capture_notifications(monkeypatch)
    intent = pg_session.query(ClassEffect).filter_by(class_id=cls.id, kind="class_invited").one()
    effects._deliver(pg_session, intent, NOW)
    (_, _, payload), = sent
    assert payload["title"] == "클래스 초대" and "session_id" not in payload["extra"]["params"]


def test_email_invite_body_has_entry_link(pg_session, monkeypatch):
    a, b, cls, rows = setup_class(pg_session)
    live = open_first(pg_session, rows)
    cls.access_code = "123456"
    pg_session.flush()
    invite_emails(pg_session, cls, ["guest@example.com"], a.id)
    mails = []
    monkeypatch.setattr("app.tasks.email._send_email", lambda to, subject, body: mails.append(body) or True)
    intent = pg_session.query(ClassEffect).filter_by(class_id=cls.id, kind="email_invite").one()
    effects._deliver(pg_session, intent, NOW)
    assert f"/class/{live.id}/enter" in mails[0] and "123456" in mails[0]


def http_client(db, actor, monkeypatch):
    from app.api.v1.classes import router
    from app.config import settings

    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: {"id": str(actor.id), "role": "counselor"}
    monkeypatch.setattr(settings, "class_scheduling_enabled", True)
    monkeypatch.setattr("app.api.v1.classes.queue_class_effects", lambda result, bg, db: result)
    return TestClient(app)


def test_members_and_email_api_return_current_session_id(pg_session, monkeypatch):
    a, b, cls, rows = setup_class(pg_session)
    cls.access_code = "654321"
    pg_session.commit()
    client = http_client(pg_session, a, monkeypatch)
    member = user(pg_session, role="client")
    url = f"/api/v1/classes/{cls.id}"
    first = client.post(f"{url}/members", json={"operation_key": str(uuid4()), "expected_revision": cls.revision, "user_ids": [str(member.id)]})
    assert first.status_code == 200, first.text
    assert first.json()["current_session_id"] is None and first.json()["member_ids"]
    live = open_first(pg_session, rows)
    pg_session.commit()
    other = user(pg_session, role="client")
    pg_session.refresh(cls)
    second = client.post(f"{url}/members", json={"operation_key": str(uuid4()), "expected_revision": cls.revision, "user_ids": [str(other.id)]})
    assert second.status_code == 200, second.text
    assert second.json()["current_session_id"] == str(live.id)
    pg_session.refresh(cls)
    mail = client.post(f"{url}/email-invites", json={"operation_key": str(uuid4()), "expected_revision": cls.revision, "emails": ["x@example.com"]})
    assert mail.status_code == 200, mail.text
    assert mail.json()["current_session_id"] == str(live.id) and mail.json()["invitations"]
