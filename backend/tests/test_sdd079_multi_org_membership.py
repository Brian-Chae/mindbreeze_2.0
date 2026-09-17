"""SDD-079 — 상담사 다중 기관 소속 P0 QA

verify.md TS1~TS7 시나리오를 검증한다.
- membership 테이블이 소속의 진실 원천 (User.org_id 는 주 소속 미러)
- invite_counselor 신규/기존 자동 분기 + 소속 추가 초대 수락
- 기관 구성원 목록 membership 기반 (invite_type 포함)
"""

import asyncio
import uuid

from tests.test_sdd017_counselor_invite import (  # noqa: F401 — 헬퍼 재사용
    NEW_PASSWORD,
    _capture_invites,
    _db,
    _make_org_admin,
    _register,
)


def _capture_membership_invites(monkeypatch) -> list:
    """소속 추가 초대(send_membership_invite_email) 링크를 가로챈다."""
    captured: list = []

    def _fake(to_email, invite_link, *, counselor_name, org_name, expires_days):
        captured.append(invite_link)
        return True

    monkeypatch.setattr(
        "app.services.org_invite_service.send_membership_invite_email", _fake
    )
    return captured


def _clear_cooldown(redis, org_id: str) -> None:
    """테스트 내 연속 초대를 위해 기관 초대 쿨다운 키를 제거한다."""
    asyncio.run(
        redis.delete(
            f"counselor_invite_send:{org_id}", f"counselor_invite_resend:{org_id}"
        )
    )


def _membership(user_id: str, org_id: str):
    from app.models.user_org_membership import UserOrgMembership

    db = _db()
    try:
        return (
            db.query(UserOrgMembership)
            .filter(
                UserOrgMembership.user_id == uuid.UUID(user_id),
                UserOrgMembership.org_id == uuid.UUID(org_id),
            )
            .order_by(UserOrgMembership.created_at.asc())
            .all()
        )
    finally:
        db.close()


def _invite(client, ctx, email, name="김상담"):
    return client.post(
        f"/api/v1/org/{ctx['org_id']}/counselors/invite",
        json={"name": name, "email": email},
        headers=ctx["h"],
    )


def _setup_active_counselor(client, monkeypatch, redis, tag: str):
    """org A 를 만들고 상담사 1명을 초대→수락(active)까지 진행한다."""
    ctx_a = _make_org_admin(
        client, monkeypatch, sys_email=f"sys-a-{tag}@test.com", admin_email=f"adm-a-{tag}@test.com"
    )
    cap = _capture_invites(monkeypatch)
    email = f"c-{tag}@test.com"
    res = _invite(client, ctx_a, email)
    assert res.status_code == 201, res.text
    token = cap["counselor"][0].split("token=", 1)[1]
    activated = client.post(
        "/api/v1/auth/set-password", json={"token": token, "new_password": NEW_PASSWORD}
    )
    assert activated.status_code == 200, activated.text
    user_id = res.json()["counselor"]["id"]
    return ctx_a, email, user_id


# ---------------------------------------------------------------------------
# TS1/TS4: 신규 초대 → membership(invited) 생성, set-password 수락 시 active
# ---------------------------------------------------------------------------


def test_ts1_신규초대_membership_생성과_수락시_active(client, monkeypatch, redis):
    ctx = _make_org_admin(client, monkeypatch, sys_email="s79a@test.com", admin_email="a79a@test.com")
    cap = _capture_invites(monkeypatch)
    res = _invite(client, ctx, "new79a@test.com")
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["counselor"]["status"] == "pending"
    assert body["counselor"]["invite_type"] == "new_account"

    rows = _membership(body["counselor"]["id"], ctx["org_id"])
    assert len(rows) == 1
    assert rows[0].status == "invited"
    assert rows[0].is_primary is False

    token = cap["counselor"][0].split("token=", 1)[1]
    activated = client.post(
        "/api/v1/auth/set-password", json={"token": token, "new_password": NEW_PASSWORD}
    )
    assert activated.status_code == 200, activated.text

    rows = _membership(body["counselor"]["id"], ctx["org_id"])
    assert rows[0].status == "active"
    assert rows[0].is_primary is True
    assert rows[0].joined_at is not None


