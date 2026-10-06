"""F1.2 로그인 QA 검증 — 잠금 포함"""

VALID_PASSWORD = "Passw0rd!"


def _register(client, email="user@test.com"):
    from app.services import email_verify_service
    payload = {
        "email": email,
        "password": VALID_PASSWORD,
        "name": "홍길동",
        "email_verify_token": email_verify_service.generate_email_verify_token(email),
        "consents": {"tos": True, "privacy": True, "sensitive": True},
    }
    res = client.post("/api/v1/auth/register/client", json=payload)
    assert res.status_code == 201, res.text


def test_로그인_성공(client):
    _register(client)
    res = client.post(
        "/api/v1/auth/login",
        json={"email": "user@test.com", "password": VALID_PASSWORD},
    )
    assert res.status_code == 200
    assert res.json()["access_token"]


def test_잘못된_비밀번호_401(client):
    _register(client)
    res = client.post(
        "/api/v1/auth/login",
        json={"email": "user@test.com", "password": "Wrong123!"},
    )
    assert res.status_code == 401
    assert res.json()["detail"] == "이메일 또는 비밀번호가 일치하지 않습니다"


def test_5회_실패_시_잠금_423(client):
    _register(client)
    for _ in range(5):
        client.post(
            "/api/v1/auth/login",
            json={"email": "user@test.com", "password": "Wrong123!"},
        )
    res = client.post(
        "/api/v1/auth/login",
        json={"email": "user@test.com", "password": VALID_PASSWORD},
    )
    assert res.status_code == 423
    assert "잠겼습니다" in res.json()["detail"]


def test_잠금_해제_후_로그인_성공(client, redis):
    _register(client)
    for _ in range(5):
        client.post(
            "/api/v1/auth/login",
            json={"email": "user@test.com", "password": "Wrong123!"},
        )
    # 관리자 잠금 해제 시나리오를 시뮬레이션 — AUTHZ-04: 이메일+IP 복합 키.
    # IP 는 요청 클라이언트마다 달라질 수 있으므로 이 테스트 전용 fakeredis 의 키를 비운다.
    import asyncio
    asyncio.run(redis.flushall())
    res = client.post(
        "/api/v1/auth/login",
        json={"email": "user@test.com", "password": VALID_PASSWORD},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["access_token"]
    assert body["user"]["email"] == "user@test.com"
    assert body["user"]["role"] == "client"
    # refresh 토큰은 httpOnly 쿠키로만 전달된다(XSS 탈취 방지)
    assert client.cookies.get("mb_refresh_token")
