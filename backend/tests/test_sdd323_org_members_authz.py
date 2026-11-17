"""SDD-323 — 기관 구성원 관리 권한 매트릭스·보호 조건·목록 보강 (verify.md V1~V14, E1~E28 중 BE).

모든 시나리오는 직접 HTTP 호출로 검증하고, 거절 시 DB 불변(역할·상태·대표·버전·감사 건수)을 함께 확인한다.
메일은 발송 대역(monkeypatch)으로 가로채며 실제 발송은 없다.
"""

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import event

from app.core.database import get_db
from app.core.security import create_access_token
from app.main import app
from app.models.credential import VerificationAudit
from app.models.organization import Organization
from app.models.session import Session as CounselingSession
from app.models.user import User
from app.models.user_org_membership import UserOrgMembership


def _h(user):
    return {"Authorization": f"Bearer {create_access_token(subject=str(user.id))}"}


def _mk_user(db, tag, role, org=None, status="active"):
    user = User(
        name=f"{tag}", email=f"{tag}@t323.com", password_hash="x", role=role,
        org_id=org.id if org is not None else None, status=status,
    )
    db.add(user)
    db.flush()
    return user


def _mk_member(db, user, org, role, status="active", primary=True):
    db.add(UserOrgMembership(
        user_id=user.id, org_id=org.id, role=role, status=status, is_primary=primary and status == "active",
        joined_at=datetime.now(timezone.utc) if status == "active" else None,
    ))
    db.flush()


@pytest.fixture
def world(client, monkeypatch):
    """P=대표, A=일반 관리자, C=코치, C2=코치, X=타 기관 관리자, S=플랫폼 관리자."""
    db = next(app.dependency_overrides[get_db]())
    org = Organization(name="구성원센터", org_code="M32301", verified=True)
    org2 = Organization(name="타센터", org_code="M32302", verified=True)
    db.add_all([org, org2])
    db.flush()
    P = _mk_user(db, "p", "org_admin", org)
    A = _mk_user(db, "a", "org_admin", org)
    C = _mk_user(db, "c", "counselor", org)
    C2 = _mk_user(db, "c2", "counselor", org)
    X = _mk_user(db, "x", "org_admin", org2)
    S = _mk_user(db, "s", "platform_admin")
    for u, r in ((P, "org_admin"), (A, "org_admin"), (C, "counselor"), (C2, "counselor")):
        _mk_member(db, u, org, r)
    _mk_member(db, X, org2, "org_admin")
    org.primary_admin_id = P.id
    org2.primary_admin_id = X.id
    db.commit()
    ctx = {"db": db, "org": org, "org2": org2, "P": P, "A": A, "C": C, "C2": C2, "X": X, "S": S}
    yield ctx
    db.close()


def _snap(w):
    db = w["db"]
    db.expire_all()
    return {
        "memberships": sorted(
            (str(m.user_id), m.role, m.status) for m in db.query(UserOrgMembership).all()
        ),
        "users": sorted((str(u.id), u.role, u.status, str(u.org_id)) for u in db.query(User).all()),
        "orgs": sorted((str(o.id), str(o.primary_admin_id), o.version) for o in db.query(Organization).all()),
        "audits": db.query(VerificationAudit).count(),
    }


def _url(w, tail=""):
    return f"/api/v1/org/{w['org'].id}{tail}"


def _role_put(client, w, actor, target, role, reason="운영 조정"):
    body = {"role": role}
    if reason is not None:
        body["reason"] = reason
    return client.put(_url(w, f"/counselors/{target.id}"), json=body, headers=_h(actor))


def _delete(client, w, actor, target, reason="소속 정리"):
    body = {"reason": reason} if reason is not None else {}
    return client.request("DELETE", _url(w, f"/counselors/{target.id}"), json=body, headers=_h(actor))


