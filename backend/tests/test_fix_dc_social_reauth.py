"""데이터 센터 반출 재인증 — 구글·애플 소셜 계정 지원(SDD-220 proof 재사용)."""
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from cryptography.fernet import Fernet

from app.config import settings
from app.core.database import get_db
from app.core.redis import get_redis
from app.main import app
from app.models.account_deletion import SocialIdentity
from app.services import apple_auth_service
from tests.sdd220_helpers import APPLE_AUD, AppleKey, ensure_account_routes
from tests.sdd243_helpers import auth, db, dc_enabled, world  # noqa: F401
from tests.test_sdd243_delivery import BASE, PASSWORD, create, env, preview  # noqa: F401

REAUTH = '/api/v1/users/me/reauth'


@pytest.fixture(autouse=True)
def _routes(monkeypatch):
    ensure_account_routes()
    monkeypatch.setattr(settings, 'apple_client_ids', APPLE_AUD)
    monkeypatch.setattr(settings, 'social_token_encryption_key', Fernet.generate_key().decode())
    apple_auth_service.reset_cache()


def _google_patch(email):
    def _side(url, **kwargs):
        resp = MagicMock(status_code=200)
        resp.json.return_value = {'email': email} if 'userinfo' in str(url) else {'aud': 'test-client-id', 'email': email}
        return resp

    return patch('httpx.AsyncClient.get', AsyncMock(side_effect=_side))


def _social_user(db, user, provider):
    user.auth_provider = provider
    db.commit()


def _google_proof(client, user, purpose='data_export'):
    with _google_patch(user.email):
        r = client.post(REAUTH, json={'provider': 'google', 'access_token': 'gtoken', 'purpose': purpose}, headers=auth(user))
    assert r.status_code == 200, r.text
    return r.json()['reauth_proof']


def _apple_proof(client, monkeypatch, db, user, purpose='data_export', sub='apple-sub-1'):
    key = AppleKey()

    async def fake_fetch():
        return {'keys': [key.public_jwk]}

    monkeypatch.setattr(apple_auth_service, 'fetch_jwks', fake_fetch)
    db.add(SocialIdentity(user_id=user.id, provider='apple', subject=sub, email=user.email, client_id=APPLE_AUD,
                          encrypted_refresh_token=None))
    db.commit()
    nonce = client.post('/api/v1/auth/apple/challenge').json()['nonce']
    r = client.post(REAUTH, json={'provider': 'apple', 'id_token': key.token(sub=sub, nonce=nonce), 'nonce': nonce,
                                  'purpose': purpose}, headers=auth(user))
    assert r.status_code == 200, r.text
    return r.json()['reauth_proof']


def _export_reauth(client, user, pv=None, **body):
    body = {'request_hash': pv['request_hash']} | body if pv else body
    return client.post(BASE + '/export-reauth', json=body, headers=auth(user))


def _pv(client, w):
    return preview(client, w.admin_a, target=w.s_a1.id)


def test_이메일_비밀번호_경로_유지(client, env):
    pv = _pv(client, env)
    r = _export_reauth(client, env.admin_a, pv, credential=PASSWORD)
    assert r.status_code == 200 and r.json()['proof']


@pytest.mark.parametrize('provider', ['google', 'apple'])
def test_소셜_proof로_ExportProof_발급_후_생성까지(client, env, db, monkeypatch, provider):
    user = env.admin_a
    _social_user(db, user, provider)
    pv = _pv(client, env)
    sp = _google_proof(client, user) if provider == 'google' else _apple_proof(client, monkeypatch, db, user)
    r = _export_reauth(client, user, pv, social_proof=sp)
    assert r.status_code == 200, r.text
    assert create(client, user, pv, proof=r.json()['proof']).status_code in (200, 201, 202)
    # 바인딩: 다른 preview 에는 쓸 수 없다
    other = preview(client, user, target=env.s_a2.id)
    assert create(client, user, other, proof=r.json()['proof']).json()['detail']['code'] == 'reauth_invalid'


