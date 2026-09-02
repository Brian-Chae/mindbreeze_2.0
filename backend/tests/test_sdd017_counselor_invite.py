"""SDD-017 — 상담사 초대 (기관 담당자 일괄 초대) QA

verify.md TS1~TS8 + 엣지/보안 케이스를 검증한다.
"""

import uuid

from app.services import email_verify_service
from tests.conftest import create_test_org

VALID_PASSWORD = "Passw0rd!"
NEW_PASSWORD = "NewPassw0rd!"


def _consents() -> dict:
    return {"tos": True, "privacy": True, "sensitive": True}


def _db():
    from app.core.database import get_db
    from app.main import app as fastapi_app

    return next(fastapi_app.dependency_overrides[get_db]())


def _register(client, email: str) -> dict:
    payload = {
        "email": email,
        "password": VALID_PASSWORD,
        "name": "테스트",
        "email_verify_token": email_verify_service.generate_email_verify_token(email),
        "consents": _consents(),
    }
    res = client.post("/api/v1/auth/register/client", json=payload)
    assert res.status_code == 201, res.text
    body = res.json()
    return {"id": body["user"]["id"], "h": {"Authorization": f"Bearer {body['access_token']}"}}


def _promote(user_id: str, role: str) -> None:
    from app.models.user import User

    db = _db()
    try:
        user = db.query(User).filter(User.id == uuid.UUID(user_id)).first()
        user.role = role
        db.commit()
    finally:
        db.close()


def _platform_admin(client, email: str) -> dict:
    admin = _register(client, email)
    _promote(admin["id"], "platform_admin")
    return admin


def _capture_invites(monkeypatch) -> dict:
    """org_admin 초대(send_org_invite_email)와 상담사 초대(send_counselor_invite_email) 링크를 가로챈다."""
    captured: dict = {"org": [], "counselor": []}

    def _fake_org(to_email, invite_link, *, admin_name, org_name, expires_days):
        captured["org"].append(invite_link)
        return True

    def _fake_counselor(to_email, invite_link, *, admin_name, org_name, expires_days):
        captured["counselor"].append(invite_link)
        return True

    monkeypatch.setattr("app.services.org_invite_service.send_org_invite_email", _fake_org)
    monkeypatch.setattr(
        "app.services.org_invite_service.send_counselor_invite_email", _fake_counselor
    )
    return captured


def _make_org_admin(client, monkeypatch, *, sys_email: str, admin_email: str) -> dict:
    """플랫폼 관리자로 기관+org_admin 생성 → 초대 토큰으로 활성화 → org_admin 로그인 헤더 반환."""
    captured = _capture_invites(monkeypatch)
    padmin = _platform_admin(client, sys_email)

    res = client.post(
        "/api/v1/admin/orgs",
        json={
            "name": "상담센터",
            "phone": "02-1234-5678",
            "address": "서울시 강남구",
            "admin_name": "박담당",
            "admin_email": admin_email,
            "admin_phone": "010-1111-2222",
        },
        headers=padmin["h"],
    )
    assert res.status_code == 201, res.text
    org_id = res.json()["org"]["id"]

    # org_admin 초대 토큰으로 비밀번호 설정 → 활성화 + 로그인
    token = captured["org"][0].split("token=", 1)[1]
    activated = client.post(
        "/api/v1/auth/set-password", json={"token": token, "new_password": NEW_PASSWORD}
    )
    assert activated.status_code == 200, activated.text
    body = activated.json()
    assert body["user"]["role"] == "org_admin"
    return {
        "org_id": org_id,
        "h": {"Authorization": f"Bearer {body['access_token']}"},
        "captured": captured,
    }


# ---------------------------------------------------------------------------
# TS1: 상담사 초대 → pending 계정 + 코드 발급
# ---------------------------------------------------------------------------