# ---------------------------------------------------------------- V6 / V5: 해지
def test_v5_코치_해지는_대표_일반_모두_가능(client, world):
    for actor, target in ((world["P"], world["C"]), (world["A"], world["C2"])):
        res = _delete(client, world, actor, target)
        assert res.status_code == 204, res.text
    world["db"].expire_all()
    left = {m.status for m in world["db"].query(UserOrgMembership).filter(
        UserOrgMembership.user_id.in_([world["C"].id, world["C2"].id]),
        UserOrgMembership.org_id == world["org"].id)}
    assert left == {"left"}
    assert world["db"].query(VerificationAudit).filter_by(action="org_counselor_removed").count() == 2


def test_v6_관리자_해지는_일반관리자_403_대표_204(client, world):
    admin2 = _mk_user(world["db"], "a2", "org_admin", world["org"])
    _mk_member(world["db"], admin2, world["org"], "org_admin")
    world["db"].commit()
    before = _snap(world)
    res = _delete(client, world, world["A"], admin2)
    assert res.status_code == 403 and res.json()["code"] == "PRIMARY_ADMIN_REQUIRED"
    assert isinstance(res.json()["detail"], str)
    assert _snap(world) == before
    assert _delete(client, world, world["P"], admin2).status_code == 204


def test_v5_코치_X_타기관_해지는_403(client, world):
    before = _snap(world)
    res = _delete(client, world, world["X"], world["C"])
    assert res.status_code == 403 and res.json()["code"] == "ORG_ADMIN_REQUIRED"
    res = _delete(client, world, world["C"], world["C2"])
    assert res.status_code == 403 and res.json()["code"] == "ORG_ADMIN_REQUIRED"
    assert _snap(world) == before


def test_v5_플랫폼_관리자_해지_가능(client, world):
    res = _delete(client, world, world["S"], world["C"])
    assert res.status_code == 204, res.text


# ---------------------------------------------------------------- V7 / V8: 승격·회수
def test_v7_승격은_대표만(client, world):
    before = _snap(world)
    res = _role_put(client, world, world["A"], world["C"], "org_admin")
    assert res.status_code == 403 and res.json()["code"] == "PRIMARY_ADMIN_REQUIRED"
    assert _snap(world) == before
    res = _role_put(client, world, world["P"], world["C"], "org_admin")
    assert res.status_code == 200, res.text
    assert res.json()["role"] == "org_admin"
    assert world["db"].query(VerificationAudit).filter_by(action="org_counselor_role_changed").count() == 1


def test_v8_회수는_대표만_회수뒤_다음요청부터_403(client, world):
    before = _snap(world)
    res = _role_put(client, world, world["A"], world["P"], "counselor")
    assert res.status_code == 403 and res.json()["code"] == "PRIMARY_ADMIN_REQUIRED"
    assert _snap(world) == before
    res = _role_put(client, world, world["P"], world["A"], "counselor")
    assert res.status_code == 200, res.text
    assert client.get(_url(world, "/counselors"), headers=_h(world["A"])).status_code == 403


def test_v7_승격_코치_타기관_플랫폼(client, world):
    assert _role_put(client, world, world["C"], world["C2"], "org_admin").status_code == 403
    assert _role_put(client, world, world["X"], world["C"], "org_admin").status_code == 403
    assert _role_put(client, world, world["S"], world["C"], "org_admin").status_code == 200


# ---------------------------------------------------------------- V9: 대표 이전
def _transfer(client, w, actor, target, *, expected=None, version="auto", reason="인수인계"):
    org = w["org"]
    w["db"].refresh(org)
    headers = _h(actor)
    if version == "auto":
        headers["If-Match"] = str(org.version)
    elif version is not None:
        headers["If-Match"] = str(version)
    body = {
        "target_user_id": str(target.id),
        "expected_primary_admin_id": str(expected or org.primary_admin_id),
    }
    if reason is not None:
        body["reason"] = reason
    return client.put(_url(w, "/primary-admin"), json=body, headers=headers)


