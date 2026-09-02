"""SDD-020 — 플랫폼 관리자 회원(내담자) 관리 QA

- POST /admin/clients: 성공 / 이메일 중복 / 무효 상담사 / 미인증(비-active) 상담사
- GET /admin/users?role=client: primary_counselor 확장 + role allowlist 검증
- 비활성화 실효성: suspended 계정 로그인 차단
"""

import uuid

VALID_PASSWORD = "Passw0rd!"


def _consents() -> dict:
    return {"tos": True, "privacy": True, "sensitive": True}


def _db():
    from app.core.database import get_db
    from app.main import app as fastapi_app

    return next(fastapi_app.dependency_overrides[get_db]())


def _register(client, email: str, role: str = "counselor") -> dict:
    """counselor/client 가입. counselor 는 유효 기관 코드로 active 계정이 된다."""
    from app.services import email_verify_service
    from tests.conftest import create_test_org

    payload = {
        "org_code": create_test_org(),  # client 가입에서는 무시됨
        "email": email,
        "password": VALID_PASSWORD,
        "name": f"테스트{role}",
        "email_verify_token": email_verify_service.generate_email_verify_token(email),
        "consents": _consents(),
    }
    res = client.post(f"/api/v1/auth/register/{role}", json=payload)
    assert res.status_code == 201, res.text
    body = res.json()
    return {
        "id": body["user"]["id"],
        "token": body["access_token"],
        "h": {"Authorization": f"Bearer {body['access_token']}"},
    }


def _make_admin(client, email: str = "admin@test.com") -> dict:
    from app.models.user import User

    admin = _register(client, email, "counselor")
    db = _db()
    try:
        user = db.query(User).filter(User.id == uuid.UUID(admin["id"])).first()
        user.role = "platform_admin"
        db.add(user)
        db.commit()
    finally:
        db.close()
    return admin


def _mock_invite(monkeypatch) -> dict:
    """client 초대 메일 발송을 가로채 링크를 캡처하고 항상 성공(True) 반환."""
    captured: dict = {"links": []}

    def _fake(to_email, invite_link, *, client_name, counselor_name, expires_days):
        captured["links"].append(invite_link)
        return True

    monkeypatch.setattr("app.services.org_invite_service.send_client_invite_email", _fake)
    return captured


# ---------------------------------------------------------------------------
# POST /admin/clients
# ---------------------------------------------------------------------------