# ---------------------------------------------------------------------------
# TS2: 기존 상담사 소속 추가 초대 분기
# ---------------------------------------------------------------------------


def test_ts2_기존상담사_소속추가초대_계정생성없음(client, monkeypatch, redis):
    ctx_a, email, user_id = _setup_active_counselor(client, monkeypatch, redis, "ts2")
    ctx_b = _make_org_admin(client, monkeypatch, sys_email="s79b@test.com", admin_email="a79b@test.com")
    mem_cap = _capture_membership_invites(monkeypatch)

    res = _invite(client, ctx_b, email, name="무시되는이름")
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["invite_sent"] is True
    assert body["counselor"]["id"] == user_id  # 기존 계정 그대로
    assert body["counselor"]["status"] == "pending"  # membership invited
    assert body["counselor"]["invite_type"] == "org_membership"
    assert len(mem_cap) == 1  # 소속 초대 메일 (set-password 아님)

    from app.models.counselor_profile import CounselorProfile
    from app.models.user import User

    db = _db()
    try:
        # 계정·프로필 추가 생성 없음
        assert db.query(User).filter(User.email == email).count() == 1
        assert (
            db.query(CounselorProfile)
            .filter(CounselorProfile.user_id == uuid.UUID(user_id))
            .count()
            == 1
        )
        # 주 소속(org A) 미러 불변
        user = db.query(User).filter(User.id == uuid.UUID(user_id)).first()
        assert str(user.org_id) == ctx_a["org_id"]
    finally:
        db.close()

    rows = _membership(user_id, ctx_b["org_id"])
    assert len(rows) == 1 and rows[0].status == "invited"

    # 응답에 토큰류 비노출
    for leaked in ("token", "invite_link"):
        assert leaked not in res.text


def test_ts2_같은기관_재초대_409(client, monkeypatch, redis):
    ctx_a, email, _ = _setup_active_counselor(client, monkeypatch, redis, "ts2dup")
    # active 소속 재초대 → 409
    _clear_cooldown(redis, ctx_a["org_id"])
    res = _invite(client, ctx_a, email)
    assert res.status_code == 409, res.text
    assert "이미 이 기관에 소속(초대)된 상담사입니다" in res.json()["detail"]

    # invited 상태 재초대도 409
    ctx_b = _make_org_admin(client, monkeypatch, sys_email="s79c@test.com", admin_email="a79c@test.com")
    _capture_membership_invites(monkeypatch)
    assert _invite(client, ctx_b, email).status_code == 201
    _clear_cooldown(redis, ctx_b["org_id"])
    res = _invite(client, ctx_b, email)
    assert res.status_code == 409
    assert "이미 이 기관에 소속(초대)된 상담사입니다" in res.json()["detail"]


def test_ts2_상담사아닌_기존이메일_409(client, monkeypatch, redis):
    ctx = _make_org_admin(client, monkeypatch, sys_email="s79d@test.com", admin_email="a79d@test.com")
    _register(client, "client79@test.com")  # client 역할 계정
    res = _invite(client, ctx, "client79@test.com")
    assert res.status_code == 409, res.text
    assert "상담사 계정이 아닌 이메일입니다" in res.json()["detail"]


# ---------------------------------------------------------------------------
# TS3: 소속 추가 초대 수락
# ---------------------------------------------------------------------------


def _invite_existing(client, monkeypatch, redis, ctx_target, email):
    mem_cap = _capture_membership_invites(monkeypatch)
    _clear_cooldown(redis, ctx_target["org_id"])
    res = _invite(client, ctx_target, email)
    assert res.status_code == 201, res.text
    return mem_cap[0].split("token=", 1)[1], res.json()["counselor"]["id"]


