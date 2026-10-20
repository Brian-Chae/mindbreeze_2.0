"""SDD-220 TS16~TS20, TS23(일부) — 즉시 탈퇴·재인증·소셜 연결 해제 outbox·공개 접수."""

import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from cryptography.fernet import Fernet

from app.config import settings
from app.core.database import get_db
from app.main import app
from app.models.account_deletion import (
    AccountDeletionLedger,
    AccountDeletionRequest,
    SocialIdentity,
    SocialRevokeOutbox,
)
from app.models.device_token import DeviceToken
from app.models.refresh_token import RefreshToken
from app.models.session import Session as SessionModel
from app.models.user import User
from app.models.user_org_membership import UserOrgMembership
from app.services import account_deletion_service as svc
from app.services import apple_auth_service
from tests.sdd220_helpers import (
    APPLE_AUD,
    AppleKey,
    VALID_PASSWORD,
    auth_headers,
    email_register_payload,
    ensure_account_routes,
    make_org,
    make_user,
)

DELETE = "/api/v1/users/me"
REAUTH = "/api/v1/users/me/reauth"


@pytest.fixture(autouse=True)
def _routes(monkeypatch):
    ensure_account_routes()
    monkeypatch.setattr(settings, "apple_client_ids", APPLE_AUD)
    monkeypatch.setattr(settings, "social_token_encryption_key", Fernet.generate_key().decode())
    apple_auth_service.reset_cache()


def _db():
    return next(app.dependency_overrides[get_db]())


def _delete(client, user, **body):
    return client.request("DELETE", DELETE, json=body, headers=auth_headers(user))


def _google_patch(email):
    def _side(url, **kwargs):
        resp = MagicMock(status_code=200)
        resp.json.return_value = {"email": email} if "userinfo" in str(url) else {"aud": "test-client-id", "email": email}
        return resp

    return patch("httpx.AsyncClient.get", AsyncMock(side_effect=_side))


def _apple_setup(monkeypatch, db, user, sub="apple-sub-1", with_token=True):
    key = AppleKey()

    async def fake_fetch():
        return {"keys": [key.public_jwk]}

    monkeypatch.setattr(apple_auth_service, "fetch_jwks", fake_fetch)
    db.add(SocialIdentity(user_id=user.id, provider="apple", subject=sub, email=user.email, client_id=APPLE_AUD,
                          encrypted_refresh_token=apple_auth_service.encrypt_token("apple-refresh") if with_token else None))
    db.commit()
    return key


def _apple_reauth(client, key, user, sub="apple-sub-1"):
    nonce = client.post("/api/v1/auth/apple/challenge").json()["nonce"]
    return client.post(REAUTH, json={"provider": "apple", "id_token": key.token(sub=sub, nonce=nonce), "nonce": nonce},
                       headers=auth_headers(user))


# ── TS16 ──────────────────────────────────────────────────────────────

@pytest.mark.parametrize("role", ["client", "counselor", "org_admin"])
@pytest.mark.parametrize("provider", ["email", "google", "apple"])
def test_ts16_역할x로그인_탈퇴_204_상태전환(client, monkeypatch, role, provider):
    db = _db()
    org = make_org(db) if role != "client" else None
    user = make_user(db, "me@x.com", role=role, provider=provider, org_id=org.id if org else None)
    if role == "org_admin":
        make_user(db, "other-admin@x.com", role="org_admin", org_id=org.id)  # 단독 관리자 아님
    before = datetime.now(timezone.utc)
    if provider == "email":
        res = _delete(client, user, password=VALID_PASSWORD)
    elif provider == "google":
        with _google_patch("me@x.com"):
            proof = client.post(REAUTH, json={"provider": "google", "access_token": "gtoken"}, headers=auth_headers(user))
        assert proof.status_code == 200, proof.text
        res = _delete(client, user, reauth_proof=proof.json()["reauth_proof"])
    else:
        key = _apple_setup(monkeypatch, db, user)
        proof = _apple_reauth(client, key, user)
        assert proof.status_code == 200, proof.text
        res = _delete(client, user, reauth_proof=proof.json()["reauth_proof"])
    assert res.status_code == 204, res.text
    # refresh cookie 만료
    assert "mb_refresh_token" in res.headers.get("set-cookie", "")
    assert 'Max-Age=0' in res.headers["set-cookie"] or "expires" in res.headers["set-cookie"].lower()

    db2 = _db()
    row = db2.query(User).filter(User.id == user.id).first()
    assert row.status == "deleted" and row.deleted_at is not None
    assert row.purge_after - row.deleted_at == timedelta(days=30)
    assert row.deleted_at.replace(tzinfo=timezone.utc) >= before.replace(microsecond=0)
    assert db2.query(AccountDeletionLedger).filter_by(user_id=user.id).count() == 1  # 상태 전환 계정당 1회
    # 개인 식별 표시 제거
    assert row.name == "탈퇴한 사용자" and row.phone is None and "me@x.com" not in row.email


