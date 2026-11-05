"""SDD-309 — 소셜(Google·Apple) 신규 가입 코치 코드 필수화 (verify.md V01~V08)."""

import pytest

from app.config import settings
from app.core.database import get_db
from app.main import app
from app.models.chat import ChatRoom
from app.models.client_counselor_link import ClientCounselorLink
from app.models.counselor_profile import CounselorProfile
from app.models.user import User
from app.services import apple_auth_service
from tests.sdd220_helpers import APPLE_AUD, AppleKey, consents
from tests.test_mb2_auth4_mid_fixes import _make_counselor_with_code
from tests.test_sdd072_login_roles import _google

GOOGLE = "/api/v1/auth/google"
APPLE = "/api/v1/auth/apple"
STRICT = {"X-Test-Strict-Signup": "1"}


def _db():
    return next(app.dependency_overrides[get_db]())


@pytest.fixture(autouse=True)
def _gate_on(monkeypatch):
    monkeypatch.setattr(settings, "social_signup_requires_counselor_code", True)
    monkeypatch.setattr(settings, "apple_client_ids", f"{APPLE_AUD},kr.test.web")
    monkeypatch.setattr(settings, "social_token_encryption_key", "")
    apple_auth_service.reset_cache()
    yield
    apple_auth_service.reset_cache()


@pytest.fixture
def counselor():
    with _db() as db:
        user = _make_counselor_with_code(db, email="coach309@test.com", code="123456")
        return str(user.id)


def _google_body(**kw):
    body = {"access_token": "valid", "role": "client", "consents": consents(),
            "birth_date": "1990-05-01", "gender": "female"}
    body.update(kw)
    return body


def _user_count(email_prefix: str) -> int:
    with _db() as db:
        return db.query(User).filter(User.email.like(f"{email_prefix}%")).count()


def test_v01_google_신규_코드없음_422(client, counselor):
    with _google("g1@test.com"):
        res = client.post(GOOGLE, json=_google_body(), headers=STRICT)
    assert res.status_code == 422
    assert res.json()["detail"]["code"] == "COUNSELOR_CODE_REQUIRED"
    assert "코치 코드" in res.json()["detail"]["message"]
    assert _user_count("g1@") == 0


def test_v02_google_신규_유효코드_연결(client, counselor):
    with _google("g2@test.com"):
        res = client.post(GOOGLE, json=_google_body(counselor_code="123456"), headers=STRICT)
    assert res.status_code == 200, res.text
    with _db() as db:
        user = db.query(User).filter(User.email == "g2@test.com").one()
        link = db.query(ClientCounselorLink).filter_by(client_id=user.id).one()
        assert str(link.counselor_id) == counselor and link.status == "active"
        assert db.query(ChatRoom).count() >= 1
    me = client.get("/api/v1/onboarding/progress", headers={"Authorization": f"Bearer {res.json()['access_token']}"})
    if me.status_code == 200:
        assert "step4" in (me.json().get("steps") or {})


@pytest.mark.parametrize("bad,status", [("999999", 404), ("12", 400)])
def test_v03_google_잘못된코드_가입행없음(client, counselor, bad, status):
    with _google("g3@test.com"):
        res = client.post(GOOGLE, json=_google_body(counselor_code=bad), headers=STRICT)
    assert res.status_code == status, res.text
    assert _user_count("g3@") == 0


def test_v04_google_초대토큰은_코드_면제(client, counselor):
    with _google("g4@test.com"):
        res = client.post(GOOGLE, json=_google_body(invite_token="no-such-token"), headers=STRICT)
    assert res.status_code == 200, res.text


def test_v05_google_기존가입자_재로그인은_코드_불필요(client, counselor):
    with _google("g5@test.com"):
        first = client.post(GOOGLE, json=_google_body(counselor_code="123456"), headers=STRICT)
        assert first.status_code == 200
        again = client.post(GOOGLE, json={"access_token": "valid", "role": "client"}, headers=STRICT)
    assert again.status_code == 200, again.text


def test_v08_상담사_기관_신규_소셜은_코드요구가_아닌_기존_403(client, counselor):
    with _google("g8@test.com"):
        res = client.post(GOOGLE, json={"access_token": "valid", "role": "counselor"}, headers=STRICT)
    assert res.status_code == 403
    assert _user_count("g8@") == 0


# ── Apple ─────────────────────────────────────────────────────────────

@pytest.fixture
def key(monkeypatch):
    k = AppleKey()

    async def fake_fetch():
        return {"keys": [k.public_jwk]}

    monkeypatch.setattr(apple_auth_service, "fetch_jwks", fake_fetch)
    return k


def _apple_body(key, client, **kw):
    nonce = client.post("/api/v1/auth/apple/challenge").json()["nonce"]
    token_kwargs = kw.pop("token", {})
    body = {"id_token": key.token(nonce=nonce, **token_kwargs), "nonce": nonce, "name": "김애플",
            "consents": consents(), "birth_date": "1990-05-01", "gender": "female"}
    body.update(kw)
    return body


def test_v06_apple_신규_코드없음_422_nonce_미소비(client, counselor, key):
    body = _apple_body(key, client, token={"sub": "sub-309a", "email": "a309@privaterelay.appleid.com"})
    res = client.post(APPLE, json=body, headers=STRICT)
    assert res.status_code == 422
    assert res.json()["detail"]["code"] == "COUNSELOR_CODE_REQUIRED"
    assert _user_count("a309@") == 0
    retry = client.post(APPLE, json={**body, "counselor_code": "123456"}, headers=STRICT)
    assert retry.status_code == 200, retry.text


def test_v07_apple_유효코드_연결_재로그인은_코드불필요(client, counselor, key):
    body = _apple_body(key, client, token={"sub": "sub-309b", "email": "b309@privaterelay.appleid.com"},
                       counselor_code="123456")
    res = client.post(APPLE, json=body, headers=STRICT)
    assert res.status_code == 200, res.text
    with _db() as db:
        user = db.query(User).filter(User.email == "b309@privaterelay.appleid.com").one()
        link = db.query(ClientCounselorLink).filter_by(client_id=user.id).one()
        assert str(link.counselor_id) == counselor
    again = _apple_body(key, client, token={"sub": "sub-309b", "email": "b309@privaterelay.appleid.com"})
    again.pop("consents"); again.pop("birth_date"); again.pop("gender")
    assert client.post(APPLE, json=again, headers=STRICT).status_code == 200


def test_v07b_apple_잘못된코드는_가입행없음(client, counselor, key):
    body = _apple_body(key, client, token={"sub": "sub-309c", "email": "c309@privaterelay.appleid.com"},
                       counselor_code="999999")
    res = client.post(APPLE, json=body, headers=STRICT)
    assert res.status_code == 404
    assert _user_count("c309@") == 0
