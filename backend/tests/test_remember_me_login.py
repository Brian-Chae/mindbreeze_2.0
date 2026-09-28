"""자동 로그인(로그인 상태 유지) — remember_me 기반 refresh 쿠키 분기 + secure 보정 QA.

검증 항목
- remember_me=True  → refresh 쿠키에 Max-Age(14일) 지정(지속 쿠키)
- remember_me=False → Max-Age 미지정(브라우저 세션 쿠키, 창 닫으면 로그아웃)
- 미지정(하위 호환) → 기존과 동일하게 지속 쿠키
- secure 플래그는 environment 문자열이 아니라 요청 scheme 을 따른다
  (https → Secure, http → non-secure, X-Forwarded-Proto 프록시 헤더 반영)
- refresh 토큰 회전 시에도 최초 remember 선택이 유지된다
- 로그인/회원가입/Google 3개 진입점 모두 반영
"""

from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient

from app.config import settings
from app.main import app as fastapi_app
from app.services import email_verify_service

VALID_PASSWORD = "Passw0rd!"

# 지속 쿠키 만료(초) — 설정값 기준으로 계산해 .env 변경에도 견디게 한다.
EXPECTED_MAX_AGE = settings.refresh_token_expire_days * 24 * 60 * 60


# ---------------------------------------------------------------------------
# 헬퍼
# ---------------------------------------------------------------------------

def _refresh_cookie_header(response) -> str:
    """응답의 Set-Cookie 중 refresh 쿠키 헤더 원문을 반환한다."""
    for value in response.headers.get_list("set-cookie"):
        if value.startswith("mb_refresh_token="):
            return value
    raise AssertionError(f"refresh 쿠키가 응답에 없습니다: {response.headers.get_list('set-cookie')}")


def _refresh_cookie_value(response) -> str:
    return response.cookies.get("mb_refresh_token")


def _register(client, email="remember@test.com", **extra):
    payload = {
        "email": email,
        "password": VALID_PASSWORD,
        "name": "홍길동",
        "email_verify_token": email_verify_service.generate_email_verify_token(email),
        "consents": {"tos": True, "privacy": True, "sensitive": True},
        **extra,
    }
    res = client.post("/api/v1/auth/register/client", json=payload)
    assert res.status_code == 201, res.text
    return res


def _https_client() -> TestClient:
    """같은 앱(의존성 오버라이드 공유) + https scheme 클라이언트."""
    return TestClient(fastapi_app, base_url="https://testserver")


def _google(email: str):
    response = MagicMock(status_code=200)
    response.json.return_value = {"email": email, "name": "테스트"}
    return patch("httpx.AsyncClient.get", AsyncMock(return_value=response))


# ---------------------------------------------------------------------------
# 1. remember_me 분기 — 로그인
# ---------------------------------------------------------------------------

def test_로그인_remember_me_true_지속쿠키(client):
    _register(client)
    res = client.post(
        "/api/v1/auth/login",
        json={"email": "remember@test.com", "password": VALID_PASSWORD, "remember_me": True},
    )
    assert res.status_code == 200, res.text
    header = _refresh_cookie_header(res).lower()
    assert f"max-age={EXPECTED_MAX_AGE}" in header
    assert "httponly" in header
    assert "path=/api/v1/auth" in header


def test_로그인_remember_me_false_세션쿠키(client):
    _register(client)
    res = client.post(
        "/api/v1/auth/login",
        json={"email": "remember@test.com", "password": VALID_PASSWORD, "remember_me": False},
    )
    assert res.status_code == 200, res.text
    header = _refresh_cookie_header(res).lower()
    # 세션 쿠키 — Max-Age/Expires 모두 없어야 브라우저가 창을 닫을 때 삭제한다.
    assert "max-age" not in header
    assert "expires" not in header
    assert "httponly" in header


def test_로그인_remember_me_미지정_기본_지속쿠키(client):
    """하위 호환 — 필드를 보내지 않는 기존 클라이언트는 지속 쿠키를 받는다."""
    _register(client)
    res = client.post(
        "/api/v1/auth/login",
        json={"email": "remember@test.com", "password": VALID_PASSWORD},
    )
    assert res.status_code == 200, res.text
    assert f"max-age={EXPECTED_MAX_AGE}" in _refresh_cookie_header(res).lower()


# ---------------------------------------------------------------------------
# 2. secure 플래그 — 요청 scheme 기반
# ---------------------------------------------------------------------------

def test_http_요청은_non_secure_쿠키(client):
    _register(client)
    res = client.post(
        "/api/v1/auth/login",
        json={"email": "remember@test.com", "password": VALID_PASSWORD},
    )
    assert res.status_code == 200, res.text
    assert "secure" not in _refresh_cookie_header(res).lower()


