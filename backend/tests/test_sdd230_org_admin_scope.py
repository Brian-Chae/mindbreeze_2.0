"""SDD-230 1-2단계 — 기관관리자 범위 검증 (verify.md A1~A9)."""

import logging
import uuid
from datetime import datetime, timedelta, timezone

from tests.test_sdd230_member_overview import (
    NOW, _client_user, _counselor, _db, _h, _link, _participant, _report, _session,
)


def _org(db, name="기관", kind="institution"):
    from app.models.organization import Organization

    org = Organization(name=f"{name}-{uuid.uuid4().hex[:6]}", kind=kind, verified=True)
    db.add(org)
    db.commit()
    return org


def _admin(db, *orgs, name="관리자"):
    from app.core.security import create_access_token, hash_password
    from app.models.user import User
    from app.services import membership_service

    u = User(
        email=f"a-{uuid.uuid4().hex[:8]}@test.com", password_hash=hash_password("Passw0rd!"),
        name=name, role="org_admin", status="active", verified_tier="email",
    )
    db.add(u)
    db.flush()
    for org in orgs:
        membership_service.add_membership(db, u, org.id, status_="active", role="org_admin")
    db.commit()
    return {"id": str(u.id), "access_token": create_access_token(subject=str(u.id))}


def _cls(db, org, host_id, *, known=True, status="active", title="기관 명상"):
    from app.models.class_program import Class

    c = Class(
        created_by=uuid.UUID(str(host_id)), title=title, default_duration_min=30, status=status,
        organization_id=org.id, organization_attribution_known=known,
    )
    db.add(c)
    db.flush()
    return c


def _member(db, cls, user):
    from app.models.class_program import ClassMember

    db.add(ClassMember(class_id=cls.id, user_id=user.id, status="active", joined_via="host_invite"))
    db.commit()


def _class_session(db, cls, host_id, when=None, title="명상 회차"):
    s = _session(db, host_id, title=title, when=when)
    s.class_id = cls.id
    s.organization_id = cls.organization_id
    s.organization_attribution_known = True
    db.flush()
    return s


def _paths(uid):
    return (
        ("get", f"/api/v1/clients/{uid}"),
        ("get", f"/api/v1/clients/{uid}/activity"),
        ("get", f"/api/v1/clients/{uid}/reports"),
        ("post", f"/api/v1/clients/{uid}/contact-reveal"),
    )


def _world():
    db = _db()
    org = _org(db)
    admin = _admin(db, org)
    host = _counselor("호스트")
    cls = _cls(db, org, host["id"])
    member = _client_user(db, name="기관회원")
    _member(db, cls, member)
    return db, org, admin, host, cls, member


def test_a1_기관_클래스_멤버_허용(client):
    db, org, admin, host, cls, member = _world()
    s = _class_session(db, cls, host["id"], when=NOW - timedelta(days=2))
    p = _participant(db, s, member, attendance_status="attended")
    _report(db, s, p, type_="client")
    db.commit()
    lst = client.get("/api/v1/clients", headers=_h(admin)).json()
    assert lst["total"] == 1 and lst["clients"][0]["name"] == "기관회원"
    assert lst["clients"][0]["classes"][0]["title"] == "기관 명상"
    for method, path in _paths(member.id):
        assert getattr(client, method)(path, headers=_h(admin)).status_code == 200, path
    act = client.get(f"/api/v1/clients/{member.id}/activity", headers=_h(admin)).json()
    assert [i["type"] for i in act["items"]] == ["session"]
    assert len(client.get(f"/api/v1/clients/{member.id}/reports", headers=_h(admin)).json()["reports"]) == 1


def test_a1_기관_귀속_상담관계_회원_허용(client):
    from app.models.counseling import CounselingRelationship

    db, org, admin, host, cls, member = _world()
    other = _client_user(db, name="상담회원")
    db.add(CounselingRelationship(
        organization_id=org.id, organization_attribution_known=True,
        counselor_id=uuid.UUID(host["id"]), client_user_id=other.id, status="active",
    ))
    db.commit()
    names = {c["name"] for c in client.get("/api/v1/clients", headers=_h(admin)).json()["clients"]}
    assert names == {"기관회원", "상담회원"}
    assert client.get(f"/api/v1/clients/{other.id}", headers=_h(admin)).status_code == 200


