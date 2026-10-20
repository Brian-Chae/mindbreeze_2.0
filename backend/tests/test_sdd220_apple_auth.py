"""SDD-220 TS9~TS11 — Sign in with Apple 서버 검증 (자체 RSA 키 JWKS mock, 실 Apple 호출 0)."""

import asyncio

import pytest
from sqlalchemy import func

from app.config import settings
from app.core.database import get_db
from app.main import app
from app.models.account_deletion import SocialIdentity
from app.models.consent import Consent
from app.models.user import User
from app.services import apple_auth_service
from tests.sdd220_helpers import APPLE_AUD, AppleKey, consents

URL = "/api/v1/auth/apple"


def _db():
    return next(app.dependency_overrides[get_db]())


@pytest.fixture(autouse=True)
def _apple_env(monkeypatch):
    monkeypatch.setattr(settings, "apple_client_ids", f"{APPLE_AUD},kr.test.web")
    monkeypatch.setattr(settings, "social_token_encryption_key", "")
    apple_auth_service.reset_cache()
    yield
    apple_auth_service.reset_cache()


@pytest.fixture(autouse=True)
def _strict_signup(client):
    """conftest 의 birth_date 기본값 보정을 끈다 — 서버 검증을 그대로 확인."""
    original = client.post

    def post(url, **kwargs):
        kwargs["headers"] = {"X-Test-Strict-Signup": "1", **(kwargs.get("headers") or {})}
        return original(url, **kwargs)

    client.post = post
    yield
    client.post = original


@pytest.fixture
def key(monkeypatch):
    k = AppleKey()
    state = {"keys": [k.public_jwk], "calls": 0, "fail": False}

    async def fake_fetch():
        state["calls"] += 1
        if state["fail"]:
            raise apple_auth_service.AppleUnavailable("down")
        return {"keys": state["keys"]}

    monkeypatch.setattr(apple_auth_service, "fetch_jwks", fake_fetch)
    k.state = state
    return k


def _challenge(client) -> str:
    res = client.post("/api/v1/auth/apple/challenge")
    assert res.status_code == 200, res.text
    return res.json()["nonce"]


def _body(key, client, **kw):
    nonce = kw.pop("nonce", None) or _challenge(client)
    token_kwargs = kw.pop("token", {})
    body = {
        "id_token": key.token(nonce=nonce, **token_kwargs),
        "nonce": nonce,
        "name": "김애플",
        "consents": consents(),
        "birth_date": "1990-05-01",
    }
    body.update(kw)
    return body


# ── TS9 ────────────────────────────────────────────────────────────────

def test_ts9_신규_가입_relay이메일_최초이름_동의버전(client, key, monkeypatch):
    from cryptography.fernet import Fernet

    monkeypatch.setattr(settings, "social_token_encryption_key", Fernet.generate_key().decode())

    async def fake_exchange(code, client_id):
        assert client_id == APPLE_AUD and code == "auth-code"
        return "apple-refresh-secret"

    monkeypatch.setattr(apple_auth_service, "exchange_authorization_code", fake_exchange)
    res = client.post(URL, json=_body(key, client, authorization_code="auth-code",
                                      token={"sub": "sub-new", "email": "abc123@privaterelay.appleid.com"}))
    assert res.status_code == 200, res.text
    assert "apple-refresh-secret" not in res.text and "auth-code" not in res.text
    db = _db()
    users = db.query(User).all()
    assert len(users) == 1
    user = users[0]
    assert user.auth_provider == "apple" and user.role == "client"
    assert user.email == "abc123@privaterelay.appleid.com"
    assert user.name == "김애플"
    idents = db.query(SocialIdentity).all()
    assert len(idents) == 1 and idents[0].subject == "sub-new" and idents[0].client_id == APPLE_AUD
    # refresh token 은 암호문으로만 저장
    assert idents[0].encrypted_refresh_token and "apple-refresh-secret" not in idents[0].encrypted_refresh_token
    assert apple_auth_service.decrypt_token(idents[0].encrypted_refresh_token) == "apple-refresh-secret"
    rows = {c.type: c for c in db.query(Consent).filter(Consent.user_id == user.id).all()}
    assert set(rows) == {"tos", "privacy", "sensitive", "eeg", "research"}
    assert all(r.version == "1.0" for r in rows.values())
    assert rows["tos"].agreed and not rows["eeg"].agreed and not rows["research"].agreed
    assert str(user.birth_date) == "1990-05-01"