def test_소셜_proof는_job_id에도_바인딩(client, env, db):
    user = env.admin_a
    _social_user(db, user, 'google')
    job = uuid4()
    r = _export_reauth(client, user, None, social_proof=_google_proof(client, user), job_id=str(job))
    assert r.status_code == 200, r.text


def test_탈퇴용_purpose_proof는_거절되고_소비되지_않는다(client, env, db):
    user = env.admin_a
    _social_user(db, user, 'google')
    pv = _pv(client, env)
    sp = _google_proof(client, user, purpose='account_deletion')
    r = _export_reauth(client, user, pv, social_proof=sp)
    assert r.status_code in (401, 403)
    # 탈퇴용 proof 가 반출 시도로 소비되지 않았는지(여전히 탈퇴 purpose 로 1회 유효)
    from app.services import social_reauth_service as svc
    redis = app.dependency_overrides[get_redis]()
    rec = asyncio.run(svc.consume_proof(redis, sp, str(user.id), svc.PURPOSE_ACCOUNT_DELETION))
    assert rec['purpose'] == 'account_deletion'


def test_타인_proof_거절(client, env, db):
    a, b = env.admin_a, env.admin_ab
    _social_user(db, a, 'google')
    _social_user(db, b, 'google')
    pv = _pv(client, env)
    sp = _google_proof(client, b)
    assert _export_reauth(client, a, pv, social_proof=sp).status_code in (401, 403)


def test_재사용_거절(client, env, db):
    user = env.admin_a
    _social_user(db, user, 'google')
    pv = _pv(client, env)
    sp = _google_proof(client, user)
    assert _export_reauth(client, user, pv, social_proof=sp).status_code == 200
    assert _export_reauth(client, user, pv, social_proof=sp).status_code in (401, 403)


def test_만료_거절(client, env, db):
    user = env.admin_a
    _social_user(db, user, 'google')
    pv = _pv(client, env)
    sp = _google_proof(client, user)
    asyncio.run(app.dependency_overrides[get_redis]().flushall())
    assert _export_reauth(client, user, pv, social_proof=sp).status_code in (401, 403)


def test_임의_문자열은_proof로_인정되지_않는다(client, env, db):
    user = env.admin_a
    _social_user(db, user, 'google')
    pv = _pv(client, env)
    assert _export_reauth(client, user, pv, social_proof='forged-value').status_code in (401, 403)
    assert _export_reauth(client, user, pv, credential='some-google-token').json()['detail']['code'] == 'reauth_method_unsupported'


def test_이메일_계정은_social_proof_불가_소셜_계정은_비밀번호_불가(client, env, db):
    pv = _pv(client, env)
    assert _export_reauth(client, env.admin_a, pv, social_proof='x').status_code in (401, 403)
    _social_user(db, env.admin_a, 'google')
    sp = _google_proof(client, env.admin_a)
    assert _export_reauth(client, env.admin_a, pv, credential=PASSWORD).status_code == 403
    # 비밀번호 시도가 proof 를 소비하지 않는다
    assert _export_reauth(client, env.admin_a, pv, social_proof=sp).status_code == 200


def test_credential_social_proof_둘다_또는_없음은_422(client, env):
    pv = _pv(client, env)
    assert _export_reauth(client, env.admin_a, pv, credential=PASSWORD, social_proof='x').status_code == 422
    assert _export_reauth(client, env.admin_a, pv).status_code == 422


def test_users_me_reauth_purpose_기본값은_탈퇴_허용값만(client, env, db):
    user = env.admin_a
    _social_user(db, user, 'google')
    with _google_patch(user.email):
        bad = client.post(REAUTH, json={'provider': 'google', 'access_token': 't', 'purpose': 'other'}, headers=auth(user))
        ok = client.post(REAUTH, json={'provider': 'google', 'access_token': 't'}, headers=auth(user))
    assert bad.status_code == 422 and ok.status_code == 200