# ── TS17 ──────────────────────────────────────────────────────────────

def test_ts17_재인증_실패_취소는_상태변경_0(client):
    db = _db()
    user = make_user(db, "a@x.com")
    for body in ({"password": "Wrong1234!"}, {}, {"reauth_proof": "not-a-proof"}):
        res = _delete(client, user, **body)
        assert res.status_code == 401 and res.json()["detail"]["code"] == "REAUTH_REQUIRED"
    row = _db().query(User).filter(User.id == user.id).first()
    assert row.status == "active" and row.deleted_at is None
    assert _db().query(AccountDeletionLedger).count() == 0


def test_ts17_다른_사용자_proof와_재사용은_거부(client):
    db = _db()
    a, b = make_user(db, "a@x.com"), make_user(db, "b@x.com")
    proof = client.post(REAUTH, json={"password": VALID_PASSWORD}, headers=auth_headers(a)).json()["reauth_proof"]
    stolen = _delete(client, b, reauth_proof=proof)
    assert stolen.status_code == 401
    assert _db().query(User).filter(User.id == b.id).first().status == "active"
    assert _delete(client, a, reauth_proof=proof).status_code == 204
    # 일회용: 같은 proof 를 다시 쓰면 (이미 탈퇴한 계정이라) 인증 자체가 거부된다
    assert _delete(client, a, reauth_proof=proof).status_code == 401


def test_ts17_만료된_proof는_거부(client):
    from app.core.redis import get_redis

    db = _db()
    user = make_user(db, "a@x.com")
    proof = client.post(REAUTH, json={"password": VALID_PASSWORD}, headers=auth_headers(user)).json()["reauth_proof"]
    redis = app.dependency_overrides[get_redis]()
    asyncio.run(redis.flushall())  # TTL 만료와 동일하게 키가 사라진 상태
    res = _delete(client, user, reauth_proof=proof)
    assert res.status_code == 401 and res.json()["detail"]["code"] == "REAUTH_REQUIRED"


def test_ts17_탈퇴_후_토큰_로그인_리프레시_푸시_모두_무효(client):
    db = _db()
    user = make_user(db, "a@x.com")
    headers = auth_headers(user)
    login = client.post("/api/v1/auth/login", json={"email": "a@x.com", "password": VALID_PASSWORD})
    assert login.status_code == 200
    refresh_cookie = login.cookies.get("mb_refresh_token")
    db.add(DeviceToken(user_id=user.id, token="fcm-token-1", platform="ios"))
    db.add(DeviceToken(user_id=user.id, token="https://push.example/sub", platform="web", p256dh="k", auth="a"))
    db.commit()

    assert _delete(client, user, password=VALID_PASSWORD).status_code == 204

    assert client.patch("/api/v1/auth/users/me", json={"name": "x"}, headers=headers).status_code == 401
    assert client.post("/api/v1/auth/login", json={"email": "a@x.com", "password": VALID_PASSWORD}).status_code == 401
    refreshed = client.post("/api/v1/auth/refresh", cookies={"mb_refresh_token": refresh_cookie})
    assert refreshed.status_code == 401
    db2 = _db()
    assert db2.query(DeviceToken).filter_by(user_id=user.id).count() == 0
    assert db2.query(RefreshToken).filter_by(user_id=user.id).count() == 0


# ── TS18 ──────────────────────────────────────────────────────────────

def _admin_pair(db):
    org = make_org(db)
    a = make_user(db, "admin1@x.com", role="org_admin", org_id=org.id)
    return org, a


def test_ts18_단독_기관관리자는_409_변경_0_다른관리자_지정후_204(client):
    db = _db()
    org, admin = _admin_pair(db)
    org.primary_admin_id = admin.id
    db.commit()
    res = _delete(client, admin, password=VALID_PASSWORD)
    assert res.status_code == 409 and res.json()["detail"]["code"] == "SOLE_ORG_ADMIN"
    row = _db().query(User).filter_by(id=admin.id).first()
    assert row.status == "active" and _db().query(AccountDeletionLedger).count() == 0
    assert _db().query(RefreshToken).count() == 0

    second = make_user(db, "admin2@x.com", role="org_admin", org_id=org.id)
    org.primary_admin_id = second.id
    db.commit()
    assert _delete(client, admin, password=VALID_PASSWORD).status_code == 204
    # 다른 관리자 참조는 유지된다
    from app.models.organization import Organization

    assert _db().query(Organization).filter_by(id=org.id).first().primary_admin_id == second.id
    assert _db().query(User).filter_by(id=second.id).first().status == "active"


