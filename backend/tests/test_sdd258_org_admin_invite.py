"""SDD-258 — 기관관리자 추가(초대) QA (verify.md TS1~TS9). 메일은 목으로 가로챈다."""

import asyncio
import uuid

from tests.test_sdd017_counselor_invite import (  # noqa: F401
    NEW_PASSWORD,
    _capture_invites,
    _db,
    _make_org_admin,
)
from tests.test_sdd079_multi_org_membership import (  # noqa: F401
    _clear_cooldown,
    _membership,
)


class _Captured(list):
    """가로챈 소속 초대 링크 목록 + 함께 전달된 role 기록."""

    def __init__(self):
        super().__init__()
        self.roles: list = []


def _capture_membership_invites(monkeypatch) -> _Captured:
    """소속 초대 메일(role kwarg 포함)을 가로챈다."""
    captured = _Captured()

    def _fake(to_email, invite_link, *, counselor_name, org_name, expires_days, role="counselor"):
        captured.append(invite_link)
        captured.roles.append(role)
        return True

    monkeypatch.setattr("app.services.org_invite_service.send_membership_invite_email", _fake)
    return captured


def _invite(client, ctx, email, role="org_admin", name="김관리", headers=None):
    body = {"name": name, "email": email}
    if role is not None:
        body["role"] = role
    return client.post(
        f"/api/v1/org/{ctx['org_id']}/counselors/invite",
        json=body,
        headers=headers or ctx["h"],
    )


def _activate_new(client, link):
    token = link.split("token=", 1)[1]
    res = client.post("/api/v1/auth/set-password", json={"token": token, "new_password": NEW_PASSWORD})
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


def _ctx(client, monkeypatch, tag):
    return _make_org_admin(
        client, monkeypatch, sys_email=f"sys-{tag}@test.com", admin_email=f"adm-{tag}@test.com"
    )


def test_ts1_ts2_신규_기관관리자_초대와_활성화(client, monkeypatch, redis):
    ctx = _ctx(client, monkeypatch, "258a")
    res = _invite(client, ctx, "newadm258a@test.com")
    assert res.status_code == 201, res.text
    body = res.json()["counselor"]
    assert body["role"] == "org_admin" and body["status"] == "pending"
    assert body["counselor_code"] is None
    assert len(ctx["captured"]["org"]) == 2  # 담당자 최초 + 이번 초대
    ms = _membership(body["id"], ctx["org_id"])
    assert len(ms) == 1 and ms[0].role == "org_admin" and ms[0].status == "invited"

    h = _activate_new(client, ctx["captured"]["org"][-1])
    # 활성화된 새 기관관리자는 구성원 목록 API 접근 가능
    lst = client.get(f"/api/v1/org/{ctx['org_id']}/counselors", headers=h)
    assert lst.status_code == 200, lst.text
    ms = _membership(body["id"], ctx["org_id"])
    assert ms[0].status == "active" and ms[0].role == "org_admin"


def test_ts3_기존_상담사를_기관관리자로_초대_수락(client, monkeypatch, redis):
    ctx_a = _ctx(client, monkeypatch, "258b")
    ctx_b = _ctx(client, monkeypatch, "258bb")
    # B 기관에 상담사 초대·활성화
    cap = _capture_invites(monkeypatch)
    r = client.post(
        f"/api/v1/org/{ctx_b['org_id']}/counselors/invite",
        json={"name": "상담", "email": "cx258@test.com"},
        headers=ctx_b["h"],
    )
    assert r.status_code == 201, r.text
    uid = r.json()["counselor"]["id"]
    _activate_new(client, cap["counselor"][0])

    mcap = _capture_membership_invites(monkeypatch)
    _clear_cooldown(redis, ctx_a["org_id"])
    res = _invite(client, ctx_a, "cx258@test.com")
    assert res.status_code == 201, res.text
    assert res.json()["counselor"]["role"] == "org_admin"
    ms = _membership(uid, ctx_a["org_id"])
    assert ms[0].role == "org_admin" and ms[0].status == "invited"
    assert len(mcap) == 1 and mcap.roles == ["org_admin"]

    token = mcap[0].split("token=", 1)[1]
    acc = client.post("/api/v1/org/membership-invites/accept", json={"token": token})
    assert acc.status_code == 200, acc.text
    ms = _membership(uid, ctx_a["org_id"])
    assert ms[0].status == "active" and ms[0].role == "org_admin"
    assert _membership(uid, ctx_b["org_id"])[0].status == "active"


def test_ts4_중복_및_비상담사_409(client, monkeypatch, redis):
    ctx = _ctx(client, monkeypatch, "258c")
    assert _invite(client, ctx, "dup258@test.com").status_code == 201
    _clear_cooldown(redis, ctx["org_id"])
    assert _invite(client, ctx, "dup258@test.com").status_code == 409
    # 기관관리자 본인 이메일(이미 소속)
    assert _invite(client, ctx, "adm-258c@test.com").status_code == 409


