"""MB2-AUTH-01 / MB2-AUTH-02 회귀 테스트

- MB2-AUTH-01: Google 로그인도 기존 계정의 suspended/pending 상태를 차단한다.
- MB2-AUTH-02: 이메일을 대소문자 무관하게 동일 계정으로 취급한다(저장 정규화 + 조회 lower).
"""

from unittest.mock import AsyncMock, MagicMock, patch

VALID_PASSWORD = "Passw0rd!"


def _consents():
    return {"tos": True, "privacy": True, "sensitive": True}


def _db():
    from app.core.database import get_db
    from app.main import app

    return next(app.dependency_overrides[get_db]())


def _register(client, email: str):
    """register/client 로 실제 가입 — email_verify_token 은 같은 이메일로 발급."""
    from app.services import email_verify_service

    res = client.post(
        "/api/v1/auth/register/client",
        json={
            "email": email,
            "password": VALID_PASSWORD,
            "name": "테스트",
            "email_verify_token": email_verify_service.generate_email_verify_token(email),
            "consents": _consents(),
        },
    )
    assert res.status_code == 201, res.text
    return res.json()


def _google(email: str):
    """userinfo + tokeninfo(aud) 를 URL 로 구분해 흉내내는 mock."""

    def _side_effect(url, **kwargs):
        resp = MagicMock(status_code=200)
        if "userinfo" in str(url):
            resp.json.return_value = {"email": email, "name": "구글유저"}
        else:  # tokeninfo — audience 검증 통과
            resp.json.return_value = {"aud": "test-client-id"}
        return resp

    return patch("httpx.AsyncClient.get", AsyncMock(side_effect=_side_effect))


def _set_status(email: str, status_value: str) -> None:
    from app.models.user import User
    from sqlalchemy import func

    db = _db()
    try:
        user = db.query(User).filter(func.lower(User.email) == email.lower()).one()
        user.status = status_value
        db.commit()
    finally:
        db.close()


# ---------------------------------------------------------------------------
# MB2-AUTH-02: 이메일 대소문자 정규화
# ---------------------------------------------------------------------------


def test_가입시_이메일_소문자_저장(client):
    """대문자로 가입해도 응답·DB 모두 소문자로 정규화된다."""
    body = _register(client, "MiXeD@Example.com")
    assert body["user"]["email"] == "mixed@example.com"

    from app.models.user import User

    db = _db()
    try:
        assert db.query(User).filter(User.email == "mixed@example.com").first() is not None
    finally:
        db.close()


def test_로그인_대소문자_무관_동일계정(client):
    """소문자로 저장된 계정에 대문자 이메일로 로그인해도 성공한다."""
    _register(client, "user@test.com")
    res = client.post(
        "/api/v1/auth/login",
        json={"email": "User@TEST.com", "password": VALID_PASSWORD},
    )
    assert res.status_code == 200, res.text
    assert res.json()["user"]["email"] == "user@test.com"


def test_중복가입_대소문자_변형_409(client):
    """대소문자만 다른 동일 이메일로는 재가입할 수 없다."""
    _register(client, "dupcase@test.com")
    from app.services import email_verify_service

    res = client.post(
        "/api/v1/auth/register/client",
        json={
            "email": "DupCase@test.com",
            "password": VALID_PASSWORD,
            "name": "중복",
            "email_verify_token": email_verify_service.generate_email_verify_token(
                "DupCase@test.com"
            ),
            "consents": _consents(),
        },
    )
    assert res.status_code == 409, res.text


def test_구글_신규가입_이메일_소문자_정규화(client):
    with _google("NewUser@Test.com"):
        res = client.post(
            "/api/v1/auth/google",
            json={"access_token": "valid", "consents": _consents()},
        )
    assert res.status_code == 200, res.text
    assert res.json()["user"]["email"] == "newuser@test.com"


def test_구글_기존계정_대소문자_무관_동일계정(client):
    """소문자 이메일로 가입된 계정에 대문자 Google 이메일로 로그인 → 새 계정 생성 없이 동일 계정."""
    created = _register(client, "g-case@test.com")
    user_id = created["user"]["id"]

    with _google("G-Case@Test.com"):
        res = client.post(
            "/api/v1/auth/google",
            json={"access_token": "valid"},  # 기존 사용자 → consents 불필요
        )
    assert res.status_code == 200, res.text
    assert res.json()["user"]["id"] == user_id
    assert res.json()["user"]["email"] == "g-case@test.com"

    from app.models.user import User
    from sqlalchemy import func

    db = _db()
    try:
        assert db.query(User).filter(func.lower(User.email) == "g-case@test.com").count() == 1
    finally:
        db.close()


# ---------------------------------------------------------------------------
# MB2-AUTH-01: Google 로그인 계정 상태 검사
# ---------------------------------------------------------------------------


def test_구글_정지계정_로그인_403(client):
    """suspended 계정은 기존 사용자 Google 로그인도 403 으로 차단한다."""
    _register(client, "susp@test.com")
    _set_status("susp@test.com", "suspended")

    with _google("susp@test.com"):
        res = client.post(
            "/api/v1/auth/google",
            json={"access_token": "valid"},
        )
    assert res.status_code == 403, res.text
    assert "정지" in res.json()["detail"]


def test_구글_pending계정_로그인_403(client):
    """pending(초대 수락 전) 계정은 기존 사용자 Google 로그인도 403 으로 차단한다."""
    _register(client, "pend@test.com")
    _set_status("pend@test.com", "pending")

    with _google("pend@test.com"):
        res = client.post(
            "/api/v1/auth/google",
            json={"access_token": "valid"},
        )
    assert res.status_code == 403, res.text
    assert "초대 수락" in res.json()["detail"]


def test_구글_active계정_로그인_200(client):
    """active 계정은 정상 로그인(상태 게이트가 정상 계정을 막지 않는다)."""
    _register(client, "active-g@test.com")

    with _google("active-g@test.com"):
        res = client.post(
            "/api/v1/auth/google",
            json={"access_token": "valid"},
        )
    assert res.status_code == 200, res.text
    assert res.json()["user"]["email"] == "active-g@test.com"