def test_ts1_상담사초대_pending계정과_코드발급(client, monkeypatch):
    ctx = _make_org_admin(client, monkeypatch, sys_email="s1@test.com", admin_email="a1@test.com")

    res = client.post(
        f"/api/v1/org/{ctx['org_id']}/counselors/invite",
        json={"name": "김상담", "email": "counselor1@test.com"},
        headers=ctx["h"],
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["invite_sent"] is True
    assert body["counselor"]["status"] == "pending"
    assert body["counselor"]["role"] == "counselor"
    assert body["counselor"]["email"] == "counselor1@test.com"
    assert body["counselor"]["invite_expires_at"]
    # 상담사 초대 메일이 1건 발송됨
    assert len(ctx["captured"]["counselor"]) == 1

    from app.models.counselor_profile import CounselorProfile
    from app.models.user import User

    db = _db()
    try:
        user = db.query(User).filter(User.email == "counselor1@test.com").first()
        assert user is not None
        assert user.role == "counselor"
        assert user.status == "pending"
        assert str(user.org_id) == ctx["org_id"]
        profile = db.query(CounselorProfile).filter(CounselorProfile.user_id == user.id).first()
        assert profile is not None
        assert profile.counselor_code and len(profile.counselor_code) == 6
    finally:
        db.close()


def test_ts1_초대응답에_토큰_비노출(client, monkeypatch):
    ctx = _make_org_admin(client, monkeypatch, sys_email="s1b@test.com", admin_email="a1b@test.com")
    res = client.post(
        f"/api/v1/org/{ctx['org_id']}/counselors/invite",
        json={"name": "김상담", "email": "counselor1b@test.com"},
        headers=ctx["h"],
    )
    raw = res.text
    for leaked in ("token", "password", "invite_link"):
        assert leaked not in raw


# ---------------------------------------------------------------------------
# TS2: 초대 링크로 비밀번호 설정 → 활성화 + 로그인
# ---------------------------------------------------------------------------


def test_ts2_초대링크로_비밀번호설정_활성화(client, monkeypatch):
    ctx = _make_org_admin(client, monkeypatch, sys_email="s2@test.com", admin_email="a2@test.com")
    client.post(
        f"/api/v1/org/{ctx['org_id']}/counselors/invite",
        json={"name": "김상담", "email": "counselor2@test.com"},
        headers=ctx["h"],
    )
    token = ctx["captured"]["counselor"][0].split("token=", 1)[1]

    res = client.post(
        "/api/v1/auth/set-password", json={"token": token, "new_password": NEW_PASSWORD}
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["user"]["role"] == "counselor"
    assert body["access_token"]

    # 이메일+비밀번호 로그인 가능
    login = client.post(
        "/api/v1/auth/login",
        json={"email": "counselor2@test.com", "password": NEW_PASSWORD},
    )
    assert login.status_code == 200, login.text
    assert login.json()["user"]["role"] == "counselor"

    from app.models.user import User

    db = _db()
    try:
        user = db.query(User).filter(User.email == "counselor2@test.com").first()
        assert user.status == "active"
    finally:
        db.close()


# ---------------------------------------------------------------------------
# TS3: 초대 토큰 재사용 거부
# ---------------------------------------------------------------------------


def test_ts3_초대토큰_재사용_거부(client, monkeypatch):
    ctx = _make_org_admin(client, monkeypatch, sys_email="s3@test.com", admin_email="a3@test.com")
    client.post(
        f"/api/v1/org/{ctx['org_id']}/counselors/invite",
        json={"name": "김상담", "email": "counselor3@test.com"},
        headers=ctx["h"],
    )
    token = ctx["captured"]["counselor"][0].split("token=", 1)[1]

    first = client.post(
        "/api/v1/auth/set-password", json={"token": token, "new_password": NEW_PASSWORD}
    )
    assert first.status_code == 200
    second = client.post(
        "/api/v1/auth/set-password", json={"token": token, "new_password": "AnotherPw1!"}
    )
    assert second.status_code == 401
    assert "이미 사용" in second.json()["detail"]


# ---------------------------------------------------------------------------
# TS4: 이메일 중복 초대 409 (대소문자 변형 포함)
# ---------------------------------------------------------------------------


def test_ts4_이메일_중복초대_409_대소문자(client, monkeypatch):
    ctx = _make_org_admin(client, monkeypatch, sys_email="s4@test.com", admin_email="a4@test.com")
    first = client.post(
        f"/api/v1/org/{ctx['org_id']}/counselors/invite",
        json={"name": "김상담", "email": "Foo4@test.com"},
        headers=ctx["h"],
    )
    assert first.status_code == 201

    # 대소문자만 다른 동일 이메일 → 중복(409). 레이트리밋(429)보다 우선한다.
    second = client.post(
        f"/api/v1/org/{ctx['org_id']}/counselors/invite",
        json={"name": "다른상담", "email": "foo4@test.com"},
        headers=ctx["h"],
    )
    assert second.status_code == 409, second.text
    assert "이미 등록된 이메일" in second.json()["detail"]


# ---------------------------------------------------------------------------
# TS5: 레거시 register/counselor 백엔드 유지
# ---------------------------------------------------------------------------


def test_ts5_레거시_register_counselor_백엔드_유지(client):
    code = create_test_org("레거시센터")
    res = client.post(
        "/api/v1/auth/register/counselor",
        json={
            "org_code": code,
            "email": "legacy_c5@test.com",
            "password": VALID_PASSWORD,
            "name": "레거시상담사",
            "email_verify_token": email_verify_service.generate_email_verify_token("legacy_c5@test.com"),
            "consents": _consents(),
        },
    )
    assert res.status_code == 201, res.text
    assert res.json()["user"]["role"] == "counselor"


def test_ts5_레거시_register로_상담사_가입은_초대안내(client):
    res = client.post(
        "/api/v1/auth/register",
        json={
            "email": "legacy_c5b@test.com",
            "password": VALID_PASSWORD,
            "name": "무소속",
            "role": "counselor",
        },
    )
    assert res.status_code == 400
    assert "초대" in res.json()["detail"]


# ---------------------------------------------------------------------------
# TS6: 상담사 목록 상태 구분
# ---------------------------------------------------------------------------


def test_ts6_상담사목록_상태포함(client, monkeypatch):
    ctx = _make_org_admin(client, monkeypatch, sys_email="s6@test.com", admin_email="a6@test.com")
    client.post(
        f"/api/v1/org/{ctx['org_id']}/counselors/invite",
        json={"name": "김상담", "email": "counselor6@test.com"},
        headers=ctx["h"],
    )

    res = client.get(f"/api/v1/org/{ctx['org_id']}/counselors", headers=ctx["h"])
    assert res.status_code == 200, res.text
    rows = res.json()
    by_email = {r["email"]: r for r in rows}
    assert by_email["counselor6@test.com"]["status"] == "pending"
    assert by_email["counselor6@test.com"]["invite_expires_at"]
    # org_admin 본인도 목록에 포함되며 status=active
    assert by_email["a6@test.com"]["status"] == "active"


# ---------------------------------------------------------------------------
# TS7: resend pending만 허용
# ---------------------------------------------------------------------------


def test_ts7_resend_pending_허용(client, monkeypatch):
    ctx = _make_org_admin(client, monkeypatch, sys_email="s7@test.com", admin_email="a7@test.com")
    invited = client.post(
        f"/api/v1/org/{ctx['org_id']}/counselors/invite",
        json={"name": "김상담", "email": "counselor7@test.com"},
        headers=ctx["h"],
    )
    user_id = invited.json()["counselor"]["id"]

    res = client.post(
        f"/api/v1/org/{ctx['org_id']}/counselors/{user_id}/resend-invite",
        headers=ctx["h"],
    )
    assert res.status_code == 200, res.text
    assert res.json()["invite_sent"] is True
    # 최초 초대 + 재발송 = 2건
    assert len(ctx["captured"]["counselor"]) == 2


def test_ts7_resend_active_거부(client, monkeypatch):
    ctx = _make_org_admin(client, monkeypatch, sys_email="s7b@test.com", admin_email="a7b@test.com")
    invited = client.post(
        f"/api/v1/org/{ctx['org_id']}/counselors/invite",
        json={"name": "김상담", "email": "counselor7b@test.com"},
        headers=ctx["h"],
    )
    user_id = invited.json()["counselor"]["id"]
    # 초대 토큰으로 활성화
    token = ctx["captured"]["counselor"][0].split("token=", 1)[1]
    client.post("/api/v1/auth/set-password", json={"token": token, "new_password": NEW_PASSWORD})

    res = client.post(
        f"/api/v1/org/{ctx['org_id']}/counselors/{user_id}/resend-invite",
        headers=ctx["h"],
    )
    assert res.status_code == 409, res.text


def test_ts7_타기관_상담사_재발송_404(client, monkeypatch):
    ctx = _make_org_admin(client, monkeypatch, sys_email="s7c@test.com", admin_email="a7c@test.com")
    # 존재하지 않는(또는 타 기관) user_id
    res = client.post(
        f"/api/v1/org/{ctx['org_id']}/counselors/{uuid.uuid4()}/resend-invite",
        headers=ctx["h"],
    )
    assert res.status_code == 404


# ---------------------------------------------------------------------------
# TS8: 무인증 / 권한 없는 접근 차단
# ---------------------------------------------------------------------------


def test_ts8_무인증_상담사목록_401(client, monkeypatch):
    ctx = _make_org_admin(client, monkeypatch, sys_email="s8@test.com", admin_email="a8@test.com")
    res = client.get(f"/api/v1/org/{ctx['org_id']}/counselors")
    assert res.status_code == 401


def test_ts8_타기관_org_admin_목록_403(client, monkeypatch):
    ctx = _make_org_admin(client, monkeypatch, sys_email="s8b@test.com", admin_email="a8b@test.com")
    # 다른 기관 org_admin
    other = _make_org_admin(client, monkeypatch, sys_email="s8c@test.com", admin_email="a8c@test.com")
    res = client.get(f"/api/v1/org/{ctx['org_id']}/counselors", headers=other["h"])
    assert res.status_code == 403


def test_ts8_일반사용자_초대_403(client, monkeypatch):
    ctx = _make_org_admin(client, monkeypatch, sys_email="s8d@test.com", admin_email="a8d@test.com")
    normal = _register(client, "normal8@test.com")
    res = client.post(
        f"/api/v1/org/{ctx['org_id']}/counselors/invite",
        json={"name": "김상담", "email": "x8@test.com"},
        headers=normal["h"],
    )
    assert res.status_code == 403


# ---------------------------------------------------------------------------
# Edge: 초기 초대 레이트리밋
# ---------------------------------------------------------------------------


def test_edge_초기초대_레이트리밋_429(client, monkeypatch):
    ctx = _make_org_admin(client, monkeypatch, sys_email="s9@test.com", admin_email="a9@test.com")
    first = client.post(
        f"/api/v1/org/{ctx['org_id']}/counselors/invite",
        json={"name": "상담1", "email": "c9a@test.com"},
        headers=ctx["h"],
    )
    assert first.status_code == 201
    # 서로 다른 상담사라도 기관당 쿨다운에 걸려 429
    second = client.post(
        f"/api/v1/org/{ctx['org_id']}/counselors/invite",
        json={"name": "상담2", "email": "c9b@test.com"},
        headers=ctx["h"],
    )
    assert second.status_code == 429, second.text