def test_v9_E12_E13_대표이전_성공과_직후_권한(client, world):
    ver = world["org"].version
    res = _transfer(client, world, world["P"], world["A"])
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["primary_admin_id"] == str(world["A"].id) and body["version"] == ver + 1
    world["db"].expire_all()
    p_membership = world["db"].query(UserOrgMembership).filter_by(user_id=world["P"].id, org_id=world["org"].id).one()
    assert p_membership.role == "org_admin" and p_membership.status == "active"
    assert world["db"].query(VerificationAudit).filter_by(action="org_primary_admin_transferred").count() == 1
    from app.models.notification import Notification

    assert world["db"].query(Notification).filter(
        Notification.user_id.in_([world["P"].id, world["A"].id])).count() == 2
    # E13: 이전 직후 P 는 일반 관리자 → 승격/이전 403
    assert _role_put(client, world, world["P"], world["C"], "org_admin").status_code == 403
    res = _transfer(client, world, world["P"], world["P"], expected=world["A"].id)
    assert res.status_code == 403 and res.json()["code"] == "PRIMARY_ADMIN_REQUIRED"


def test_v9_일반관리자_코치_타기관_플랫폼_403(client, world):
    before = _snap(world)
    for actor, code in (
        (world["A"], "PRIMARY_ADMIN_REQUIRED"),
        (world["C"], "ORG_ADMIN_REQUIRED"),
        (world["X"], "ORG_ADMIN_REQUIRED"),
    ):
        res = _transfer(client, world, actor, world["A"])
        assert res.status_code == 403 and res.json()["code"] == code, (actor.email, res.text)
    # 플랫폼 관리자용 라우트는 이번 범위 제외 — 기관 경로에서도 403(대표 아님)
    assert _transfer(client, world, world["S"], world["A"]).status_code == 403
    assert _snap(world) == before


def test_E10_대표이전_대상_검증(client, world):
    db = world["db"]
    inv = _mk_user(db, "inv", "org_admin", world["org"], status="pending")
    _mk_member(db, inv, world["org"], "org_admin", status="invited")
    sus = _mk_user(db, "sus", "org_admin", world["org"], status="suspended")
    _mk_member(db, sus, world["org"], "org_admin")
    db.commit()
    before = _snap(world)
    for target in (inv, sus, world["C"], world["P"]):
        res = _transfer(client, world, world["P"], target)
        assert res.status_code == 409 and res.json()["code"] == "INVALID_TRANSFER_TARGET", (target.email, res.text)
    res = _transfer(client, world, world["P"], world["X"])
    assert res.status_code == 404 and res.json()["code"] == "MEMBER_NOT_FOUND"
    assert _snap(world) == before


def test_E11_대표이전_버전_검증(client, world):
    before = _snap(world)
    res = _transfer(client, world, world["P"], world["A"], version=None)
    assert res.status_code == 428 and res.json()["code"] == "VERSION_REQUIRED"
    res = _transfer(client, world, world["P"], world["A"], version=world["org"].version + 5)
    assert res.status_code == 412 and res.json()["code"] == "VERSION_MISMATCH"
    res = _transfer(client, world, world["P"], world["A"], expected=world["A"].id)
    assert res.status_code == 409 and res.json()["code"] == "PRIMARY_CHANGED"
    assert _snap(world) == before


def test_E24_대표이전_사유_필수(client, world):
    before = _snap(world)
    for reason in (None, "   "):
        res = _transfer(client, world, world["P"], world["A"], reason=reason)
        assert res.status_code == 422 and res.json()["code"] == "REASON_REQUIRED"
    assert _snap(world) == before


# ---------------------------------------------------------------- V10 / V11: 정지·재활성
@pytest.mark.parametrize("actor_key", ["P", "A", "C", "X"])
@pytest.mark.parametrize("path", ["suspend", "unsuspend"])
def test_v10_v11_정지_재활성은_기관경로_전원_403(client, world, actor_key, path):
    before = _snap(world)
    res = client.post(
        _url(world, f"/counselors/{world['C2'].id}/{path}"),
        json={"reason": "근태"}, headers=_h(world[actor_key]),
    )
    assert res.status_code == 403, res.text
    if actor_key in ("P", "A"):
        assert res.json()["code"] == "ORG_STATUS_PLATFORM_ONLY"
    assert _snap(world) == before