def test_a2_타기관_관리자_403_목록_미포함(client):
    db, org, admin, host, cls, member = _world()
    other_admin = _admin(db, _org(db, "타기관"))
    assert client.get("/api/v1/clients", headers=_h(other_admin)).json()["total"] == 0
    for method, path in _paths(member.id):
        assert getattr(client, method)(path, headers=_h(other_admin)).status_code == 403, path


def test_a3_개인상담소_귀속불명_링크만_회원은_미노출(client):
    db, org, admin, host, cls, member = _world()
    office = _org(db, "개인", kind="individual")
    pc = _cls(db, office, host["id"], title="개인 클래스")
    p_user = _client_user(db, name="개인회원")
    _member(db, pc, p_user)
    unk = _cls(db, org, host["id"], known=False, title="귀속불명")
    u_user = _client_user(db, name="불명회원")
    _member(db, unk, u_user)
    draft = _cls(db, org, host["id"], status="draft", title="초안")
    d_user = _client_user(db, name="초안회원")
    _member(db, draft, d_user)
    l_user = _client_user(db, name="링크회원")
    _link(db, host, l_user)
    # 개인상담소 owner 를 관리자로 두어도 individual 은 관리 기관이 아니다
    office_admin = _admin(db, office)
    names = {c["name"] for c in client.get("/api/v1/clients", headers=_h(admin)).json()["clients"]}
    assert names == {"기관회원"}
    for u in (p_user, u_user, d_user, l_user):
        assert client.get(f"/api/v1/clients/{u.id}", headers=_h(admin)).status_code == 403
        assert client.post(f"/api/v1/clients/{u.id}/contact-reveal", headers=_h(admin)).status_code == 403
    assert client.get("/api/v1/clients", headers=_h(office_admin)).json()["total"] == 0


def test_a4_다중기관_관리자_합집합_비관리_기관_제외_left_제외(client):
    from app.models.user_org_membership import UserOrgMembership

    db, org, _a, host, cls, member = _world()
    org2 = _org(db, "두번째")
    org3 = _org(db, "세번째")
    c2 = _cls(db, org2, host["id"], title="두번째 클래스")
    m2 = _client_user(db, name="두번째회원")
    _member(db, c2, m2)
    c3 = _cls(db, org3, host["id"])
    m3 = _client_user(db, name="세번째회원")
    _member(db, c3, m3)
    admin = _admin(db, org, org2)
    names = {c["name"] for c in client.get("/api/v1/clients", headers=_h(admin)).json()["clients"]}
    assert names == {"기관회원", "두번째회원"}
    assert client.get(f"/api/v1/clients/{m3.id}", headers=_h(admin)).status_code == 403
    mem = db.query(UserOrgMembership).filter(
        UserOrgMembership.user_id == uuid.UUID(admin["id"]), UserOrgMembership.org_id == org2.id
    ).first()
    mem.status = "left"
    db.commit()
    names = {c["name"] for c in client.get("/api/v1/clients", headers=_h(admin)).json()["clients"]}
    assert names == {"기관회원"}
    assert client.get(f"/api/v1/clients/{m2.id}", headers=_h(admin)).status_code == 403


def test_a5_상담사_범위_불변(client):
    db, org, admin, host, cls, member = _world()
    # 같은 기관 회원이지만 호스트(상담사)에게 active 링크가 없으면 목록 0, 상세 403
    assert client.get("/api/v1/clients", headers=_h(host)).json()["total"] == 0
    for method, path in _paths(member.id):
        assert getattr(client, method)(path, headers=_h(host)).status_code == 403, path
    res = client.get("/api/v1/clients", headers=_h(host)).json()
    assert res["counselor_options"] == []