def test_https_요청은_secure_쿠키(app_client):
    """운영(https) 보안 유지 — scheme 이 https 면 Secure 플래그가 붙는다."""
    https = _https_client()
    _register(https, email="https@test.com")
    res = https.post(
        "/api/v1/auth/login",
        json={"email": "https@test.com", "password": VALID_PASSWORD},
    )
    assert res.status_code == 200, res.text
    header = _refresh_cookie_header(res).lower()
    assert "secure" in header
    assert f"max-age={EXPECTED_MAX_AGE}" in header


def test_리버스프록시_forwarded_proto_https_반영(client):
    """프록시 뒤 http 연결이지만 X-Forwarded-Proto: https 이면 Secure 로 발급한다."""
    _register(client, email="proxy@test.com")
    res = client.post(
        "/api/v1/auth/login",
        json={"email": "proxy@test.com", "password": VALID_PASSWORD, "remember_me": False},
        headers={"X-Forwarded-Proto": "https"},
    )
    assert res.status_code == 200, res.text
    header = _refresh_cookie_header(res).lower()
    assert "secure" in header
    assert "max-age" not in header  # remember_me=False 는 세션 쿠키 유지


def test_forwarded_proto_http_는_non_secure(client):
    _register(client, email="proxy2@test.com")
    res = client.post(
        "/api/v1/auth/login",
        json={"email": "proxy2@test.com", "password": VALID_PASSWORD},
        headers={"X-Forwarded-Proto": "http"},
    )
    assert res.status_code == 200, res.text
    assert "secure" not in _refresh_cookie_header(res).lower()


# ---------------------------------------------------------------------------
# 3. refresh 회전 시 remember 선택 유지
# ---------------------------------------------------------------------------

def test_refresh_세션쿠키_선택_유지(client):
    _register(client)
    login = client.post(
        "/api/v1/auth/login",
        json={"email": "remember@test.com", "password": VALID_PASSWORD, "remember_me": False},
    )
    token = _refresh_cookie_value(login)
    assert token

    res = client.post("/api/v1/auth/refresh", cookies={"mb_refresh_token": token})
    assert res.status_code == 200, res.text
    header = _refresh_cookie_header(res).lower()
    assert "max-age" not in header
    assert "expires" not in header


def test_refresh_지속쿠키_선택_유지(client):
    _register(client)
    login = client.post(
        "/api/v1/auth/login",
        json={"email": "remember@test.com", "password": VALID_PASSWORD, "remember_me": True},
    )
    token = _refresh_cookie_value(login)
    assert token

    res = client.post("/api/v1/auth/refresh", cookies={"mb_refresh_token": token})
    assert res.status_code == 200, res.text
    assert f"max-age={EXPECTED_MAX_AGE}" in _refresh_cookie_header(res).lower()


def test_기존_토큰_remember_클레임_없으면_지속_폴백(client):
    """클레임 도입 전 발급된 토큰도 기존 동작(지속 쿠키)으로 회전한다."""
    from jose import jwt

    _register(client)
    login = client.post(
        "/api/v1/auth/login",
        json={"email": "remember@test.com", "password": VALID_PASSWORD},
    )
    token = _refresh_cookie_value(login)

    # remember 클레임을 제거한(구버전) 토큰으로 치환
    payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    payload.pop("remember", None)
    legacy = jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)

    res = client.post("/api/v1/auth/refresh", cookies={"mb_refresh_token": legacy})
    assert res.status_code == 200, res.text
    assert f"max-age={EXPECTED_MAX_AGE}" in _refresh_cookie_header(res).lower()


# ---------------------------------------------------------------------------
# 4. 회원가입 / Google 진입점
# ---------------------------------------------------------------------------

def test_회원가입_remember_me_false_세션쿠키(client):
    res = _register(client, email="signup@test.com", remember_me=False)
    header = _refresh_cookie_header(res).lower()
    assert "max-age" not in header
    assert "expires" not in header


def test_회원가입_remember_me_true_지속쿠키(client):
    res = _register(client, email="signup2@test.com", remember_me=True)
    assert f"max-age={EXPECTED_MAX_AGE}" in _refresh_cookie_header(res).lower()


def test_google_로그인_remember_me_false_세션쿠키(client):
    with _google("google@test.com"):
        res = client.post(
            "/api/v1/auth/google",
            json={"access_token": "valid", "remember_me": False},
        )
    assert res.status_code == 200, res.text
    header = _refresh_cookie_header(res).lower()
    assert "max-age" not in header
    assert "expires" not in header


def test_google_로그인_remember_me_true_지속쿠키(client):
    with _google("google2@test.com"):
        res = client.post(
            "/api/v1/auth/google",
            json={"access_token": "valid", "remember_me": True},
        )
    assert res.status_code == 200, res.text
    assert f"max-age={EXPECTED_MAX_AGE}" in _refresh_cookie_header(res).lower()
