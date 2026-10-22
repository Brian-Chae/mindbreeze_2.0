"""SDD-230 1-3단계 — 기관 소속 상담사 연결 회원 포함 + 회원/비회원 구분 (verify.md L1~L7)."""

import uuid
from datetime import timedelta

from tests.test_sdd230_member_overview import (
    NOW, _client_user, _counselor, _db, _h, _link, _participant, _report, _session,
)
from tests.test_sdd230_org_admin_scope import (
    _admin, _class_session, _cls, _member, _org, _paths,
)


def _org_counselor(db, org, name="소속상담사", status_="active"):
    """기관에 소속된 상담사(헤더 포함)."""
    from app.models.user import User
    from app.services import membership_service

    c = _counselor(name)
    user = db.get(User, uuid.UUID(c["id"]))
    membership_service.add_membership(db, user, org.id, status_=status_, role="counselor")
    db.commit()
    return c


def _names(client, who, **params):
    res = client.get("/api/v1/clients", headers=_h(who), params=params).json()
    return {c["name"]: c["member_type"] for c in res["clients"]}, res["total"]


def test_l1_소속_상담사_연결_회원_포함_비회원(client):
    db = _db()
    org = _org(db)
    admin = _admin(db, org)
    cn = _org_counselor(db, org)
    m = _client_user(db, name="연결회원")
    _link(db, cn, m)
    names, total = _names(client, admin)
    assert names == {"연결회원": "non_member"} and total == 1
    for method, path in _paths(m.id):
        assert getattr(client, method)(path, headers=_h(admin)).status_code == 200, path
    det = client.get(f"/api/v1/clients/{m.id}", headers=_h(admin)).json()
    assert det["member_type"] == "non_member" and det["memo"] is None and det["memo_editable"] is False


def test_l2_비소속_탈퇴_초대_비활성_종료링크_개인상담소_제외(client):
    from app.models.user import User

    db = _db()
    org = _org(db)
    admin = _admin(db, org)
    outsider = _counselor("비소속")
    left = _org_counselor(db, org, "탈퇴상담사", status_="left")
    invited = _org_counselor(db, org, "초대상담사", status_="invited")
    inactive = _org_counselor(db, org, "비활성상담사")
    db.get(User, uuid.UUID(inactive["id"])).status = "suspended"
    ended = _org_counselor(db, org, "종료링크상담사")
    office = _org(db, "개인", kind="individual")
    solo = _org_counselor(db, office, "개인소속상담사")
    users = {}
    for key, cn, st in (("outsider", outsider, "active"), ("left", left, "active"), ("invited", invited, "active"),
                        ("inactive", inactive, "active"), ("ended", ended, "ended"), ("solo", solo, "active")):
        users[key] = _client_user(db, name=f"회원-{key}")
        _link(db, cn, users[key], status=st)
    db.commit()
    names, total = _names(client, admin)
    assert names == {} and total == 0
    for u in users.values():
        assert client.get(f"/api/v1/clients/{u.id}", headers=_h(admin)).status_code == 403
        assert client.post(f"/api/v1/clients/{u.id}/contact-reveal", headers=_h(admin)).status_code == 403


def test_l3_타기관_관리자_403(client):
    db = _db()
    org = _org(db)
    cn = _org_counselor(db, org)
    m = _client_user(db, name="연결회원")
    _link(db, cn, m)
    other = _admin(db, _org(db, "타기관"))
    assert _names(client, other) == ({}, 0)
    for method, path in _paths(m.id):
        assert getattr(client, method)(path, headers=_h(other)).status_code == 403, path


def test_l4_회원_라벨과_중복_제거(client):
    db = _db()
    org = _org(db)
    admin = _admin(db, org)
    cn = _org_counselor(db, org)
    cls = _cls(db, org, cn["id"])
    both = _client_user(db, name="클래스와연결")
    _member(db, cls, both)
    _link(db, cn, both)
    only_link = _client_user(db, name="연결만")
    _link(db, cn, only_link)
    from app.models.counseling import CounselingRelationship

    rel = _client_user(db, name="기관상담")
    db.add(CounselingRelationship(
        organization_id=org.id, organization_attribution_known=True,
        counselor_id=uuid.UUID(cn["id"]), client_user_id=rel.id, status="active",
    ))
    db.commit()
    names, total = _names(client, admin)
    assert names == {"클래스와연결": "member", "연결만": "non_member", "기관상담": "member"}
    assert total == 3