def test_ts3_소속초대_수락_계정불변_소속추가(client, monkeypatch, redis):
    ctx_a, email, user_id = _setup_active_counselor(client, monkeypatch, redis, "ts3")
    ctx_b = _make_org_admin(client, monkeypatch, sys_email="s79e@test.com", admin_email="a79e@test.com")
    token, _ = _invite_existing(client, monkeypatch, redis, ctx_b, email)

    res = client.post("/api/v1/org/membership-invites/accept", json={"token": token})
    assert res.status_code == 200, res.text
    assert res.json()["org_id"] == ctx_b["org_id"]

    rows = _membership(user_id, ctx_b["org_id"])
    assert rows[0].status == "active" and rows[0].joined_at is not None
    # 주 소속(A) 불변 — B 는 부 소속
    assert rows[0].is_primary is False

    from app.models.user import User

    db = _db()
    try:
        user = db.query(User).filter(User.id == uuid.UUID(user_id)).first()
        assert str(user.org_id) == ctx_a["org_id"]
        assert user.status == "active"
    finally:
        db.close()

    # 기존 비밀번호로 로그인 가능 (계정 불변)
    login = client.post(
        "/api/v1/auth/login", json={"email": email, "password": NEW_PASSWORD}
    )
    assert login.status_code == 200, login.text

    # 토큰 재사용 → 401
    reuse = client.post("/api/v1/org/membership-invites/accept", json={"token": token})
    assert reuse.status_code == 401


def test_ts3_소속초대토큰_setpassword_차단(client, monkeypatch, redis):
    _, email, _ = _setup_active_counselor(client, monkeypatch, redis, "ts3b")
    ctx_b = _make_org_admin(client, monkeypatch, sys_email="s79f@test.com", admin_email="a79f@test.com")
    token, _ = _invite_existing(client, monkeypatch, redis, ctx_b, email)

    res = client.post(
        "/api/v1/auth/set-password", json={"token": token, "new_password": "Hijack1!"}
    )
    assert res.status_code == 401, res.text
    # 기존 비밀번호 유지
    login = client.post(
        "/api/v1/auth/login", json={"email": email, "password": NEW_PASSWORD}
    )
    assert login.status_code == 200


def test_ts3_무소속상담사_수락시_주소속_승격(client, monkeypatch, redis):
    from tests.conftest import create_test_counselor

    ctx = _make_org_admin(client, monkeypatch, sys_email="s79g@test.com", admin_email="a79g@test.com")
    email = "solo79@test.com"
    created = create_test_counselor(email)  # 무소속 active 상담사
    token, _ = _invite_existing(client, monkeypatch, redis, ctx, email)

    res = client.post("/api/v1/org/membership-invites/accept", json={"token": token})
    assert res.status_code == 200, res.text

    from app.models.user import User

    db = _db()
    try:
        user = db.query(User).filter(User.id == uuid.UUID(created["id"])).first()
        assert str(user.org_id) == ctx["org_id"]  # 첫 소속 = 주 소속 미러 갱신
    finally:
        db.close()
    rows = _membership(created["id"], ctx["org_id"])
    assert rows[0].status == "active" and rows[0].is_primary is True


# ---------------------------------------------------------------------------
# TS5: 구성원 목록 membership 기반 + invite_type
# ---------------------------------------------------------------------------


def test_ts5_구성원목록_유형구분과_격리(client, monkeypatch, redis):
    ctx_a, email, user_id = _setup_active_counselor(client, monkeypatch, redis, "ts5")
    ctx_b = _make_org_admin(client, monkeypatch, sys_email="s79h@test.com", admin_email="a79h@test.com")

    # B: 기존 상담사 소속 추가 초대 + 신규 상담사 초대
    _invite_existing(client, monkeypatch, redis, ctx_b, email)
    cap = _capture_invites(monkeypatch)
    _clear_cooldown(redis, ctx_b["org_id"])
    assert _invite(client, ctx_b, "new79h@test.com").status_code == 201
    assert len(cap["counselor"]) == 1

    res = client.get(f"/api/v1/org/{ctx_b['org_id']}/counselors", headers=ctx_b["h"])
    assert res.status_code == 200, res.text
    by_email = {r["email"]: r for r in res.json()}
    # 소속 추가 초대 — 계정은 active 지만 목록 상태는 membership(invited) 기준 pending
    assert by_email[email]["status"] == "pending"
    assert by_email[email]["invite_type"] == "org_membership"
    assert by_email[email]["invite_expires_at"]
    # 신규 가입 초대
    assert by_email["new79h@test.com"]["invite_type"] == "new_account"
    # active 구성원(org_admin 본인)은 invite_type 없음
    assert by_email["a79h@test.com"]["invite_type"] is None

    # A 기관 목록에는 B 초대가 영향 없음 (격리)
    res_a = client.get(f"/api/v1/org/{ctx_a['org_id']}/counselors", headers=ctx_a["h"])
    emails_a = {r["email"] for r in res_a.json()}
    assert "new79h@test.com" not in emails_a
    assert email in emails_a  # A 소속은 그대로