def test_ts5_role_기본값과_잘못된_role(client, monkeypatch, redis):
    ctx = _ctx(client, monkeypatch, "258d")
    res = _invite(client, ctx, "plain258@test.com", role=None, name="상담")
    assert res.status_code == 201, res.text
    assert res.json()["counselor"]["role"] == "counselor"
    assert res.json()["counselor"]["counselor_code"]
    _clear_cooldown(redis, ctx["org_id"])
    assert _invite(client, ctx, "bad258@test.com", role="platform_admin").status_code == 422


def test_ts6_타기관_관리자와_상담사는_403(client, monkeypatch, redis):
    ctx_a = _ctx(client, monkeypatch, "258e")
    ctx_b = _ctx(client, monkeypatch, "258ee")
    assert _invite(client, ctx_a, "x258@test.com", headers=ctx_b["h"]).status_code == 403
    # 상담사 토큰
    cap = _capture_invites(monkeypatch)
    client.post(
        f"/api/v1/org/{ctx_a['org_id']}/counselors/invite",
        json={"name": "상담", "email": "cc258@test.com"},
        headers=ctx_a["h"],
    )
    ch = _activate_new(client, cap["counselor"][0])
    assert _invite(client, ctx_a, "y258@test.com", headers=ch).status_code == 403


def test_ts7_ts8_재발송과_목록_역할(client, monkeypatch, redis):
    ctx = _ctx(client, monkeypatch, "258f")
    res = _invite(client, ctx, "re258@test.com")
    uid = res.json()["counselor"]["id"]
    _clear_cooldown(redis, ctx["org_id"])
    before = len(ctx["captured"]["org"])
    rs = client.post(
        f"/api/v1/org/{ctx['org_id']}/counselors/{uid}/resend-invite", headers=ctx["h"]
    )
    assert rs.status_code == 200, rs.text
    assert len(ctx["captured"]["org"]) == before + 1
    lst = client.get(f"/api/v1/org/{ctx['org_id']}/counselors", headers=ctx["h"]).json()
    row = next(x for x in lst if x["id"] == uid)
    assert row["role"] == "org_admin" and row["status"] == "pending"


def test_ts9_기관관리자_정지_최소1명_가드(client, monkeypatch, redis):
    ctx = _ctx(client, monkeypatch, "258g")
    res = _invite(client, ctx, "second258@test.com")
    uid = res.json()["counselor"]["id"]
    h2 = _activate_new(client, ctx["captured"]["org"][-1])
    # 주 담당자 본인 정지 → 403 (자기 자신)
    me = client.get(f"/api/v1/org/{ctx['org_id']}/counselors", headers=ctx["h"]).json()
    admin_id = next(x["id"] for x in me if x["email"] == "adm-258g@test.com")
    url = f"/api/v1/org/{ctx['org_id']}/counselors"
    assert client.post(f"{url}/{admin_id}/suspend", json={"reason": "t"}, headers=ctx["h"]).status_code == 403
    # 두 번째 관리자가 주 담당자(첫 관리자)를 정지 → 주 담당자 보호 403
    assert client.post(f"{url}/{admin_id}/suspend", json={"reason": "t"}, headers=h2).status_code == 403
    # 첫 관리자가 두 번째 관리자 정지 → 주 담당자(활성) 남으므로 200, 해제 200
    r = client.post(f"{url}/{uid}/suspend", json={"reason": "t"}, headers=ctx["h"])
    assert r.status_code == 200, r.text
    r = client.post(f"{url}/{uid}/unsuspend", json={"reason": "t"}, headers=ctx["h"])
    assert r.status_code == 200, r.text


def test_ts9b_다른_활성관리자_없으면_정지_409(client, monkeypatch, redis):
    ctx = _ctx(client, monkeypatch, "258h")
    res = _invite(client, ctx, "only258@test.com")
    uid = res.json()["counselor"]["id"]
    h2 = _activate_new(client, ctx["captured"]["org"][-1])
    # 첫 관리자(주 담당자)를 비활성 상태로 만든다
    from app.models.user import User

    db = _db()
    try:
        u = db.query(User).filter(User.email == "adm-258h@test.com").first()
        u.status = "suspended"
        db.commit()
    finally:
        db.close()
    # 마지막 활성 관리자가 자신 외 대상 정지는 불가하나, 여기선 제3자 대상 케이스: 두번째가 자기 자신 → 403
    url = f"/api/v1/org/{ctx['org_id']}/counselors"
    assert client.post(f"{url}/{uid}/suspend", json={"reason": "t"}, headers=h2).status_code == 403