def test_v10_플랫폼_정지는_admin_경로로_가능(client, world):
    res = client.post(
        f"/api/v1/admin/users/{world['C2'].id}/suspend", json={"reason": "점검"}, headers=_h(world["S"])
    )
    assert res.status_code == 200, res.text
    res = client.post(f"/api/v1/admin/users/{world['C2'].id}/unsuspend", headers=_h(world["S"]))
    assert res.status_code == 200, res.text


# ---------------------------------------------------------------- V12~V14
def test_v12_개인정보_수정은_대표_일반만(client, world):
    for actor, expect in ((world["P"], 200), (world["A"], 200), (world["C2"], 403), (world["X"], 403), (world["S"], 403)):
        res = client.patch(
            _url(world, f"/counselors/{world['C'].id}/profile"),
            json={"reason": "정정", "phone": "010-0000-0000"}, headers=_h(actor),
        )
        assert res.status_code == expect, (actor.email, res.text)


def _join_request(world, email="req@t323.com"):
    from app.models.org_join_request import OrganizationJoinRequest

    db = world["db"]
    u = _mk_user(db, "req", "counselor")
    req = OrganizationJoinRequest(user_id=u.id, org_id=world["org"].id, status="pending")
    db.add(req)
    db.commit()
    return u, req


def test_v13_E25_가입요청_처리_권한과_재처리(client, world):
    _, req = _join_request(world)
    url = _url(world, f"/requests/{req.id}")
    assert client.get(_url(world, "/requests"), headers=_h(world["C"])).status_code == 403
    assert client.get(_url(world, "/requests"), headers=_h(world["X"])).status_code == 403
    assert client.get(_url(world, "/requests"), headers=_h(world["A"])).status_code == 200
    res = client.put(url, json={"status": "rejected"}, headers=_h(world["A"]))
    assert res.status_code == 422 and res.json()["code"] == "REASON_REQUIRED"
    res = client.put(url, json={"status": "rejected", "reason": "정원 초과"}, headers=_h(world["A"]))
    assert res.status_code == 200, res.text
    res = client.put(url, json={"status": "approved"}, headers=_h(world["P"]))
    assert res.status_code == 409
    assert client.put(url, json={"status": "approved"}, headers=_h(world["X"])).status_code == 403
    # 타 기관 관리자 X 가 자기 기관 경로로 이 요청 처리 → 404
    res = client.put(f"/api/v1/org/{world['org2'].id}/requests/{req.id}", json={"status": "approved"}, headers=_h(world["X"]))
    assert res.status_code == 404


def test_v14_구성원_목록_활동_조회_권한(client, world):
    for actor, expect in ((world["P"], 200), (world["A"], 200), (world["S"], 200), (world["C"], 403), (world["X"], 403)):
        assert client.get(_url(world, "/counselors"), headers=_h(actor)).status_code == expect, actor.email
        res = client.get(_url(world, f"/counselors/{world['C'].id}/activity"), headers=_h(actor))
        assert res.status_code == expect, (actor.email, res.text)


# ---------------------------------------------------------------- V1~V4: 초대
@pytest.fixture
def mail(monkeypatch):
    sent = []

    def _fake(*args, **kwargs):
        sent.append((args, kwargs))
        return True

    for name in ("send_org_invite_email", "send_counselor_invite_email", "send_membership_invite_email"):
        monkeypatch.setattr(f"app.services.org_invite_service.{name}", _fake)
    return sent


def _clear_cd(redis, org_id):
    import asyncio

    asyncio.run(redis.delete(f"counselor_invite_send:{org_id}", f"counselor_invite_resend:{org_id}"))


@pytest.mark.parametrize("role", ["counselor", "org_admin"])
def test_v1_v2_초대는_대표_일반_플랫폼_허용_코치_타기관_403(client, world, mail, redis, role):
    n = 0
    for actor, expect in ((world["P"], 201), (world["A"], 201), (world["S"], 201), (world["C"], 403), (world["X"], 403)):
        _clear_cd(redis, world["org"].id)
        n += 1
        res = client.post(
            _url(world, "/counselors/invite"),
            json={"name": "신규", "email": f"inv{n}{role}@t323.com", "role": role}, headers=_h(actor),
        )
        assert res.status_code == expect, (actor.email, res.text)
        if expect == 201:
            assert res.json()["counselor"]["role"] == role