def test_ts9_SHA256_해시_nonce도_허용(client, key):
    res = client.post(URL, json=_body(key, client, token={"hashed_nonce": True}))
    assert res.status_code == 200, res.text


# ── TS10 ───────────────────────────────────────────────────────────────

def test_ts10_같은_sub_재로그인은_생일동의없이_200_이름유지(client, key):
    first = client.post(URL, json=_body(key, client, token={"sub": "sub-x"}))
    assert first.status_code == 200
    n = _challenge(client)
    again = client.post(URL, json={"id_token": key.token(sub="sub-x", nonce=n), "nonce": n, "name": "바뀐이름"})
    assert again.status_code == 200, again.text
    assert again.json()["user"]["id"] == first.json()["user"]["id"]
    db = _db()
    assert db.query(User).count() == 1
    assert db.query(User).first().name == "김애플"


def test_ts10_다른_sub_같은_이메일은_자동병합_없이_409(client, key):
    ok = client.post(URL, json=_body(key, client, token={"sub": "sub-a", "email": "same@x.com"}))
    assert ok.status_code == 200
    res = client.post(URL, json=_body(key, client, token={"sub": "sub-b", "email": "same@x.com"}))
    assert res.status_code == 409 and res.json()["detail"]["code"] == "ACCOUNT_LINK_REQUIRED"
    db = _db()
    assert db.query(User).count() == 1 and db.query(SocialIdentity).count() == 1


def test_ts10_기존_이메일_계정과도_자동병합_안함(client, key):
    from tests.sdd220_helpers import email_register_payload

    assert client.post("/api/v1/auth/register/client", json=email_register_payload("mine@x.com")).status_code == 201
    res = client.post(URL, json=_body(key, client, token={"sub": "sub-m", "email": "MINE@x.com"}))
    assert res.status_code == 409 and res.json()["detail"]["code"] == "ACCOUNT_LINK_REQUIRED"
    assert _db().query(SocialIdentity).count() == 0


@pytest.mark.parametrize("role", ["counselor", "org_admin", "platform_admin"])
def test_ts10_역할_조작으로_신규_계정_권한상승_불가(client, key, role):
    res = client.post(URL, json=_body(key, client, role=role))
    assert res.status_code == 403
    assert _db().query(User).count() == 0


def test_ts10_동시_최초가입은_사용자_최대_1명(client, key):
    """같은 sub 로 서로 다른 nonce 2개가 연달아 도착해도 sub 고유 제약으로 사용자는 1명."""
    bodies = [_body(key, client, token={"sub": "sub-race", "email": "race@x.com"}) for _ in range(2)]
    results = [client.post(URL, json=b) for b in bodies]
    assert sorted(r.status_code for r in results) in ([200, 200], [200, 409])
    assert _db().query(User).count() == 1


# ── TS11 ───────────────────────────────────────────────────────────────

def _assert_invalid(client, res):
    assert res.status_code == 401, res.text
    assert res.json()["detail"]["code"] == "APPLE_TOKEN_INVALID"
    db = _db()
    assert db.query(User).count() == 0 and db.query(SocialIdentity).count() == 0
    assert "access_token" not in res.text


def test_ts11_서명_위조(client, key):
    other = AppleKey(kid=key.kid)  # 같은 kid, 다른 개인키
    nonce = _challenge(client)
    body = {"id_token": other.token(nonce=nonce), "nonce": nonce, "consents": consents(), "birth_date": "1990-01-01"}
    _assert_invalid(client, client.post(URL, json=body))


@pytest.mark.parametrize("tok", [
    {"iss": "https://evil.example.com"},
    {"aud": "kr.other.app"},
    {"exp_delta": -10},
])
def test_ts11_claim_위조_만료(client, key, tok):
    _assert_invalid(client, client.post(URL, json=_body(key, client, token=tok)))