def _session(db, host, *, status="scheduled", delta_days=3):
    s = SessionModel(type="meditation", host_id=host.id, status=status,
                     scheduled_at=datetime.now(timezone.utc) + timedelta(days=delta_days), is_template=False, duration_min=60)
    db.add(s)
    db.commit()
    return s


def test_ts18_미래_예정_회차_진행자는_409_해결후_204(client):
    db = _db()
    host = make_user(db, "h@x.com", role="counselor")
    s = _session(db, host)
    res = _delete(client, host, password=VALID_PASSWORD)
    assert res.status_code == 409 and res.json()["detail"]["code"] == "SCHEDULED_SESSIONS_EXIST"
    assert _db().query(User).filter_by(id=host.id).first().status == "active"
    assert _db().query(SessionModel).filter_by(id=s.id).first().hidden_at is None
    s.status = "cancelled"
    db.commit()
    assert _delete(client, host, password=VALID_PASSWORD).status_code == 204


def test_ts18_완료_회차만_있으면_탈퇴_허용(client):
    db = _db()
    host = make_user(db, "h2@x.com", role="counselor")
    _session(db, host, status="completed", delta_days=-3)
    assert _delete(client, host, password=VALID_PASSWORD).status_code == 204


# ── TS19 ──────────────────────────────────────────────────────────────

def test_ts19_apple_revoke_성공_1회_재실행_호출_0(client, monkeypatch):
    db = _db()
    user = make_user(db, "ap@x.com", provider="apple")
    key = _apple_setup(monkeypatch, db, user)
    calls = []

    async def fake_revoke(client_id, token, hint="refresh_token"):
        calls.append((client_id, token, hint))

    monkeypatch.setattr(apple_auth_service, "revoke_token", fake_revoke)
    proof = _apple_reauth(client, key, user).json()["reauth_proof"]
    assert _delete(client, user, reauth_proof=proof).status_code == 204
    assert calls == [(APPLE_AUD, "apple-refresh", "refresh_token")]
    row = _db().query(SocialRevokeOutbox).filter_by(user_id=user.id, provider="apple").first()
    assert row.status == "done" and row.encrypted_token is None
    assert asyncio.run(svc.process_revoke_outbox(_db())) == {"done": 0, "failed": 0, "skipped": 0}
    assert len(calls) == 1


def test_ts19_apple_revoke_실패는_pending_유지_로컬차단_유지_재시도_성공(client, monkeypatch):
    db = _db()
    user = make_user(db, "ap2@x.com", provider="apple")
    key = _apple_setup(monkeypatch, db, user)
    state = {"fail": True, "calls": 0}

    async def flaky(client_id, token, hint="refresh_token"):
        state["calls"] += 1
        if state["fail"]:
            raise apple_auth_service.AppleUnavailable("timeout")

    monkeypatch.setattr(apple_auth_service, "revoke_token", flaky)
    proof = _apple_reauth(client, key, user).json()["reauth_proof"]
    assert _delete(client, user, reauth_proof=proof).status_code == 204
    row = _db().query(SocialRevokeOutbox).filter_by(user_id=user.id).first()
    assert row.status == "pending" and row.attempts == 1 and row.last_error
    assert "apple-refresh" not in (row.last_error or "")
    assert _db().query(User).filter_by(id=user.id).first().status == "deleted"  # 되돌리지 않는다

    state["fail"] = False
    later = datetime.now(timezone.utc) + timedelta(hours=1)
    stats = asyncio.run(svc.process_revoke_outbox(_db(), now=later))
    assert stats["done"] == 1 and state["calls"] == 2
    assert _db().query(SocialRevokeOutbox).filter_by(user_id=user.id).first().status == "done"


def test_ts19_google_연결해제_1회_email은_외부호출_0(client, monkeypatch):
    revoked = []

    async def fake_google(token):
        revoked.append(token)

    monkeypatch.setattr(svc, "revoke_google_token", fake_google)
    db = _db()
    g = make_user(db, "g@x.com", provider="google")
    with _google_patch("g@x.com"):
        proof = client.post(REAUTH, json={"provider": "google", "access_token": "g-access"}, headers=auth_headers(g)).json()["reauth_proof"]
    assert _delete(client, g, reauth_proof=proof).status_code == 204
    assert revoked == ["g-access"]

    e = make_user(db, "e@x.com", provider="email")
    assert _delete(client, e, password=VALID_PASSWORD).status_code == 204
    assert revoked == ["g-access"]
    assert _db().query(SocialRevokeOutbox).filter_by(user_id=e.id).count() == 0