def test_v3_v4_재초대_권한과_E20_쿨다운(client, world, mail, redis):
    _clear_cd(redis, world["org"].id)
    res = client.post(
        _url(world, "/counselors/invite"),
        json={"name": "대기", "email": "wait@t323.com", "role": "org_admin"}, headers=_h(world["A"]),
    )
    assert res.status_code == 201
    target_id = res.json()["counselor"]["id"]
    for actor in (world["C"], world["X"]):
        assert client.post(_url(world, f"/counselors/{target_id}/resend-invite"), headers=_h(actor)).status_code == 403
    _clear_cd(redis, world["org"].id)
    assert client.post(_url(world, f"/counselors/{target_id}/resend-invite"), headers=_h(world["P"])).status_code == 200
    res = client.post(_url(world, f"/counselors/{target_id}/resend-invite"), headers=_h(world["A"]))
    assert res.status_code == 429
    body = res.json()
    assert body["code"] == "INVITE_COOLDOWN" and 0 < body["retry_after_sec"] <= 60


def test_E22_초대응답이_기존계정_여부를_구분하지_않음(client, world, mail, redis):
    _clear_cd(redis, world["org"].id)
    new = client.post(_url(world, "/counselors/invite"), json={"name": "새로", "email": "brandnew@t323.com"}, headers=_h(world["P"]))
    other = _mk_user(world["db"], "exist", "counselor", world["org2"])
    _mk_member(world["db"], other, world["org2"], "counselor")
    world["db"].commit()
    _clear_cd(redis, world["org"].id)
    old = client.post(_url(world, "/counselors/invite"), json={"name": "기존", "email": other.email}, headers=_h(world["P"]))
    assert new.status_code == old.status_code == 201
    assert set(new.json().keys()) == set(old.json().keys())
    assert set(new.json()["counselor"].keys()) == set(old.json()["counselor"].keys())


# ---------------------------------------------------------------- E 시나리오
def test_E1_E4_마지막관리자_대표_보호(client, world):
    # 대표 P 와 A 가 있으나, 대표 해지/회수는 항상 CANNOT_TARGET_PRIMARY
    before = _snap(world)
    res = _delete(client, world, world["S"], world["P"])
    assert res.status_code == 409 and res.json()["code"] == "CANNOT_TARGET_PRIMARY"
    res = _role_put(client, world, world["S"], world["P"], "counselor")
    assert res.status_code == 409 and res.json()["code"] == "CANNOT_TARGET_PRIMARY"
    assert _snap(world) == before


def test_E2_E3_자기자신_해지_회수(client, world):
    before = _snap(world)
    res = _delete(client, world, world["P"], world["P"])
    assert res.status_code == 409 and res.json()["code"] == "CANNOT_TARGET_SELF"
    res = _role_put(client, world, world["P"], world["P"], "counselor")
    assert res.status_code == 409 and res.json()["code"] == "CANNOT_TARGET_SELF"
    res = _delete(client, world, world["A"], world["A"])
    assert res.status_code in (403, 409)
    assert _snap(world) == before


def test_E6_초대대기_관리자는_활성으로_세지_않음(client, world):
    db = world["db"]
    # A 를 초대 대기 관리자로 바꾸고, 다른 활성 관리자는 대표 P 하나 → 이 상황에서 활성 관리자 B 해지는 LAST_ADMIN
    m = db.query(UserOrgMembership).filter_by(user_id=world["A"].id, org_id=world["org"].id).one()
    m.status, m.is_primary = "invited", False
    # 대표를 제외한 활성 관리자 B 하나를 만들고, 대표 P 는 비활성(정지) 처리해 B 가 마지막이 되게 한다
    B = _mk_user(db, "b", "org_admin", world["org"])
    _mk_member(db, B, world["org"], "org_admin")
    world["P"].status = "suspended"
    db.commit()
    res = _delete(client, world, world["S"], B)
    assert res.status_code == 409 and res.json()["code"] == "LAST_ADMIN", res.text


