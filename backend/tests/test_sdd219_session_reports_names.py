"""SDD-219 — 회차 리포트 목록의 참여자 이름·출석 집계 가산 필드."""
from uuid import UUID

import pytest

from app.api.deps import get_current_user
from app.config import settings
from app.core import database
from app.main import app
from app.models.class_program import ClassMember
from app.models.record import Report
from app.models.session import Session, SessionParticipant
from app.models.user import User
from tests.pg.sdd216_helpers import user, world


@pytest.fixture
def scene(client, monkeypatch):
    monkeypatch.setattr(settings, "class_scheduling_enabled", True)
    monkeypatch.setattr(settings, "class_team_read_enabled", True)
    with database.SessionLocal() as db:
        org, lead, _, cls = world(db)
        member = user(db, role="client")
        member.name = "김회원"
        absent = user(db, role="client")
        sess = Session(type="meditation", class_id=cls.id, host_id=lead.id, seq=1, status="completed", host_state="assigned", duration_min=60)
        db.add(sess)
        db.flush()
        p1 = SessionParticipant(session_id=sess.id, user_id=member.id, attendance_status="attended")
        p2 = SessionParticipant(session_id=sess.id, user_id=absent.id, attendance_status="absent")
        p3 = SessionParticipant(session_id=sess.id, user_id=None, guest_name="게스트님", attendance_status="attended")
        db.add_all([p1, p2, p3])
        db.flush()
        for part, uid in ((p1, member.id), (p3, None)):
            db.add(Report(session_id=sess.id, type="client", status="completed", content={}, is_read=False, user_id=uid, participant_id=part.id))
        db.add(Report(session_id=sess.id, type="counselor", status="completed", content={}, is_read=False))
        db.commit()
        ids = {"cls": str(cls.id), "session": str(sess.id), "lead": str(lead.id)}

    def login():
        app.dependency_overrides[get_current_user] = lambda: {"id": ids["lead"], "role": "counselor"}

    yield ids, login
    app.dependency_overrides.pop(get_current_user, None)


def test_names_and_attendance_added(client, scene):
    ids, login = scene
    login()
    r = client.get(f'/api/v1/classes/{ids["cls"]}/sessions/{ids["session"]}/reports')
    assert r.status_code == 200, r.text
    body = r.json()
    clients = [x for x in body["reports"] if x["type"] == "client"]
    assert sorted(x["participant_name"] for x in clients) == ["게스트님", "김회원"]
    assert [x["participant_name"] for x in body["reports"] if x["type"] == "counselor"] == [None]
    assert body["attendance"] == {"attended": 2, "absent": 1}
    assert {"id", "type", "status"} <= set(body["reports"][0])
