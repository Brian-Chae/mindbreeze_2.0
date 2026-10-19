"""FE 재진입에 필요한 요청·초대 조회와 설정 복원 계약."""

from datetime import datetime, timedelta, timezone
from uuid import UUID

import pytest

from app.api.deps import get_current_user
from app.config import settings
from app.core import database
from app.main import app
from app.models.class_program import Class, ClassInstructor, ClassMember
from app.models.class_scheduling import ClassEmailInvite, SessionHostRequest
from app.models.notification import Notification
from app.models.session import Session
from app.models.user import User
from app.models.user_org_membership import UserOrgMembership
from app.models.organization import Organization
from app.services.class_effect_service import process_effects
from app.services.class_instructor_service import _request_effect
from tests.pg.sdd216_helpers import user, world


@pytest.fixture
def scene(client, monkeypatch):
    monkeypatch.setattr(settings, "class_scheduling_enabled", True)
    with database.SessionLocal() as db:
        org, lead, candidate, cls = world(db)
        admin = user(db, org, role="org_admin")
        other = user(db, org)
        guest = user(db, org)
        member = user(db, role="client")
        _, outsider, _, foreign = world(db)
        cls.recurrence_rule = {"version": 1}
        cls.record_video = True
        cls.chat_enabled = True
        cls.reminder_offsets = [60, 180]
        for actor in (candidate, other):
            db.add(ClassInstructor(class_id=cls.id, user_id=actor.id, role="assistant"))
        db.add(
            ClassMember(
                class_id=cls.id, user_id=member.id, status="active", joined_via="code"
            )
        )
        now = datetime.now(timezone.utc)
        sessions = []
        for seq in (1, 2):
            row = Session(
                type="meditation",
                class_id=cls.id,
                host_id=lead.id,
                seq=seq,
                status="scheduled",
                host_state="assigned",
                duration_min=60,
                scheduled_at=now + timedelta(days=seq),
            )
            db.add(row)
            db.flush()
            sessions.append(row)
        db.add(
            ClassInstructor(
                class_id=cls.id,
                user_id=guest.id,
                role="guest",
                scope_session_id=sessions[0].id,
            )
        )
        request = SessionHostRequest(
            session_id=sessions[0].id,
            requested_by=lead.id,
            candidate_host_id=candidate.id,
            request_kind="change",
            status="pending_ack",
            expected_state_version=0,
            expires_at=now + timedelta(hours=1),
            reason="일정 변경",
        )
        db.add(request)
        invite = ClassEmailInvite(
            class_id=cls.id,
            email_norm="invite@example.com",
            invited_by=lead.id,
            status="pending",
        )
        db.add(invite)
        db.add(
            ClassEmailInvite(
                class_id=foreign.id,
                email_norm="other@example.com",
                invited_by=outsider.id,
                status="failed",
            )
        )
        db.commit()
        ids = {
            name: str(actor.id)
            for name, actor in (
                ("lead", lead),
                ("candidate", candidate),
                ("admin", admin),
                ("other", other),
                ("guest", guest),
                ("member", member),
                ("outsider", outsider),
            )
        }
        ids.update(
            cls=str(cls.id),
            session=str(sessions[0].id),
            second=str(sessions[1].id),
            foreign=str(foreign.id),
            request=str(request.id),
            invite=str(invite.id),
        )

    def login(name):
        viewer = {
            "id": ids[name],
            "role": (
                "org_admin"
                if name == "admin"
                else "client" if name == "member" else "counselor"
            ),
        }
        monkeypatch.setitem(app.dependency_overrides, get_current_user, lambda: viewer)

    return ids, login


def test_진행자_요청을_역할과_관련자에_따라_조회한다(client, scene):
    ids, login = scene
    path = f'/api/v1/classes/{ids["cls"]}/sessions/{ids["session"]}/host-requests'
    for name in ("lead", "admin", "candidate"):
        login(name)
        response = client.get(path)
        assert response.status_code == 200, response.text
        rows = response.json()["requests"]
        assert len(rows) == 1
        assert rows[0]["id"] == ids["request"]
        assert rows[0]["candidate_host_id"] == ids["candidate"]
        assert rows[0]["requested_by"] == ids["lead"]
        assert rows[0]["status"] == "pending_ack"
        assert rows[0]["expires_at"]
        assert rows[0]["expected_state_version"] == 0
    login("other")
    assert client.get(path).json()["requests"] == []
    # 새로고침 뒤에도 요청자는 본인 요청을 찾을 수 있다.
    with database.SessionLocal() as db:
        db.get(SessionHostRequest, UUID(ids["request"])).requested_by = UUID(
            ids["other"]
        )
        db.commit()
    assert client.get(path).json()["requests"][0]["id"] == ids["request"]


def test_요청_조회는_회원_타인_guest_범위와_스위치를_검사한다(
    client, scene, monkeypatch
):
    ids, login = scene
    path = f'/api/v1/classes/{ids["cls"]}/sessions/{ids["session"]}/host-requests'
    login("lead")
    assert client.get(path).status_code == 200
    for name, expected in (("member", 403), ("outsider", 404)):
        login(name)
        assert client.get(path).status_code == expected
    login("guest")
    assert client.get(path).status_code == 200
    assert client.get(path.replace(ids["session"], ids["second"])).status_code == 404
    login("lead")
    assert client.get(path.replace(ids["cls"], ids["foreign"])).status_code == 404
    monkeypatch.setattr(settings, "class_scheduling_enabled", False)
    assert client.get(path).status_code == 404
    monkeypatch.setattr(settings, "class_scheduling_enabled", True)
    with database.SessionLocal() as db:
        db.get(User, UUID(ids["lead"])).status = "suspended"
        db.commit()
    assert client.get(path).status_code == 404
    with database.SessionLocal() as db:
        db.get(User, UUID(ids["lead"])).status = "active"
        db.get(Class, UUID(ids["cls"])).hidden_at = datetime.now(timezone.utc)
        db.commit()
    assert client.get(path).status_code == 404