def test_E7_다기관_코치_승격은_타기관_membership_불변(client, world):
    db = world["db"]
    M = _mk_user(db, "m", "counselor", world["org"])
    _mk_member(db, M, world["org"], "counselor")
    _mk_member(db, M, world["org2"], "counselor", primary=False)
    db.commit()
    res = _role_put(client, world, world["P"], M, "org_admin")
    assert res.status_code == 200
    db.expire_all()
    other = db.query(UserOrgMembership).filter_by(user_id=M.id, org_id=world["org2"].id).one()
    assert other.role == "counselor" and other.status == "active"


def test_E8_E9_타기관_접근은_404_존재비노출(client, world):
    db = world["db"]
    Z = _mk_user(db, "z", "counselor", world["org2"])
    _mk_member(db, Z, world["org2"], "counselor")
    db.commit()
    for res in (
        client.get(_url(world, f"/counselors/{Z.id}/activity"), headers=_h(world["P"])),
        _role_put(client, world, world["P"], Z, "org_admin"),
        _delete(client, world, world["P"], Z),
    ):
        assert res.status_code == 404 and res.json()["code"] == "MEMBER_NOT_FOUND", res.text


def test_E8_활동조회는_이_기관_세션만(client, world):
    db = world["db"]
    M = _mk_user(db, "m2", "counselor", world["org"])
    _mk_member(db, M, world["org"], "counselor")
    _mk_member(db, M, world["org2"], "counselor", primary=False)
    mine = CounselingSession(host_id=M.id, type="clinical", duration_min=30, status="completed", title="이기관",
                             organization_id=world["org"].id, organization_attribution_known=True)
    theirs = CounselingSession(host_id=M.id, type="clinical", duration_min=30, status="completed", title="타기관비밀",
                               organization_id=world["org2"].id, organization_attribution_known=True)
    db.add_all([mine, theirs])
    db.commit()
    res = client.get(_url(world, f"/counselors/{M.id}/activity"), headers=_h(world["A"]))
    assert res.status_code == 200
    titles = [s["title"] for s in res.json()["sessions"]]
    assert titles == ["이기관"]
    assert "타기관비밀" not in res.text
    assert res.json()["classes"] == [] and res.json()["client_count"] == 0


def test_E14_개인기관_소유자_보호(client, world):
    db = world["db"]
    owner = _mk_user(db, "owner", "counselor")
    office = Organization(name="개인소", org_code="M32399", kind="individual", verified=True)
    db.add(office)
    db.flush()
    office.owner_user_id = owner.id
    office.primary_admin_id = owner.id
    owner.org_id = office.id
    _mk_member(db, owner, office, "org_admin")
    db.commit()
    res = client.request("DELETE", f"/api/v1/org/{office.id}/counselors/{owner.id}", json={"reason": "x"}, headers=_h(world["S"]))
    assert res.status_code == 409 and res.json()["code"] == "INDIVIDUAL_ORG_OWNER"


def test_E16_E18_진행세션_활성연결_해지_차단(client, world):
    from app.models.client_counselor_link import ClientCounselorLink

    db = world["db"]
    db.add(CounselingSession(host_id=world["C"].id, type="clinical", duration_min=30, status="scheduled",
                             organization_id=world["org"].id, organization_attribution_known=True))
    client_user = _mk_user(db, "cl", "client", world["org"])
    db.add(ClientCounselorLink(client_id=client_user.id, counselor_id=world["C2"].id, status="active"))
    db.commit()
    before = _snap(world)
    for target in (world["C"], world["C2"]):
        res = _delete(client, world, world["P"], target)
        assert res.status_code == 409 and res.json()["code"] == "MEMBER_HAS_ACTIVE_WORK", res.text
    assert _snap(world) == before


def test_E17_타기관_세션은_현재기관_해지를_막지_않음(client, world):
    db = world["db"]
    M = _mk_user(db, "m3", "counselor", world["org"])
    _mk_member(db, M, world["org"], "counselor")
    _mk_member(db, M, world["org2"], "counselor", primary=False)
    db.add(CounselingSession(host_id=M.id, type="clinical", duration_min=30, status="scheduled",
                             organization_id=world["org2"].id, organization_attribution_known=True))
    db.commit()
    assert _delete(client, world, world["P"], M).status_code == 204


