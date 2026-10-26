"""클래스 초대 범위와 최소 회원 후보 응답 — 실제 라우터/SQLite 검증."""
from datetime import datetime, timezone

import pytest

from app.api.deps import get_current_user
from app.config import settings
from app.core import database
from app.main import app
from app.models.class_program import ClassInstructor, ClassMember
from app.models.client_counselor_link import ClientCounselorLink
from app.models.user import User
from app.models.user_org_membership import UserOrgMembership
from tests.pg.sdd216_helpers import user, world


@pytest.fixture
def scene(client, monkeypatch):
    monkeypatch.setattr(settings, "class_scheduling_enabled", True)
    with database.SessionLocal() as db:
        org, lead, assistant, cls = world(db)
        admin = user(db, org, role="org_admin")
        unrelated = user(db, org)
        guest = user(db, org)
        outsider_org, outsider, _, foreign = world(db)
        no_org = user(db)
        member = user(db, role="client")
        linked = user(db, role="client")
        assistant_client = user(db, role="client")
        center_client = user(db, role="client")
        external = user(db, role="client")
        suspended = user(db, role="client")
        suspended.status = "suspended"
        ended = user(db, role="client")
        for i, candidate in enumerate((member, linked, assistant_client, center_client, external, suspended, ended)):
            candidate.name = f"회원{i}"
            candidate.email = f"candidate{i}@example.com"
        db.add_all([
            ClassInstructor(class_id=cls.id, user_id=assistant.id, role="assistant"),
            ClassInstructor(class_id=cls.id, user_id=guest.id, role="guest"),
            ClassMember(class_id=cls.id, user_id=member.id, status="active", joined_via="code"),
            ClientCounselorLink(client_id=linked.id, counselor_id=lead.id),
            ClientCounselorLink(client_id=assistant_client.id, counselor_id=assistant.id),
            ClientCounselorLink(client_id=center_client.id, counselor_id=unrelated.id),
            ClientCounselorLink(client_id=ended.id, counselor_id=lead.id, status="ended"),
        ])
        db.commit()
        ids = {name: str(actor.id) for name, actor in locals().copy().items() if isinstance(actor, User)}
        ids.update(cls=str(cls.id), foreign=str(foreign.id), org=str(org.id))

    def login(name):
        actor_id = ids[name]
        monkeypatch.setitem(app.dependency_overrides, get_current_user, lambda: {"id": actor_id, "role": "org_admin" if name == "admin" else "client" if name == "member" else "counselor"})

    return ids, login


def search(client, ids, q="회원", scoped=True):
    return client.get("/api/v1/classes/member-candidates", params={"q": q, **({"class_id": ids["cls"]} if scoped else {})})


@pytest.mark.parametrize("actor,expected", [("lead", {"member", "linked"}), ("assistant", {"member", "assistant_client"}), ("admin", {"member", "linked", "assistant_client", "center_client"})])
def test_초대_권한자의_이름_후보는_허용된_관계만_반환(client, scene, actor, expected):
    ids, login = scene
    login(actor)
    response = search(client, ids)
    assert response.status_code == 200, response.text
    data = response.json()
    assert {row["id"] for row in data["members"]} == {ids[name] for name in expected}
    assert data["has_more"] is False
    for row in data["members"]:
        assert set(row) == {"id", "name", "masked_email"}
        assert "***" in row["masked_email"]
        assert row["masked_email"] not in {f"candidate{i}@example.com" for i in range(7)}


@pytest.mark.parametrize("actor", ["lead", "assistant", "admin"])
def test_정확_이메일은_활성_회원만_찾고_부분_이메일은_전역검색하지_않는다(client, scene, actor):
    ids, login = scene
    login(actor)
    result = search(client, ids, " Candidate4@Example.Com ")
    assert result.status_code == 200, result.text
    assert [row["id"] for row in result.json()["members"]] == [ids["external"]]
    for query in ("candidate4@", "%@example.com", "candidate5@example.com", "candidate", "%", "_"):
        response = search(client, ids, query)
        assert response.status_code == 200
        assert response.json()["members"] == []


@pytest.mark.parametrize("actor", ["guest", "member", "outsider", "unrelated"])
def test_초대_권한_없는_클래스_후보_조회는_차단(client, scene, actor):
    ids, login = scene
    login(actor)
    assert search(client, ids, "candidate4@example.com").status_code in (403, 404)


@pytest.mark.parametrize("actor", ["lead", "admin"])
def test_클래스_생성_전에도_현재_개설_권한으로_검색(client, scene, actor):
    ids, login = scene
    login(actor)
    response = search(client, ids, "candidate4@example.com", scoped=False)
    assert response.status_code == 200, response.text
    assert response.json()["members"][0]["id"] == ids["external"]


def test_기관없음_소속해제_계정정지_기관비활성은_검색차단(client, scene):
    ids, login = scene
    login("no_org")
    assert search(client, ids, scoped=False).status_code == 403
    login("assistant")
    with database.SessionLocal() as db:
        db.query(UserOrgMembership).filter(UserOrgMembership.user_id == ids["assistant"]).update({"status": "left"})
        db.commit()
    assert search(client, ids).status_code in (403, 404)
    assert search(client, ids, scoped=False).status_code == 403
    login("lead")
    with database.SessionLocal() as db:
        db.query(User).filter(User.id == ids["lead"]).update({"status": "suspended"})
        db.commit()
    assert search(client, ids).status_code in (403, 404)
    login("admin")
    from app.models.organization import Organization
    with database.SessionLocal() as db:
        db.query(Organization).filter(Organization.id == ids["org"]).update({"deactivated_at": datetime.now(timezone.utc)})
        db.commit()
    assert search(client, ids, scoped=False).status_code == 403


def test_타센터_클래스와_기능off_접근은_404(client, scene, monkeypatch):
    ids, login = scene
    login("lead")
    assert search(client, {**ids, "cls": ids["foreign"]}).status_code == 404
    monkeypatch.setattr(settings, "class_scheduling_enabled", False)
    assert search(client, ids).status_code == 404


def test_빈검색은_관계범위20명과_추가여부만_반환(client, scene):
    ids, login = scene
    login("lead")
    with database.SessionLocal() as db:
        for _ in range(23):
            actor = user(db, role="client")
            db.add(ClientCounselorLink(client_id=actor.id, counselor_id=ids["lead"]))
        db.commit()
    response = search(client, ids, "")
    assert response.status_code == 200, response.text
    assert len(response.json()["members"]) == 20
    assert response.json()["has_more"] is True
    assert set(response.json()) == {"members", "has_more"}


@pytest.mark.parametrize("status", ["deleted", "suspended", "pending"])
def test_정확이메일도_비활성계정은_초대후보에서_제외(client, scene, status):
    ids, login = scene
    login("admin")
    with database.SessionLocal() as db:
        db.query(User).filter(User.id == ids["external"]).update({"status": status})
        db.commit()
    response = search(client, ids, "candidate4@example.com")
    assert response.status_code == 200
    assert response.json()["members"] == []