def test_ts11_alg_none과_HS256_거부(client, key):
    from jose import jwt

    nonce = _challenge(client)
    none_tok = "e30.".replace("e30", "eyJhbGciOiJub25lIiwia2lkIjoia2lkLTEifQ") + "eyJzdWIiOiJ4In0."
    hs = jwt.encode({"iss": "https://appleid.apple.com", "aud": APPLE_AUD, "sub": "x", "exp": 9999999999, "nonce": nonce},
                    "secret", algorithm="HS256", headers={"kid": key.kid})
    for t in (none_tok, hs):
        res = client.post(URL, json={"id_token": t, "nonce": nonce, "consents": consents(), "birth_date": "1990-01-01"})
        _assert_invalid(client, res)


def test_ts11_nonce_누락_불일치_재사용(client, key):
    nonce = _challenge(client)
    # 누락: id_token 에 nonce claim 없음
    no_claim = {"id_token": key.token(nonce=None), "nonce": nonce, "consents": consents(), "birth_date": "1990-01-01"}
    _assert_invalid(client, client.post(URL, json=no_claim))
    # 불일치
    other = _challenge(client)
    mismatch = {"id_token": key.token(nonce=other), "nonce": nonce, "consents": consents(), "birth_date": "1990-01-01"}
    _assert_invalid(client, client.post(URL, json=mismatch))
    # 서버가 발급하지 않은 임의 nonce
    forged = "client-made-nonce-123456"
    res = client.post(URL, json={"id_token": key.token(nonce=forged), "nonce": forged,
                                 "consents": consents(), "birth_date": "1990-01-01"})
    _assert_invalid(client, res)
    # 성공 1회 후 재사용
    ok = _body(key, client, token={"sub": "sub-once"})
    assert client.post(URL, json=ok).status_code == 200
    replay = client.post(URL, json={**ok, "id_token": key.token(sub="sub-once", nonce=ok["nonce"])})
    assert replay.status_code == 401 and replay.json()["detail"]["code"] == "APPLE_TOKEN_INVALID"


def test_ts11_병렬_replay도_성공_최대_1회(client, key):
    """같은 nonce 소비는 원자적이다 — DEL 이 1 을 돌려준 호출만 성공."""
    _, fake = client.app.dependency_overrides, None
    from app.core.redis import get_redis

    redis = app.dependency_overrides[get_redis]()
    nonce = asyncio.run(apple_auth_service.issue_challenge(redis))

    async def race():
        return await asyncio.gather(*[apple_auth_service.consume_challenge(redis, nonce) for _ in range(5)])

    assert sum(asyncio.run(race())) == 1


def test_ts11_검증_실패_422는_nonce를_소비하지_않아_같은_토큰으로_재제출(client, key):
    body = _body(key, client, token={"sub": "sub-retry"})
    no_birth = {**body}
    no_birth.pop("birth_date")
    first = client.post(URL, json=no_birth)
    assert first.status_code == 422 and first.json()["detail"]["code"] == "BIRTH_DATE_REQUIRED"
    assert _db().query(User).count() == 0
    assert client.post(URL, json=body).status_code == 200


def test_ts11_키_회전은_캐시_갱신_후_성공(client, key):
    new_key = AppleKey(kid="kid-2")
    assert client.post(URL, json=_body(key, client, token={"sub": "s-old"})).status_code == 200
    key.state["keys"] = [key.public_jwk, new_key.public_jwk]
    res = client.post(URL, json=_body(new_key, client, token={"sub": "s-new", "kid": "kid-2", "email": "new2@x.com"}))
    assert res.status_code == 200, res.text


def test_ts11_JWKS_장애는_503_우회없음(client, key):
    key.state["fail"] = True
    res = client.post(URL, json=_body(key, client))
    assert res.status_code == 503 and res.json()["detail"]["code"] == "APPLE_UNAVAILABLE"
    assert _db().query(User).count() == 0


def test_ts11_허용_aud_목록이_비면_모두_거부(client, key, monkeypatch):
    monkeypatch.setattr(settings, "apple_client_ids", "")
    _assert_invalid(client, client.post(URL, json=_body(key, client)))