def test_E23_초대대기_대상_역할변경_불가(client, world):
    db = world["db"]
    inv = _mk_user(db, "inv2", "counselor", world["org"], status="pending")
    _mk_member(db, inv, world["org"], "counselor", status="invited")
    db.commit()
    before = _snap(world)
    res = _role_put(client, world, world["P"], inv, "org_admin")
    assert res.status_code == 409
    assert _snap(world) == before


def test_E24_사유_공백_누락(client, world):
    before = _snap(world)
    for r in (None, "  "):
        res = _role_put(client, world, world["P"], world["C"], "org_admin", reason=r)
        assert res.status_code == 422 and res.json()["code"] == "REASON_REQUIRED"
        res = _delete(client, world, world["P"], world["C"], reason=r)
        assert res.status_code == 422 and res.json()["code"] == "REASON_REQUIRED"
    res = client.delete(_url(world, f"/counselors/{world['C'].id}"), headers=_h(world["P"]))
    assert res.status_code == 422 and res.json()["code"] == "REASON_REQUIRED"
    assert _snap(world) == before


def test_E26_비활성_기관_변경_409(client, world):
    world["org"].deactivated_at = datetime.now(timezone.utc)
    world["db"].commit()
    assert _role_put(client, world, world["P"], world["C"], "org_admin").status_code == 409
    assert _delete(client, world, world["P"], world["C"]).status_code == 409


def test_E27_정지_계정_코치도_소속해지_가능(client, world):
    world["C"].status = "suspended"
    world["db"].commit()
    assert _delete(client, world, world["P"], world["C"]).status_code == 204
    world["db"].expire_all()
    assert world["db"].get(User, world["C"].id).status == "suspended"


def test_E28_중복_제출은_한건만_반영(client, world):
    assert _delete(client, world, world["P"], world["C"]).status_code == 204
    assert _delete(client, world, world["P"], world["C"]).status_code == 404
    assert world["db"].query(VerificationAudit).filter_by(action="org_counselor_removed").count() == 1


def test_정지된_관리자_요청은_차단(client, world):
    world["A"].status = "suspended"
    world["db"].commit()
    assert _role_put(client, world, world["A"], world["C"], "org_admin").status_code in (401, 403)


# ---------------------------------------------------------------- V-LIST
def test_vlist_목록_보강필드와_allowed_actions(client, world):
    db = world["db"]
    inv = _mk_user(db, "inv3", "counselor", world["org"], status="pending")
    _mk_member(db, inv, world["org"], "counselor", status="invited")
    db.add(CounselingSession(host_id=world["C"].id, type="clinical", duration_min=30, status="completed",
                             organization_id=world["org"].id, organization_attribution_known=True,
                             started_at=datetime(2026, 11, 1, tzinfo=timezone.utc)))
    db.commit()

    def rows(actor):
        res = client.get(_url(world, "/counselors"), headers=_h(actor))
        assert res.status_code == 200, res.text
        return {r["email"]: r for r in res.json()}

    by_p = rows(world["P"])
    for r in by_p.values():
        for key in ("is_primary_admin", "membership_status", "account_status", "is_self", "class_count",
                    "last_activity_at", "allowed_actions", "blocked_reasons"):
            assert key in r
        assert not {"suspend", "unsuspend"} & set(r["allowed_actions"])
    p_row, a_row, c_row = by_p["p@t323.com"], by_p["a@t323.com"], by_p["c@t323.com"]
    assert p_row["is_primary_admin"] and p_row["is_self"]
    assert "remove" not in p_row["allowed_actions"] and "revoke_admin" not in p_row["allowed_actions"]
    assert {"revoke_admin", "remove", "transfer_primary"} <= set(a_row["allowed_actions"])
    assert {"promote", "remove", "edit_profile"} <= set(c_row["allowed_actions"])
    assert c_row["last_activity_at"].startswith("2026-11-01") and c_row["class_count"] == 0
    assert by_p["c2@t323.com"]["last_activity_at"] is None
    assert by_p[inv.email]["membership_status"] == "invited" and "resend_invite" in by_p[inv.email]["allowed_actions"]
    assert by_p[inv.email]["account_status"] == "pending"

    by_a = rows(world["A"])
    assert not {"promote", "revoke_admin", "transfer_primary"} & set(by_a["c@t323.com"]["allowed_actions"])
    assert "remove" in by_a["c@t323.com"]["allowed_actions"]
    assert "remove" not in by_a["p@t323.com"]["allowed_actions"]
    assert "remove" not in by_a["a@t323.com"]["allowed_actions"]  # 자기 자신
    # 정지/재활성은 어떤 요청자에도 없다 + 필터
    res = client.get(_url(world, "/counselors?role=org_admin"), headers=_h(world["P"]))
    assert {r["role"] for r in res.json()} == {"org_admin"}
    res = client.get(_url(world, "/counselors?status=invited"), headers=_h(world["P"]))
    assert [r["email"] for r in res.json()] == [inv.email]