def test_l5_필터_total_일치_상담사는_null(client):
    db = _db()
    org = _org(db)
    admin = _admin(db, org)
    cn = _org_counselor(db, org)
    cls = _cls(db, org, cn["id"])
    a = _client_user(db, name="가회원")
    _member(db, cls, a)
    b = _client_user(db, name="나비회원")
    _link(db, cn, b)
    assert _names(client, admin, member_type="member") == ({"가회원": "member"}, 1)
    assert _names(client, admin, member_type="non_member") == ({"나비회원": "non_member"}, 1)
    assert _names(client, admin)[1] == 2
    assert client.get("/api/v1/clients", headers=_h(admin), params={"member_type": "x"}).status_code == 422
    names, total = _names(client, cn, member_type="member")  # 상담사: 필터 무시, 라벨 null
    assert names == {"나비회원": None} and total == 1


def test_l6_비회원도_상담기록_상담사용리포트_AI_메모_제외(client):
    from app.models.agent import AgentCheckin  # noqa: F401  (AI 안부는 상담사 개인 데이터)
    from app.models.client_counselor_link import ClientCounselorLink

    db = _db()
    org = _org(db)
    admin = _admin(db, org)
    cn = _org_counselor(db, org)
    m = _client_user(db, name="연결회원")
    _link(db, cn, m)
    link = db.query(ClientCounselorLink).filter(ClientCounselorLink.client_id == m.id).first()
    link.memo = "상담사 비공개 메모"
    # 상담사 본인 상담 세션(비공개 대상) + 상담사용 리포트
    s = _session(db, cn["id"], title="개인 상담", when=NOW - timedelta(days=1))
    s.type = "counseling"
    p = _participant(db, s, m, attendance_status="attended")
    _report(db, s, p, type_="counselor")
    # 기관 명상 클래스 세션 — 회원용만 읽고 상담사용은 제외
    cls = _cls(db, org, cn["id"])
    cs = _class_session(db, cls, cn["id"], when=NOW - timedelta(days=2), title="명상 회차")
    cp = _participant(db, cs, m, attendance_status="attended")
    _report(db, cs, cp, type_="client")
    _report(db, cs, cp, type_="counselor")
    db.commit()
    act = client.get(f"/api/v1/clients/{m.id}/activity", headers=_h(admin)).json()
    assert {i["title"] for i in act["items"]} == {"명상 회차"}
    reps = client.get(f"/api/v1/clients/{m.id}/reports", headers=_h(admin)).json()["reports"]
    assert [r["type"] for r in reps] == ["client"]
    det = client.get(f"/api/v1/clients/{m.id}", headers=_h(admin)).json()
    assert det["memo"] is None and "비공개" not in str(det)
    # 목록의 비회원 행에도 메모 필드는 없다
    assert "memo" not in client.get("/api/v1/clients", headers=_h(admin)).json()["clients"][0]


def test_l7_상담사_본인범위_불변_다중기관_합집합(client):
    db = _db()
    org1, org2, org3 = _org(db, "기관1"), _org(db, "기관2"), _org(db, "기관3")
    admin = _admin(db, org1, org2)
    c1, c2, c3 = _org_counselor(db, org1, "상담1"), _org_counselor(db, org2, "상담2"), _org_counselor(db, org3, "상담3")
    users = []
    for cn, n in ((c1, "일"), (c2, "이"), (c3, "삼")):
        u = _client_user(db, name=f"회원{n}")
        _link(db, cn, u)
        users.append(u)
    names, _ = _names(client, admin)
    assert set(names) == {"회원일", "회원이"}
    assert client.get(f"/api/v1/clients/{users[2].id}", headers=_h(admin)).status_code == 403
    # 같은 기관 다른 상담사 → 본인 연결 아니면 403
    assert _names(client, c2) == ({"회원이": None}, 1)  # 본인 연결 회원만
    assert client.get(f"/api/v1/clients/{users[0].id}", headers=_h(c2)).status_code == 403
