"""217 계약 문서와 실제 216 호환 기준선. 미래 서비스의 구현 여부를 가장하지 않는다."""

from datetime import datetime, timedelta, timezone
from uuid import uuid4

from pydantic import ValidationError
import pytest
from sqlalchemy.exc import IntegrityError

from app.api.deps import get_current_user
from app.config import settings
from app.core import database
from app.main import app
from app.models.class_program import ClassMember
from app.models.session import Session, SessionParticipant
from app.schemas.class_scheduling import AddSessionCommand, ClassCodeInput
from tests.pg.sdd216_helpers import user, world


def test_기존_코드가입_입력과_보강_member_ids의_UUID_계약을_보존한다():
    assert ClassCodeInput.model_validate({"code": "0017"}).code == "0017"
    with pytest.raises(ValidationError):
        ClassCodeInput.model_validate({"code": "0017", "operation_key": "new"})
    actor_id = uuid4()
    command = AddSessionCommand.model_validate({
        "operation_key": "legacy-makeup", "expected_revision": 0,
        "member_ids": [str(actor_id)],
        "row": {"client_key": "extra:1", "seq": 1,
                "scheduled_at": "2026-11-02T10:00:00+09:00",
                "host_id": str(uuid4()), "session_kind": "makeup"},
    })
    assert command.member_ids == [actor_id]


def test_기존_초대의_정원409는_대기신청으로_바뀌지_않는다(client, monkeypatch):
    monkeypatch.setattr(settings, "class_scheduling_enabled", True)
    with database.SessionLocal() as db:
        _, lead, _, parent = world(db)
        parent.capacity = 2
        accounts = [user(db, role="client") for _ in range(3)]
        for account in accounts[:2]:
            db.add(ClassMember(class_id=parent.id, user_id=account.id, status="active", joined_via="host_invite"))
        db.commit()
        class_id, lead_id, third_id = str(parent.id), str(lead.id), str(accounts[2].id)
    monkeypatch.setitem(app.dependency_overrides, get_current_user, lambda: {"id": lead_id, "role": "counselor"})
    response = client.post(f"/api/v1/classes/{class_id}/members", json={
        "operation_key": "full-class", "expected_revision": 0, "user_ids": [third_id],
    })
    assert response.status_code == 409, response.text
    assert response.json()["detail"]["code"] == "class_capacity"
    with database.SessionLocal() as db:
        assert db.query(ClassMember).filter_by(class_id=class_id).count() == 2
        assert db.query(ClassMember).filter_by(class_id=class_id, status="waitlisted").count() == 0


def test_guest_NULL_회원키는_별개이며_회차_member_UNIQUE를_보존한다(client):
    """SQLite 실제 삽입 제약 확인. PG migration/경합 증거와 구분한다."""
    with database.SessionLocal() as db:
        _, lead, _, parent = world(db)
        guests = [ClassMember(class_id=parent.id, user_id=None, kind="guest", status="active", joined_via="code") for _ in range(2)]
        db.add_all(guests)
        db.flush()
        session = Session(type="meditation", class_id=parent.id, host_id=lead.id, seq=1,
                          status="scheduled", duration_min=60,
                          scheduled_at=datetime.now(timezone.utc) + timedelta(days=1))
        db.add(session)
        db.flush()
        for guest in guests:
            db.add(SessionParticipant(session_id=session.id, user_id=None, member_id=guest.id, attendance_status="expected"))
        db.flush()
        assert guests[0].id != guests[1].id
        assert db.query(SessionParticipant).filter_by(session_id=session.id).count() == 2
        db.add(SessionParticipant(session_id=session.id, user_id=None, member_id=guests[0].id, attendance_status="expected"))
        with pytest.raises(IntegrityError):
            db.flush()
        db.rollback()


def test_기존_읽기_envelope와_nullable_guest를_보존한다(client, monkeypatch):
    with database.SessionLocal() as db:
        _, lead, _, parent = world(db)
        guest = ClassMember(class_id=parent.id, user_id=None, kind="guest", guest_name="이름으로 병합하지 않음", status="active", joined_via="code")
        db.add(guest)
        db.flush()
        db.commit()
        class_id, lead_id, guest_id = str(parent.id), str(lead.id), str(guest.id)
    monkeypatch.setitem(app.dependency_overrides, get_current_user, lambda: {"id": lead_id, "role": "counselor"})
    detail = client.get(f"/api/v1/classes/{class_id}")
    assert detail.status_code == 200, detail.text
    assert detail.json()["id"] == class_id
    assert "class" not in detail.json()
    assert {"manage", "invite", "schedule", "host_request"} <= detail.json()["capabilities"].keys()
    members = client.get(f"/api/v1/classes/{class_id}/members")
    assert members.status_code == 200, members.text
    row = next(row for row in members.json()["members"] if row["id"] == guest_id)
    assert {"id", "user_id", "name", "status"} <= row.keys()
    assert row["user_id"] is None
    sessions = client.get(f"/api/v1/classes/{class_id}/sessions")
    assert sessions.status_code == 200, sessions.text
    assert isinstance(sessions.json()["sessions"], list)
    assert isinstance(sessions.json()["total"], int)