def test_vlist_blocked_reasons_진행작업(client, world):
    world["db"].add(CounselingSession(host_id=world["C"].id, type="clinical", duration_min=30, status="in_progress",
                                      organization_id=world["org"].id, organization_attribution_known=True))
    world["db"].commit()
    res = client.get(_url(world, "/counselors"), headers=_h(world["P"]))
    row = next(r for r in res.json() if r["email"] == "c@t323.com")
    assert row["blocked_reasons"].get("remove") == "MEMBER_HAS_ACTIVE_WORK"


def test_vlist_allowed_actions와_서버판정_교차검증(client, world):
    """allowed_actions 에 없는 행동은 403/409, 있는 행동은 403 이 아니다(요청자 P/A × 코치/관리자 대상)."""
    db = world["db"]
    admin2 = _mk_user(db, "a3", "org_admin", world["org"])
    _mk_member(db, admin2, world["org"], "org_admin")
    db.commit()
    for actor in (world["P"], world["A"]):
        res = client.get(_url(world, "/counselors"), headers=_h(actor))
        rows = {r["email"]: r for r in res.json()}
        for target in (world["C"], admin2):
            allowed = set(rows[target.email]["allowed_actions"])
            # 승격/회수(PUT) — 대표만
            promote = _role_put(client, world, actor, target, "counselor" if target is admin2 else "org_admin")
            wanted = "revoke_admin" if target is admin2 else "promote"
            if wanted in allowed:
                assert promote.status_code != 403, (actor.email, target.email, promote.text)
            else:
                assert promote.status_code in (403, 409), (actor.email, target.email, promote.text)
            # 원복
            if promote.status_code == 200:
                _role_put(client, world, actor, target, "org_admin" if target is admin2 else "counselor")


def test_vlist_쿼리수가_인원수와_무관(client, world):
    db = world["db"]
    engine = db.get_bind()
    counter = {"n": 0}

    def _count(conn, cursor, statement, params, context, executemany):
        if statement.lstrip().upper().startswith("SELECT"):
            counter["n"] += 1

    def run():
        counter["n"] = 0
        event.listen(engine, "before_cursor_execute", _count)
        try:
            assert client.get(_url(world, "/counselors"), headers=_h(world["P"])).status_code == 200
        finally:
            event.remove(engine, "before_cursor_execute", _count)
        return counter["n"]

    small = run()
    for i in range(30):
        u = _mk_user(db, f"bulk{i}", "counselor", world["org"])
        _mk_member(db, u, world["org"], "counselor")
    db.commit()
    large = run()
    assert large - small <= 2, (small, large)


def test_목록_ETag가_대표이전_If_Match와_호환(client, world):
    res = client.get(_url(world, "/counselors"), headers=_h(world["P"]))
    etag = res.headers["ETag"]
    assert etag == f'"{world["org"].version}"'
    body = {"target_user_id": str(world["A"].id), "expected_primary_admin_id": str(world["P"].id), "reason": "인수인계"}
    res = client.put(_url(world, "/primary-admin"), json=body, headers={**_h(world["P"]), "If-Match": etag})
    assert res.status_code == 200, res.text