# ---------------------------------------------------------------------------
# TS6: 소속 해제(left) · 재초대 · 주 소속 승격
# ---------------------------------------------------------------------------


def test_ts6_소속해제_left_이력보존_재초대가능(client, monkeypatch, redis):
    ctx_a, email, user_id = _setup_active_counselor(client, monkeypatch, redis, "ts6")

    res = client.delete(
        f"/api/v1/org/{ctx_a['org_id']}/counselors/{user_id}", headers=ctx_a["h"]
    )
    assert res.status_code == 204, res.text

    rows = _membership(user_id, ctx_a["org_id"])
    assert len(rows) == 1
    assert rows[0].status == "left" and rows[0].left_at is not None

    from app.models.user import User

    db = _db()
    try:
        user = db.query(User).filter(User.id == uuid.UUID(user_id)).first()
        assert user.org_id is None  # 미러 동기 갱신
    finally:
        db.close()

    # 재초대 → 새 membership 행 (left 이력 보존)
    token, _ = _invite_existing(client, monkeypatch, redis, ctx_a, email)
    rows = _membership(user_id, ctx_a["org_id"])
    assert len(rows) == 2
    assert {r.status for r in rows} == {"left", "invited"}


def test_ts6_주소속해제시_남은소속_승격(client, monkeypatch, redis):
    ctx_a, email, user_id = _setup_active_counselor(client, monkeypatch, redis, "ts6b")
    ctx_b = _make_org_admin(client, monkeypatch, sys_email="s79i@test.com", admin_email="a79i@test.com")
    token, _ = _invite_existing(client, monkeypatch, redis, ctx_b, email)
    assert client.post(
        "/api/v1/org/membership-invites/accept", json={"token": token}
    ).status_code == 200

    # 주 소속(A) 해제 → B 가 주 소속으로 승격
    res = client.delete(
        f"/api/v1/org/{ctx_a['org_id']}/counselors/{user_id}", headers=ctx_a["h"]
    )
    assert res.status_code == 204, res.text

    from app.models.user import User

    db = _db()
    try:
        user = db.query(User).filter(User.id == uuid.UUID(user_id)).first()
        assert str(user.org_id) == ctx_b["org_id"]
    finally:
        db.close()
    rows = _membership(user_id, ctx_b["org_id"])
    assert rows[0].is_primary is True


# ---------------------------------------------------------------------------
# TS7: 재발송 분기
# ---------------------------------------------------------------------------


def test_ts7_소속추가초대_재발송은_membership링크(client, monkeypatch, redis):
    _, email, user_id = _setup_active_counselor(client, monkeypatch, redis, "ts7")
    ctx_b = _make_org_admin(client, monkeypatch, sys_email="s79j@test.com", admin_email="a79j@test.com")
    mem_cap = _capture_membership_invites(monkeypatch)
    _clear_cooldown(redis, ctx_b["org_id"])
    assert _invite(client, ctx_b, email).status_code == 201
    assert len(mem_cap) == 1

    _clear_cooldown(redis, ctx_b["org_id"])
    res = client.post(
        f"/api/v1/org/{ctx_b['org_id']}/counselors/{user_id}/resend-invite",
        headers=ctx_b["h"],
    )
    assert res.status_code == 200, res.text
    assert len(mem_cap) == 2  # membership 링크 재발송
    assert "/membership-invite?token=" in mem_cap[1]


def test_ts7_active_소속_재발송_409(client, monkeypatch, redis):
    ctx_a, email, user_id = _setup_active_counselor(client, monkeypatch, redis, "ts7b")
    _clear_cooldown(redis, ctx_a["org_id"])
    res = client.post(
        f"/api/v1/org/{ctx_a['org_id']}/counselors/{user_id}/resend-invite",
        headers=ctx_a["h"],
    )
    assert res.status_code == 409, res.text