def test_a6_메모는_본인연결만(client):
    from app.models.client_counselor_link import ClientCounselorLink

    db, org, admin, host, cls, member = _world()
    _link(db, host, member)
    link = db.query(ClientCounselorLink).filter(ClientCounselorLink.client_id == member.id).first()
    link.memo = "상담사 비공개 메모"
    db.commit()
    det = client.get(f"/api/v1/clients/{member.id}", headers=_h(admin)).json()
    assert det["memo"] is None and det["memo_editable"] is False
    assert "비공개" not in str(det)
    assert client.put(f"/api/v1/clients/{member.id}/memo", json={"memo": "x"}, headers=_h(admin)).status_code == 403
    # 관리자가 직접 연결한 회원이면 본인 메모만
    own = _client_user(db, name="직접회원")
    _link(db, {"id": admin["id"]}, own)
    d2 = client.get(f"/api/v1/clients/{own.id}", headers=_h(admin)).json()
    assert d2["memo_editable"] is True and d2["memo"] in (None, "")


def test_a7_활동_리포트는_명상_클래스_세션_회원용만(client):
    from app.models.agent import AgentCheckin  # noqa: F401  (AI 안부 제외 확인용 import)

    db, org, admin, host, cls, member = _world()
    other = _client_user(db, name="동료")
    _member(db, cls, other)
    s = _class_session(db, cls, host["id"], when=NOW - timedelta(days=1))
    p = _participant(db, s, member, attendance_status="attended")
    po = _participant(db, s, other, attendance_status="attended")
    _report(db, s, p, type_="client")
    _report(db, s, p, type_="counselor")
    _report(db, s, po, type_="client")
    # 상담(counseling) 세션: 호스트가 같아도 관리자 범위 밖
    cs = _session(db, host["id"], title="비공개 상담", when=NOW - timedelta(days=1))
    cs.type = "counseling"
    cs.organization_id = org.id
    cs.organization_attribution_known = True
    db.flush()
    _participant(db, cs, member, attendance_status="attended")
    db.commit()
    act = client.get(f"/api/v1/clients/{member.id}/activity", headers=_h(admin)).json()
    assert [i["title"] for i in act["items"]] == ["명상 회차"]
    reps = client.get(f"/api/v1/clients/{member.id}/reports", headers=_h(admin)).json()["reports"]
    assert [r["type"] for r in reps] == ["client"]
    assert "동료" not in str(act) + str(reps)


def test_a8_담당상담사_열_필터(client):
    db, org, admin, host, cls, member = _world()
    c1 = _counselor("가담당")
    c2 = _counselor("나담당")
    from app.models.user_org_membership import UserOrgMembership  # noqa: F401
    from app.services import membership_service
    from app.models.user import User

    for c in (c1, c2):
        membership_service.add_membership(db, db.get(User, uuid.UUID(c["id"])), org.id, status_="active")
    db.commit()
    m2 = _client_user(db, name="둘째회원")
    _member(db, cls, m2)
    _link(db, c1, member)
    _link(db, c2, m2)
    out = client.get("/api/v1/clients", headers=_h(admin)).json()
    by = {x["name"]: x for x in out["clients"]}
    assert [c["name"] for c in by["기관회원"]["counselors"]] == ["가담당"]
    assert {o["name"] for o in out["counselor_options"]} == {"가담당", "나담당"}
    f = client.get(f"/api/v1/clients?counselor_id={c2['id']}", headers=_h(admin)).json()
    assert f["total"] == 1 and f["clients"][0]["name"] == "둘째회원"
    # 상담사 호출은 담당 상담사 정보가 비어 있다
    mine = client.get("/api/v1/clients", headers=_h(c1)).json()
    assert mine["counselor_options"] == [] and mine["clients"][0]["counselors"] == []


def test_a9_reveal_권한과_감사로그(client, caplog):
    db, org, admin, host, cls, member = _world()
    outsider = _client_user(db, name="외부")
    with caplog.at_level(logging.INFO, logger="audit.client_contact_reveal"):
        ok = client.post(f"/api/v1/clients/{member.id}/contact-reveal", headers=_h(admin))
        no = client.post(f"/api/v1/clients/{outsider.id}/contact-reveal", headers=_h(admin))
    assert ok.status_code == 200 and ok.json()["phone"] == "010-1234-5678"
    assert no.status_code == 403
    assert "010-1234-5678" not in caplog.text and "reveal fields=" in caplog.text