def test_ts19_google_id_token_재인증은_해제할_토큰이_없어_skipped로_추적(client):
    db = _db()
    g = make_user(db, "g2@x.com", provider="google")
    with _google_patch("g2@x.com"):
        proof = client.post(REAUTH, json={"provider": "google", "id_token": "idt"}, headers=auth_headers(g)).json()["reauth_proof"]
    assert _delete(client, g, reauth_proof=proof).status_code == 204
    row = _db().query(SocialRevokeOutbox).filter_by(user_id=g.id).first()
    assert row.status == "skipped" and row.last_error == "no_revocable_token"


# ── TS20 ──────────────────────────────────────────────────────────────

REQ = "/api/v1/account-deletion/requests"


def test_ts20_존재_미존재_이메일_모두_202_동일응답_접수원장(client):
    db = _db()
    make_user(db, "exists@x.com")
    r1 = client.post(REQ, json={"email": "exists@x.com"})
    r2 = client.post(REQ, json={"email": "nobody@x.com"})
    assert r1.status_code == r2.status_code == 202
    assert r1.json() == r2.json() == {"accepted": True}
    assert _db().query(AccountDeletionRequest).count() == 2
    assert _db().query(User).filter_by(email="exists@x.com").first().status == "active"  # 접수만으로 삭제되지 않는다


def test_ts20_잘못된_형식_422_한도초과_429(client):
    assert client.post(REQ, json={"email": "not-an-email"}).status_code == 422
    for _ in range(svc.REQUEST_LIMIT_PER_EMAIL):
        assert client.post(REQ, json={"email": "spam@x.com"}).status_code == 202
    assert client.post(REQ, json={"email": "spam@x.com"}).status_code == 429
    assert client.post(REQ, json={"email": "SPAM@x.com"}).status_code == 429  # 정규화 후 같은 키


def test_ts20_메일_장애에도_원장_유지_재시도_성공후_중복발송_0(client):
    client.post(REQ, json={"email": "u@x.com"})
    sent = []

    def failing(subject, body):
        raise RuntimeError("smtp down")

    stats = svc.deliver_pending_request_notices(_db(), sender=failing)
    assert stats == {"sent": 0, "failed": 1}
    row = _db().query(AccountDeletionRequest).first()
    assert row.notify_status == "pending" and row.notify_attempts == 1

    def ok(subject, body):
        sent.append(subject)
        return True

    assert svc.deliver_pending_request_notices(_db(), sender=ok) == {"sent": 1, "failed": 0}
    assert svc.deliver_pending_request_notices(_db(), sender=ok) == {"sent": 0, "failed": 0}
    assert len(sent) == 1


def test_ts20_수신자는_운영_고정_주소_본문에_접수_이메일(client, monkeypatch):
    client.post(REQ, json={"email": "u2@x.com"})
    captured = {}

    def fake_send(to, subject, body, html=None):
        captured.update(to=to, body=body)
        return True

    monkeypatch.setattr("app.tasks.email._send_email", fake_send)
    svc.deliver_pending_request_notices(_db())
    assert captured["to"] == settings.signup_notice_email and "u2@x.com" in captured["body"]


# ── F2 / TS23 ─────────────────────────────────────────────────────────

def test_f2_탈퇴처리중_이메일_가입_차단_원래_이메일_노출_0(client):
    assert client.post("/api/v1/auth/register/client", json=email_register_payload("again@x.com")).status_code == 201
    user = _db().query(User).filter_by(email="again@x.com").first()
    assert _delete(client, user, password=VALID_PASSWORD).status_code == 204
    res = client.post("/api/v1/auth/register/client", json=email_register_payload("AGAIN@x.com"))
    assert res.status_code == 409 and res.json()["detail"]["code"] == "ACCOUNT_DELETION_PENDING"
    assert _db().query(User).filter(User.email.like("%again@x.com%")).count() == 0  # 행에 원본 이메일 없음


def test_ts23_탈퇴_직후_명단_이름은_탈퇴한_사용자(client):
    db = _db()
    user = make_user(db, "who@x.com")
    assert _delete(client, user, password=VALID_PASSWORD).status_code == 204
    row = _db().query(User).filter_by(id=user.id).first()
    assert (row.name, row.profile_image, row.phone, row.bio) == ("탈퇴한 사용자", None, None, None)
