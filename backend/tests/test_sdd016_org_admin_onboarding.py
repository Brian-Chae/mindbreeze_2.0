"""SDD-016 — 기관 담당자 온보딩 (초대 토큰 방식) QA

spec.md §8 검증 기준 1~4를 검증한다.
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


def _register(client, email: str, role: str = "client") -> dict:
    payload = {
        "email": email,
        "password": VALID_PASSWORD,
        "name": "테스트",
        "email_verify_token": email_verify_service.generate_email_verify_token(email),
        "consents": _consents(),
    }
    if role == "counselor":
        payload["org_code"] = create_test_org()
    res = client.post(f"/api/v1/auth/register/{role}", json=payload)
    assert res.status_code == 201, res.text
    body = res.json()
    return {
        "id": body["user"]["id"],
        "h": {"Authorization": f"Bearer {body['access_token']}"},
    }


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


def _org_payload(name: str, admin_email: str) -> dict:
    return {
        "name": name,
        "phone": "02-1234-5678",
        "address": "서울시 강남구",
        "admin_name": "박담당",
        "admin_email": admin_email,
        "admin_phone": "010-1111-2222",
    }


def _capture_invite_token(monkeypatch) -> list[str]:
    """발송된 초대 링크에서 토큰을 가로챈다 (이메일 전송은 하지 않음)."""
    captured: list[str] = []

    def _fake_send(to_email, invite_link, *, admin_name, org_name, expires_days):
        captured.append(invite_link)
        return True

    monkeypatch.setattr("app.services.org_invite_service.send_org_invite_email", _fake_send)
    return captured


# ---------------------------------------------------------------------------
# 1. 기관 + 담당자 등록
# ---------------------------------------------------------------------------


def test_01_기관등록시_담당자계정과_초대발송(client, monkeypatch):
    tokens = _capture_invite_token(monkeypatch)
    admin = _platform_admin(client, "sys01@test.com")

    res = client.post(
        "/api/v1/admin/orgs",
        json=_org_payload("담당자센터", "orgadmin01@test.com"),
        headers=admin["h"],
    )
    assert res.status_code == 201, res.text
    body = res.json()

    assert body["org"]["name"] == "담당자센터"
    assert body["org"]["org_code"] and len(body["org"]["org_code"]) == 6
    assert body["admin"]["email"] == "orgadmin01@test.com"
    assert body["admin"]["name"] == "박담당"
    # 초대 수락 전에는 pending 상태
    assert body["admin"]["status"] == "pending"
    assert body["invite_sent"] is True
    assert len(tokens) == 1
    assert tokens[0].startswith("https://dev.mindbreeze.looxidlabs.com/set-password?token=")


def test_02_담당자_User가_org_admin으로_생성되고_primary_admin_id_연결(client, monkeypatch):
    _capture_invite_token(monkeypatch)
    admin = _platform_admin(client, "sys02@test.com")

    res = client.post(
        "/api/v1/admin/orgs",
        json=_org_payload("연결센터", "orgadmin02@test.com"),
        headers=admin["h"],
    )
    org_id = res.json()["org"]["id"]
    admin_id = res.json()["admin"]["id"]

    from app.models.organization import Organization
    from app.models.user import User

    db = _db()
    try:
        org = db.query(Organization).filter(Organization.id == uuid.UUID(org_id)).first()
        user = db.query(User).filter(User.id == uuid.UUID(admin_id)).first()
        assert str(org.primary_admin_id) == admin_id
        assert user.role == "org_admin"
        assert str(user.org_id) == org_id
        assert user.status == "pending"
    finally:
        db.close()


def test_03_응답에_초대토큰이_노출되지_않는다(client, monkeypatch):
    _capture_invite_token(monkeypatch)
    admin = _platform_admin(client, "sys03@test.com")

    res = client.post(
        "/api/v1/admin/orgs",
        json=_org_payload("비노출센터", "orgadmin03@test.com"),
        headers=admin["h"],
    )
    raw = res.text
    for leaked in ("token", "password", "invite_link"):
        assert leaked not in raw


def test_04_담당자_이메일_중복이면_409(client, monkeypatch):
    _capture_invite_token(monkeypatch)
    admin = _platform_admin(client, "sys04@test.com")
    _register(client, "dup04@test.com")  # 기존 내담자 계정

    res = client.post(
        "/api/v1/admin/orgs",
        json=_org_payload("중복센터", "dup04@test.com"),
        headers=admin["h"],
    )
    assert res.status_code == 409
    assert "이미 등록된 이메일" in res.json()["detail"]


def test_05_담당자_없이_기관만_등록_가능(client):
    """SDD-015 하위 호환 — 담당자 정보를 생략하면 기관만 생성된다."""
    admin = _platform_admin(client, "sys05@test.com")
    res = client.post("/api/v1/admin/orgs", json={"name": "기관만센터"}, headers=admin["h"])
    assert res.status_code == 201
    body = res.json()
    assert body["admin"] is None
    assert body["invite_sent"] is False
    assert body["org"]["org_code"]


def test_06_담당자_이름만_주면_422(client):
    admin = _platform_admin(client, "sys06@test.com")
    res = client.post(
        "/api/v1/admin/orgs",
        json={"name": "불완전센터", "admin_name": "박담당"},
        headers=admin["h"],
    )
    assert res.status_code == 422


def test_07_일반사용자는_기관등록_403(client):
    user = _register(client, "normal07@test.com")
    res = client.post(
        "/api/v1/admin/orgs",
        json=_org_payload("무단센터", "x07@test.com"),
        headers=user["h"],
    )
    assert res.status_code == 403


# ---------------------------------------------------------------------------
# 2. 초대 토큰으로 비밀번호 설정
# ---------------------------------------------------------------------------


def test_08_초대토큰으로_비밀번호설정_및_활성화(client, monkeypatch):
    tokens = _capture_invite_token(monkeypatch)
    admin = _platform_admin(client, "sys08@test.com")
    client.post(
        "/api/v1/admin/orgs",
        json=_org_payload("활성화센터", "orgadmin08@test.com"),
        headers=admin["h"],
    )

    res = client.post(
        "/api/v1/auth/set-password",
        json={"token": tokens[0].split("token=", 1)[1], "new_password": NEW_PASSWORD},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["user"]["email"] == "orgadmin08@test.com"
    assert body["user"]["role"] == "org_admin"
    assert body["access_token"]

    from app.models.user import User

    db = _db()
    try:
        user = db.query(User).filter(User.email == "orgadmin08@test.com").first()
        assert user.status == "active"
    finally:
        db.close()


def test_09_설정후_이메일_비밀번호로_로그인(client, monkeypatch):
    tokens = _capture_invite_token(monkeypatch)
    admin = _platform_admin(client, "sys09@test.com")
    client.post(
        "/api/v1/admin/orgs",
        json=_org_payload("로그인센터", "orgadmin09@test.com"),
        headers=admin["h"],
    )
    client.post(
        "/api/v1/auth/set-password",
        json={"token": tokens[0].split("token=", 1)[1], "new_password": NEW_PASSWORD},
    )

    res = client.post(
        "/api/v1/auth/login",
        json={"email": "orgadmin09@test.com", "password": NEW_PASSWORD},
    )
    assert res.status_code == 200, res.text
    assert res.json()["user"]["role"] == "org_admin"


def test_10_초대토큰_재사용_거부(client, monkeypatch):
    tokens = _capture_invite_token(monkeypatch)
    admin = _platform_admin(client, "sys10@test.com")
    client.post(
        "/api/v1/admin/orgs",
        json=_org_payload("일회용센터", "orgadmin10@test.com"),
        headers=admin["h"],
    )

    first = client.post(
        "/api/v1/auth/set-password",
        json={"token": tokens[0].split("token=", 1)[1], "new_password": NEW_PASSWORD},
    )
    assert first.status_code == 200

    second = client.post(
        "/api/v1/auth/set-password",
        json={"token": tokens[0].split("token=", 1)[1], "new_password": "AnotherPw1!"},
    )
    assert second.status_code == 401
    assert "이미 사용" in second.json()["detail"]


def test_11_위조토큰_401(client):
    res = client.post(
        "/api/v1/auth/set-password",
        json={"token": "not-a-real-token", "new_password": NEW_PASSWORD},
    )
    assert res.status_code == 401


def test_12_다른_용도_토큰은_거부(client, monkeypatch):
    """비밀번호 재설정 토큰(type 불일치)으로는 set-password 불가."""
    from datetime import datetime, timedelta, timezone

    from jose import jwt

    from app.config import settings

    payload = {
        "sub": str(uuid.uuid4()),
        "exp": datetime.now(timezone.utc) + timedelta(minutes=30),
        "type": "password_reset",
        "jti": uuid.uuid4().hex,
    }
    token = jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)

    res = client.post(
        "/api/v1/auth/set-password", json={"token": token, "new_password": NEW_PASSWORD}
    )
    assert res.status_code == 401
    assert "형식" in res.json()["detail"]


def test_13_약한_비밀번호_거부_422(client, monkeypatch):
    tokens = _capture_invite_token(monkeypatch)
    admin = _platform_admin(client, "sys13@test.com")
    client.post(
        "/api/v1/admin/orgs",
        json=_org_payload("약한비번센터", "orgadmin13@test.com"),
        headers=admin["h"],
    )

    res = client.post(
        "/api/v1/auth/set-password",
        json={"token": tokens[0].split("token=", 1)[1], "new_password": "onlyletters"},
    )
    assert res.status_code == 422


def test_14_초대수락_전에는_로그인_불가(client, monkeypatch):
    """비밀번호가 난수로 설정되어 있어 어떤 비밀번호로도 로그인되지 않는다."""
    _capture_invite_token(monkeypatch)
    admin = _platform_admin(client, "sys14@test.com")
    client.post(
        "/api/v1/admin/orgs",
        json=_org_payload("미활성센터", "orgadmin14@test.com"),
        headers=admin["h"],
    )

    for pw in (VALID_PASSWORD, NEW_PASSWORD, ""):
        res = client.post(
            "/api/v1/auth/login", json={"email": "orgadmin14@test.com", "password": pw}
        )
        assert res.status_code in (401, 422)


# ---------------------------------------------------------------------------
# 3. 초대 재발송
# ---------------------------------------------------------------------------


def test_15_초대_재발송(client, monkeypatch):
    tokens = _capture_invite_token(monkeypatch)
    admin = _platform_admin(client, "sys15@test.com")
    created = client.post(
        "/api/v1/admin/orgs",
        json=_org_payload("재발송센터", "orgadmin15@test.com"),
        headers=admin["h"],
    )
    org_id = created.json()["org"]["id"]

    res = client.post(f"/api/v1/admin/orgs/{org_id}/resend-invite", headers=admin["h"])
    assert res.status_code == 200, res.text
    assert res.json()["invite_sent"] is True
    assert res.json()["admin"]["email"] == "orgadmin15@test.com"
    assert len(tokens) == 2 and tokens[0] != tokens[1]

    # 재발송된 토큰으로도 설정 가능
    ok = client.post(
        "/api/v1/auth/set-password",
        json={"token": tokens[1].split("token=", 1)[1], "new_password": NEW_PASSWORD},
    )
    assert ok.status_code == 200


def test_16_재발송_레이트리밋_429(client, monkeypatch):
    _capture_invite_token(monkeypatch)
    admin = _platform_admin(client, "sys16@test.com")
    created = client.post(
        "/api/v1/admin/orgs",
        json=_org_payload("쿨다운센터", "orgadmin16@test.com"),
        headers=admin["h"],
    )
    org_id = created.json()["org"]["id"]

    assert client.post(f"/api/v1/admin/orgs/{org_id}/resend-invite", headers=admin["h"]).status_code == 200
    second = client.post(f"/api/v1/admin/orgs/{org_id}/resend-invite", headers=admin["h"])
    assert second.status_code == 429


def test_17_담당자없는_기관_재발송_404(client):
    admin = _platform_admin(client, "sys17@test.com")
    created = client.post("/api/v1/admin/orgs", json={"name": "무담당센터"}, headers=admin["h"])
    org_id = created.json()["org"]["id"]

    res = client.post(f"/api/v1/admin/orgs/{org_id}/resend-invite", headers=admin["h"])
    assert res.status_code == 404


def test_18_없는_기관_재발송_404(client):
    admin = _platform_admin(client, "sys18@test.com")
    res = client.post(f"/api/v1/admin/orgs/{uuid.uuid4()}/resend-invite", headers=admin["h"])
    assert res.status_code == 404


# ---------------------------------------------------------------------------
# 4. 레거시 가입 차단
# ---------------------------------------------------------------------------


def test_19_레거시_register로_상담사_가입_차단(client):
    res = client.post(
        "/api/v1/auth/register",
        json={
            "email": "legacy19@test.com",
            "password": VALID_PASSWORD,
            "name": "무소속상담사",
            "role": "counselor",
        },
    )
    assert res.status_code == 400
    assert "기관 코드" in res.json()["detail"]

    from app.models.user import User

    db = _db()
    try:
        assert db.query(User).filter(User.email == "legacy19@test.com").first() is None
    finally:
        db.close()


def test_20_레거시_register의_client는_계속_허용(client):
    res = client.post(
        "/api/v1/auth/register",
        json={
            "email": "legacy20@test.com",
            "password": VALID_PASSWORD,
            "name": "내담자",
            "role": "client",
        },
    )
    assert res.status_code == 201
    assert res.json()["role"] == "client"


def test_21_상담사는_기관코드_경로로만_가입(client):
    """SDD-015 경로는 기관 코드가 있으면 정상 동작한다."""
    code = create_test_org("정상센터")
    res = client.post(
        "/api/v1/auth/register/counselor",
        json={
            "org_code": code,
            "email": "c21@test.com",
            "password": VALID_PASSWORD,
            "name": "상담사",
            "email_verify_token": email_verify_service.generate_email_verify_token("c21@test.com"),
            "consents": _consents(),
        },
    )
    assert res.status_code == 201
    assert res.json()["user"]["role"] == "counselor"