def test_회원_수동추가_성공(client, monkeypatch):
    captured = _mock_invite(monkeypatch)
    admin = _make_admin(client)
    counselor = _register(client, "counselor1@test.com", "counselor")

    res = client.post(
        "/api/v1/admin/clients",
        json={
            "name": "홍길동",
            "email": "Client1@Test.com",  # 대문자 → 정규화 확인
            "counselor_id": counselor["id"],
        },
        headers=admin["h"],
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["invite_sent"] is True
    c = body["client"]
    assert c["email"] == "client1@test.com"  # .strip().lower() 정규화
    assert c["status"] == "pending"
    assert c["verified_tier"] == "unverified"
    assert len(c["counselors"]) == 1
    assert c["counselors"][0]["id"] == counselor["id"]
    assert len(captured["links"]) == 1
    assert "/set-password?token=" in captured["links"][0]

    # DB 검증 — User(pending) + ClientProfile + active ClientCounselorLink
    from app.models.client_counselor_link import ClientCounselorLink
    from app.models.client_profile import ClientProfile
    from app.models.user import User

    db = _db()
    try:
        u = db.query(User).filter(User.email == "client1@test.com").first()
        assert u is not None and u.role == "client" and u.status == "pending"
        assert db.query(ClientProfile).filter(ClientProfile.user_id == u.id).first() is not None
        link = (
            db.query(ClientCounselorLink)
            .filter(ClientCounselorLink.client_id == u.id)
            .first()
        )
        assert link is not None and link.status == "active"
        assert str(link.counselor_id) == counselor["id"]
    finally:
        db.close()


def test_회원_수동추가_이메일_중복_409(client, monkeypatch):
    _mock_invite(monkeypatch)
    admin = _make_admin(client)
    counselor = _register(client, "counselor2@test.com", "counselor")

    payload = {
        "name": "홍길동",
        "email": "dup@test.com",
        "counselor_id": counselor["id"],
    }
    first = client.post("/api/v1/admin/clients", json=payload, headers=admin["h"])
    assert first.status_code == 201, first.text

    dup = client.post("/api/v1/admin/clients", json=payload, headers=admin["h"])
    assert dup.status_code == 409, dup.text


def test_회원_수동추가_무효_상담사_404(client, monkeypatch):
    _mock_invite(monkeypatch)
    admin = _make_admin(client)

    res = client.post(
        "/api/v1/admin/clients",
        json={
            "name": "홍길동",
            "email": "nocounselor@test.com",
            "counselor_id": str(uuid.uuid4()),  # 존재하지 않는 상담사
        },
        headers=admin["h"],
    )
    assert res.status_code == 404, res.text


def test_회원_수동추가_미인증_상담사_422(client, monkeypatch):
    """active 가 아닌(정지된) 상담사에게는 회원을 배정할 수 없다."""
    _mock_invite(monkeypatch)
    admin = _make_admin(client)
    counselor = _register(client, "inactive-c@test.com", "counselor")

    # 상담사를 suspend 하여 status != active 로 만든다
    r = client.post(
        f"/api/v1/admin/users/{counselor['id']}/suspend",
        json={"reason": "테스트 정지"},
        headers=admin["h"],
    )
    assert r.status_code == 200, r.text

    res = client.post(
        "/api/v1/admin/clients",
        json={
            "name": "홍길동",
            "email": "toinactive@test.com",
            "counselor_id": counselor["id"],
        },
        headers=admin["h"],
    )
    assert res.status_code == 422, res.text


def test_회원_수동추가_client_id_는_상담사_아님_422(client, monkeypatch):
    """counselor_id 에 내담자 id 를 주면 role 검증에서 422."""
    _mock_invite(monkeypatch)
    admin = _make_admin(client)
    a_client = _register(client, "notacounselor@test.com", "client")

    res = client.post(
        "/api/v1/admin/clients",
        json={
            "name": "홍길동",
            "email": "x@test.com",
            "counselor_id": a_client["id"],
        },
        headers=admin["h"],
    )
    assert res.status_code == 422, res.text


# ---------------------------------------------------------------------------
# GET /admin/users?role=client — primary_counselor + role allowlist
# ---------------------------------------------------------------------------


def test_회원목록_primary_counselor_노출(client, monkeypatch):
    _mock_invite(monkeypatch)
    admin = _make_admin(client)
    counselor = _register(client, "counselor3@test.com", "counselor")

    create = client.post(
        "/api/v1/admin/clients",
        json={
            "name": "이내담",
            "email": "listed@test.com",
            "counselor_id": counselor["id"],
        },
        headers=admin["h"],
    )
    assert create.status_code == 201, create.text

    res = client.get("/api/v1/admin/users?role=client", headers=admin["h"])
    assert res.status_code == 200, res.text
    items = res.json()["items"]
    target = next(i for i in items if i["email"] == "listed@test.com")
    assert target["primary_counselor"] is not None
    assert target["primary_counselor"]["id"] == counselor["id"]
    assert target["primary_counselor"]["name"]  # name 존재
    assert target["primary_counselor"]["email"] == "counselor3@test.com"


def test_회원목록_잘못된_role_422(client):
    admin = _make_admin(client)
    res = client.get("/api/v1/admin/users?role=superuser", headers=admin["h"])
    assert res.status_code == 422, res.text


# ---------------------------------------------------------------------------
# 비활성화 실효성 — suspended 로그인 차단
# ---------------------------------------------------------------------------


def test_정지된_계정_로그인_차단(client):
    admin = _make_admin(client)
    member = _register(client, "member@test.com", "client")

    # 정지 전에는 로그인 성공
    ok = client.post(
        "/api/v1/auth/login",
        json={"email": "member@test.com", "password": VALID_PASSWORD},
    )
    assert ok.status_code == 200, ok.text

    # 정지
    r = client.post(
        f"/api/v1/admin/users/{member['id']}/suspend",
        json={"reason": "테스트 정지"},
        headers=admin["h"],
    )
    assert r.status_code == 200, r.text

    # 정지 후에는 비밀번호가 맞아도 로그인 차단
    blocked = client.post(
        "/api/v1/auth/login",
        json={"email": "member@test.com", "password": VALID_PASSWORD},
    )
    assert blocked.status_code == 403, blocked.text