def test_이메일_초대_결과를_재조회하고_권한을_검사한다(client, scene, monkeypatch):
    ids, login = scene
    path = f'/api/v1/classes/{ids["cls"]}/email-invites'
    for state in ("pending", "failed", "sent"):
        with database.SessionLocal() as db:
            row = db.get(ClassEmailInvite, UUID(ids["invite"]))
            row.status = state
            row.sent_at = datetime.now(timezone.utc) if state == "sent" else None
            db.commit()
        for name in ("lead", "candidate", "admin"):
            login(name)
            response = client.get(path)
            assert response.status_code == 200, response.text
            rows = response.json()["invitations"]
            assert len(rows) == 1
            assert rows[0]["id"] == ids["invite"]
            assert rows[0]["email"] == "invite@example.com"
            assert rows[0]["status"] == state
            assert bool(rows[0]["sent_at"]) is (state == "sent")
    for name, expected in (("member", 403), ("outsider", 404), ("guest", 404)):
        login(name)
        assert client.get(path).status_code == expected
    login("lead")
    monkeypatch.setattr(settings, "class_scheduling_enabled", False)
    assert client.get(path).status_code == 404


def test_진행자_요청_알림으로_수락할_요청을_식별한다(client, scene):
    ids, _ = scene
    with database.SessionLocal() as db:
        request = db.get(SessionHostRequest, UUID(ids["request"]))
        _request_effect(
            db,
            db.get(Class, UUID(ids["cls"])),
            db.get(Session, UUID(ids["session"])),
            request,
        )
        db.commit()
        result = process_effects(
            db, now=datetime.now(timezone.utc) + timedelta(seconds=1)
        )
        assert result == {"done": 1, "failed": 0}
        note = db.query(Notification).filter_by(user_id=UUID(ids["candidate"])).one()
        assert note.extra["params"]["request_id"] == ids["request"]
        assert note.extra["params"]["class_id"] == ids["cls"]


def test_편집_화면에_현재_녹화_채팅_리마인더_설정을_반환한다(client, scene):
    ids, login = scene
    for name in ("lead", "admin"):
        login(name)
        for _ in range(2):
            response = client.get(f'/api/v1/classes/{ids["cls"]}')
            assert response.status_code == 200, response.text
            detail = response.json()
            assert detail["record_video"] is True
            assert detail["chat_enabled"] is True
            assert detail["reminder_offsets"] == [60, 180]


def test_강사_후보는_같은_기관의_활성_지도사만_반환한다(client, scene):
    ids, login = scene
    path = "/api/v1/classes/instructor-candidates"
    for name in ("lead", "admin"):
        login(name)
        for suffix in ("", f'?class_id={ids["cls"]}'):
            response = client.get(path + suffix)
            assert response.status_code == 200, response.text
            rows = response.json()["instructors"]
            assert {r["id"] for r in rows} == {
                ids[n] for n in ("lead", "candidate", "other", "guest")
            }
            assert all(set(r) == {"id", "name"} for r in rows)
    login("candidate")
    assert client.get(path + f'?class_id={ids["cls"]}').status_code == 403
    login("outsider")
    assert client.get(path + f'?class_id={ids["cls"]}').status_code == 404
    with database.SessionLocal() as db:
        db.get(User, UUID(ids["candidate"])).status = "suspended"
        db.query(UserOrgMembership).filter_by(
            user_id=UUID(ids["other"])
        ).one().status = "suspended"
        db.commit()
    login("lead")
    assert {r["id"] for r in client.get(path).json()["instructors"]} == {
        ids["lead"],
        ids["guest"],
    }


def test_강사_후보_조회는_계정_기관_소속과_편성_스위치를_검사한다(
    client, scene, monkeypatch
):
    ids, login = scene
    path = "/api/v1/classes/instructor-candidates"
    login("lead")
    assert client.get(path).status_code == 200
    monkeypatch.setattr(settings, "class_scheduling_enabled", False)
    assert client.get(path).status_code == 404
    monkeypatch.setattr(settings, "class_scheduling_enabled", True)
    login("member")
    assert client.get(path).status_code == 403
    login("lead")
    with database.SessionLocal() as db:
        db.get(User, UUID(ids["lead"])).status = "suspended"
        db.commit()
    assert client.get(path).status_code == 403
    with database.SessionLocal() as db:
        db.get(User, UUID(ids["lead"])).status = "active"
        db.query(UserOrgMembership).filter_by(
            user_id=UUID(ids["lead"])
        ).one().status = "suspended"
        db.commit()
    assert client.get(path).status_code == 403
    with database.SessionLocal() as db:
        membership = (
            db.query(UserOrgMembership).filter_by(user_id=UUID(ids["lead"])).one()
        )
        membership.status = "active"
        db.get(Organization, membership.org_id).deactivated_at = datetime.now(
            timezone.utc
        )
        db.commit()
    assert client.get(path).status_code == 403
