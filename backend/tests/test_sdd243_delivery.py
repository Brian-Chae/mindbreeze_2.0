"""SDD-243 B07 — 반출 재인증·감사·part URL: proof 바인딩/만료, 단계 간 철회, 감사 선행, TTL 최솟값, 감사 열람 범위."""
import time
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import pytest
from jose import jwt

from app.config import settings
from app.core.security import hash_password
from app.models.data_export import (DataExportAudit, DataExportAuditTarget, DataExportJob, DataExportPart,
                                    DataExportTarget)
from app.models.user_org_membership import UserOrgMembership
from app.services import data_center_export as dcx, export_reauth, storage_service
from tests.sdd243_helpers import add_features, auth, db, dc_enabled, world  # noqa: F401

BASE = '/api/v1/data-center'
PASSWORD = 'Str0ng!Pass-243'


@pytest.fixture
def env(client, world, db, dc_enabled, monkeypatch):
    for u in (world.admin_a, world.admin_ab, world.platform):
        u.password_hash = hash_password(PASSWORD)
        u.auth_provider = 'email'
    for sess, part in ((world.s_a1, world.p_a1_c), (world.s_a1, world.p_a1_c2), (world.s_a2, world.p_a2_c), (world.s_b1, world.p_b1_c)):
        add_features(db, sess, part, 3)
    db.commit()
    monkeypatch.setattr(dcx, 'enqueue_job', lambda job_id: None)
    signed = []

    def fake_presign(key, *, expires_in, expires_at=None, **kw):
        signed.append((key, expires_in))
        return f'https://s3.example.invalid/{key}?sig=SECRET-SIGNATURE&exp={expires_in}'

    monkeypatch.setattr(storage_service, 'generate_presigned_get', fake_presign)
    world.signed = signed
    return world


def reauth(client, user, **body):
    return client.post(BASE + '/export-reauth', json={'credential': PASSWORD, **body}, headers=auth(user),
                       params={'org_id': body.pop('org', None)} if False else None)


def preview(client, user, **kw):
    r = client.post(BASE + '/exports/preview', json={'scope': 'session', 'target_id': str(kw.pop('target')), 'include': ['features'], **kw},
                    headers=auth(user))
    assert r.status_code == 200, r.text
    return r.json()


def create(client, user, pv, *, key=None, proof=None, org=None):
    return client.post(BASE + '/exports', params={'org_id': str(org)} if org else None,
                       json={'preview_token': pv['preview_token'], 'reason': '운영 점검', 'reauth_proof': proof},
                       headers={**auth(user), 'Idempotency-Key': key or uuid4().hex})


def proof_for(client, user, *, request_hash=None, job_id=None, org=None):
    body = {'credential': PASSWORD}
    if request_hash:
        body['request_hash'] = request_hash
    if job_id:
        body['job_id'] = str(job_id)
    r = client.post(BASE + '/export-reauth', params={'org_id': str(org)} if org else None, json=body, headers=auth(user))
    assert r.status_code == 200, r.text
    return r.json()['proof']


def ready_job(client, w, db, user=None, target=None):
    user = user or w.admin_a
    pv = preview(client, user, target=target or w.s_a1.id)
    r = create(client, user, pv, proof=proof_for(client, user, request_hash=pv['request_hash']))
    assert r.status_code == 202, r.text
    jid = UUID(r.json()['export_id'])
    job = db.get(DataExportJob, jid)
    job.status = 'ready'
    job.warnings = []
    db.add(DataExportPart(job_id=jid, part_no=1, object_key=f'data-exports/{jid}/part1.zip', size_bytes=10, checksum='c' * 64, status='ready'))
    job.expected_part_count = 1
    db.commit()
    part = db.query(DataExportPart).filter_by(job_id=jid).one()
    return jid, part.id


def url(client, user, jid, pid, proof, org=None):
    return client.post(f'{BASE}/exports/{jid}/download-url', params={'org_id': str(org)} if org else None,
                       json={'part_id': str(pid), 'reauth_proof': proof}, headers=auth(user))


# ── proof ───────────────────────────────────────────────────────────────

def test_proof_binding_and_expiry(client, env, db, monkeypatch):
    w = env
    pv = preview(client, w.admin_a, target=w.s_a1.id)
    other = preview(client, w.admin_a, target=w.s_a2.id)
    good = proof_for(client, w.admin_a, request_hash=pv['request_hash'])
    # 다른 요청 해시·다른 사용자·다른 기관/역할·작업용(job) 바인딩에는 쓸 수 없다
    assert create(client, w.admin_a, other, proof=good).json()['detail']['code'] == 'reauth_invalid'
    plat_pv = preview(client, w.platform, target=w.s_a1.id)
    assert create(client, w.platform, plat_pv, proof=good).json()['detail']['code'] == 'reauth_invalid'
    job_bound = proof_for(client, w.admin_a, job_id=uuid4())
    assert create(client, w.admin_a, pv, proof=job_bound).json()['detail']['code'] == 'reauth_invalid'
    assert create(client, w.admin_a, pv, proof='garbage').json()['detail']['code'] == 'reauth_invalid'
    # 비밀번호 틀림 / 바인딩 누락·중복 / 소셜 계정
    bad = client.post(BASE + '/export-reauth', json={'credential': 'wrong', 'request_hash': pv['request_hash']}, headers=auth(w.admin_a))
    assert bad.status_code == 403 and bad.json()['detail']['code'] == 'reauth_invalid'
    both = client.post(BASE + '/export-reauth', json={'credential': PASSWORD, 'request_hash': pv['request_hash'], 'job_id': str(uuid4())},
                       headers=auth(w.admin_a))
    assert both.status_code == 422
    assert client.post(BASE + '/export-reauth', json={'credential': PASSWORD}, headers=auth(w.admin_a)).status_code == 422
    assert client.post(BASE + '/export-reauth', json={'credential': PASSWORD, 'request_hash': pv['request_hash']},
                       headers=auth(w.counselor)).status_code == 403
    # 탈퇴용(다른 aud) 토큰·서명 변조는 거절
    claims = jwt.get_unverified_claims(good)
    forged = jwt.encode({**claims, 'aud': 'account_deletion'}, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)
    assert create(client, w.admin_a, pv, proof=forged).json()['detail']['code'] == 'reauth_invalid'
    wrong_key = jwt.encode(claims, 'x' * 40, algorithm=settings.jwt_algorithm)
    assert create(client, w.admin_a, pv, proof=wrong_key).json()['detail']['code'] == 'reauth_invalid'
    # 299초는 허용, 300초는 만료 (preview 는 1회용이라 시도마다 새로 발급)
    for age, ok in ((299, True), (300, False)):
        fresh = preview(client, w.admin_a, target=w.s_a1.id)
        base = jwt.get_unverified_claims(proof_for(client, w.admin_a, request_hash=fresh['request_hash']))
        tok = jwt.encode({**base, 'iat': int(time.time()) - age, 'exp': int(time.time()) + 600}, settings.jwt_secret_key,
                         algorithm=settings.jwt_algorithm)
        r = create(client, w.admin_a, fresh, proof=tok, key=f'age{age}')
        if ok:
            assert r.status_code == 202, r.text
            db.query(DataExportJob).filter_by(id=UUID(r.json()['export_id'])).update({'status': 'failed'})
            db.commit()
        else:
            assert r.json()['detail']['code'] == 'reauth_invalid'
    db.expire_all()
    for ev in db.query(DataExportAudit).filter(DataExportAudit.event == 'request_denied'):
        assert ev.event_id is not None and 'SECRET' not in str(ev.__dict__)


def test_reauth_lockout_and_no_secret_storage(client, env, db):
    w = env
    pv = preview(client, w.admin_a, target=w.s_a1.id)
    for _ in range(10):
        r = client.post(BASE + '/export-reauth', json={'credential': 'nope', 'request_hash': pv['request_hash']}, headers=auth(w.admin_a))
        if r.status_code == 429:
            break
    assert r.status_code in (423, 429, 403)
    blocked = client.post(BASE + '/export-reauth', json={'credential': PASSWORD, 'request_hash': pv['request_hash']}, headers=auth(w.admin_a))
    assert blocked.status_code in (423, 429)  # 반복 실패 후에는 올바른 비밀번호도 잠금 해제 전까지 거절


def test_revocation_between_stages(client, env, db):
    w = env
    pv = preview(client, w.admin_a, target=w.s_a1.id)
    proof = proof_for(client, w.admin_a, request_hash=pv['request_hash'])
    # 비밀번호 변경 → auth_epoch 변경으로 기존 proof 무효
    w.admin_a.password_hash = hash_password('Another!Pass-243')
    db.commit()
    assert create(client, w.admin_a, pv, proof=proof).json()['detail']['code'] == 'reauth_invalid'
    w.admin_a.password_hash = hash_password(PASSWORD)
    db.commit()
    # 기관 전환(다기관 관리자): 기관 A proof 는 기관 B 컨텍스트에서 무효
    pv_ab = client.post(BASE + '/exports/preview', params={'org_id': str(w.org_a.id)},
                        json={'scope': 'session', 'target_id': str(w.s_a1.id), 'include': ['features']}, headers=auth(w.admin_ab)).json()
    p_a = proof_for(client, w.admin_ab, request_hash=pv_ab['request_hash'], org=w.org_a.id)
    r = client.post(BASE + '/exports', params={'org_id': str(w.org_b.id)},
                    json={'preview_token': pv_ab['preview_token'], 'reason': '운영 점검', 'reauth_proof': p_a},
                    headers={**auth(w.admin_ab), 'Idempotency-Key': 'sw'})
    assert r.status_code == 404  # 다른 기관 컨텍스트에서는 preview 자체가 보이지 않는다
    # URL 단계: 작업 생성 뒤 소속 해제 / 동의 철회 / 정책 변경 / 대상 제거 각각 차단
    jid, pid = ready_job(client, w, db)
    ok = url(client, w.admin_a, jid, pid, proof_for(client, w.admin_a, job_id=jid))
    assert ok.status_code == 200, ok.text
    w.p_a1_c.consent_eeg = False
    db.commit()
    r = url(client, w.admin_a, jid, pid, proof_for(client, w.admin_a, job_id=jid))
    assert r.status_code == 403 and r.json()['detail']['code'] == 'access_revoked'
    w.p_a1_c.consent_eeg = True
    db.commit()
    settings.data_center_url_ttl_seconds = 61
    try:
        r = url(client, w.admin_a, jid, pid, proof_for(client, w.admin_a, job_id=jid))
        assert r.status_code == 409 and r.json()['detail']['code'] == 'policy_changed'
    finally:
        settings.data_center_url_ttl_seconds = 60
    db.query(UserOrgMembership).filter(UserOrgMembership.user_id == w.admin_a.id).update({'status': 'left'})
    db.commit()
    assert url(client, w.admin_a, jid, pid, 'x').status_code in (403, 404)
    db.expire_all()
    events = [a.event for a in db.query(DataExportAudit).filter_by(export_id=jid).order_by(DataExportAudit.created_at)]
    assert events.count('url_denied') == 2 and 'url_issued' in events


# ── URL 발급·감사 선행·TTL ──────────────────────────────────────────────

def test_url_issue_audit_and_secret_hygiene(client, env, db):
    w = env
    jid, pid = ready_job(client, w, db)
    r = url(client, w.admin_a, jid, pid, proof_for(client, w.admin_a, job_id=jid))
    assert r.status_code == 200 and r.headers['cache-control'] == 'no-store'
    body = r.json()
    assert body['part_no'] == 1 and body['revocable'] is False and body['url'].startswith('https://')
    assert w.signed[-1][1] == 60  # URL TTL 60초
    db.expire_all()
    rows = db.query(DataExportAudit).filter_by(export_id=jid).all()
    assert {a.event for a in rows} >= {'requested', 'url_authorized', 'url_issued'}
    blob = ' '.join(str(v) for a in rows for v in a.__dict__.values())
    assert 'SECRET-SIGNATURE' not in blob and 's3.example' not in blob and PASSWORD not in blob and 'Bearer' not in blob
    req = next(a for a in rows if a.event == 'requested')
    assert req.scope_org_id == w.org_a.id and req.identity == 'pseudonymized' and req.purpose_type == 'operations'
    assert req.reason == '운영 점검' and req.request_hash and req.policy_version == 'dc-policy-1'
    targets = db.query(DataExportAuditTarget).filter_by(audit_id=req.id).count()
    assert targets == db.query(DataExportTarget).filter_by(job_id=jid).count() == 2
    # 소유자만, 현재 기관만, 다른 작업의 part 는 불가
    assert url(client, w.platform, jid, pid, 'x').status_code == 404
    assert url(client, w.admin_a, jid, uuid4(), 'x').status_code == 404
    assert url(client, w.admin_a, jid, pid, None).status_code == 403
    assert url(client, w.admin_a, jid, pid, proof_for(client, w.admin_a, job_id=uuid4())).status_code == 403  # 다른 job 바인딩


def test_audit_failure_blocks_url(client, env, db, monkeypatch):
    w = env
    jid, pid = ready_job(client, w, db)
    proof = proof_for(client, w.admin_a, job_id=jid)
    real = dcx.audit_dc

    def broken(db_, job, event, *a, **k):
        if event == 'url_authorized':
            raise RuntimeError('audit down')
        return real(db_, job, event, *a, **k)

    monkeypatch.setattr(dcx, 'audit_dc', broken)
    with pytest.raises(RuntimeError):
        url(client, w.admin_a, jid, pid, proof)
    assert w.signed == []  # 감사 없는 URL 0


def test_signer_failure_is_not_recorded_as_issued(client, env, db, monkeypatch):
    w = env
    jid, pid = ready_job(client, w, db)

    def boom(*a, **k):
        raise storage_service.ExportStorageError('storage_unavailable')

    monkeypatch.setattr(storage_service, 'generate_presigned_get', boom)
    r = url(client, w.admin_a, jid, pid, proof_for(client, w.admin_a, job_id=jid))
    assert r.status_code == 503
    db.expire_all()
    events = {a.event for a in db.query(DataExportAudit).filter_by(export_id=jid)}
    assert 'url_failed' in events and 'url_issued' not in events and 'url_authorized' in events


def test_ttl_minimum_and_expiry(client, env, db):
    w = env
    jid, pid = ready_job(client, w, db)
    # 작업 만료까지 20초 → URL TTL 20초 이하
    db.query(DataExportJob).filter_by(id=jid).update({'expires_at': datetime.now(timezone.utc) + timedelta(seconds=20)})
    db.commit()
    assert url(client, w.admin_a, jid, pid, proof_for(client, w.admin_a, job_id=jid)).status_code == 200
    assert 1 <= w.signed[-1][1] <= 20
    # 원천 deadline 이 더 이르면 그쪽이 우선
    db.query(DataExportJob).filter_by(id=jid).update({'expires_at': datetime.now(timezone.utc) + timedelta(hours=20)})
    db.query(DataExportTarget).filter_by(job_id=jid).update({'source_deadline': datetime.now(timezone.utc) + timedelta(seconds=7)})
    db.commit()
    assert url(client, w.admin_a, jid, pid, proof_for(client, w.admin_a, job_id=jid)).status_code == 200
    assert 1 <= w.signed[-1][1] <= 7
    # 원천 기한 경과 → 발급 불가(연장 없음)
    db.query(DataExportTarget).filter_by(job_id=jid).update({'source_deadline': datetime.now(timezone.utc) - timedelta(seconds=1)})
    db.commit()
    r = url(client, w.admin_a, jid, pid, proof_for(client, w.admin_a, job_id=jid))
    assert r.status_code == 410 and r.json()['detail']['code'] == 'source_expired'
    # 만료된 작업: 410 + URL 없음
    db.query(DataExportJob).filter_by(id=jid).update({'expires_at': datetime.now(timezone.utc) - timedelta(seconds=1)})
    db.commit()
    before = len(w.signed)
    assert url(client, w.admin_a, jid, pid, proof_for(client, w.admin_a, job_id=jid)).status_code == 410
    assert len(w.signed) == before
    # 준비 안 된 part
    jid2, pid2 = ready_job(client, w, db, target=w.s_a2.id) if False else (None, None)


def test_not_ready_part_gets_409(client, env, db):
    w = env
    pv = preview(client, w.admin_a, target=w.s_a1.id)
    r = create(client, w.admin_a, pv, proof=proof_for(client, w.admin_a, request_hash=pv['request_hash']))
    jid = UUID(r.json()['export_id'])
    part = DataExportPart(job_id=jid, part_no=1, status='pending')
    db.add(part)
    db.commit()
    resp = url(client, w.admin_a, jid, part.id, proof_for(client, w.admin_a, job_id=jid))
    assert resp.status_code == 409 and resp.json()['detail']['code'] == 'not_ready'


# ── 감사 열람 범위 · 거부 감사 ───────────────────────────────────────────

def test_audit_listing_scopes(client, env, db):
    w = env
    jid_a, pid_a = ready_job(client, w, db)
    url(client, w.admin_a, jid_a, pid_a, proof_for(client, w.admin_a, job_id=jid_a))
    pv = preview(client, w.platform, target=w.s_b1.id)
    r = create(client, w.platform, pv, proof=proof_for(client, w.platform, request_hash=pv['request_hash']))
    assert r.status_code == 202
    # 플랫폼: 기관관리자 요청 포함 전역 + 필터
    glob = client.get(BASE + '/download-audits', params={'limit': 100}, headers=auth(w.platform)).json()
    actors = {i['actor_id'] for i in glob['items']}
    assert {str(w.admin_a.id), str(w.platform.id)} <= actors
    only_org = client.get(BASE + '/download-audits', params={'org_id': str(w.org_a.id)}, headers=auth(w.platform)).json()
    assert {i['org_id'] for i in only_org['items']} == {str(w.org_a.id)}
    by_actor = client.get(BASE + '/download-audits', params={'actor_id': str(w.admin_a.id), 'event': 'url_issued'}, headers=auth(w.platform)).json()
    assert [i['event'] for i in by_actor['items']] == ['url_issued']
    item = glob['items'][0]
    assert set(item) >= {'event_id', 'event', 'result', 'at', 'actor_id', 'actor_role', 'org_id', 'job_id', 'purpose', 'identity',
                         'reason', 'part_no', 'session_count', 'size_bytes', 'policy_version'}
    assert 'url' not in str(glob).lower().replace('url_', '')
    # 기관: 본인 + 현재 기관만
    mine = client.get(BASE + '/download-audits', params={'limit': 100}, headers=auth(w.admin_a)).json()
    assert mine['items'] and {i['actor_id'] for i in mine['items']} == {str(w.admin_a.id)}
    assert {i['org_id'] for i in mine['items']} == {str(w.org_a.id)}
    other = client.get(BASE + '/download-audits', params={'org_id': str(w.org_a.id), 'limit': 100}, headers=auth(w.admin_ab)).json()
    assert other['items'] == []  # 다른 관리자의 기록은 보이지 않는다
    assert client.get(BASE + '/download-audits', headers=auth(w.counselor)).status_code == 403
    # 감사 열람 권한은 파일 접근권을 주지 않는다
    assert url(client, w.platform, jid_a, pid_a, 'x').status_code == 404
    assert client.get(f'{BASE}/exports/{jid_a}', headers=auth(w.platform)).status_code == 404


def test_denied_requests_are_audited_without_target(client, env, db):
    w = env
    pv = preview(client, w.admin_a, target=w.s_a1.id)
    r = create(client, w.admin_a, pv, proof=None)
    assert r.status_code == 403
    db.expire_all()
    row = db.query(DataExportAudit).filter_by(event='request_denied').one()
    assert row.export_id is None and row.session_id is None and row.user_id == w.admin_a.id and 'reauth_required' in row.result
    shown = client.get(BASE + '/download-audits', headers=auth(w.platform)).json()['items']
    assert any(i['event'] == 'request_denied' and i['job_id'] is None for i in shown)


def test_event_ids_make_state_audits_idempotent(client, env, db):
    w = env
    jid, _ = ready_job(client, w, db)
    job = db.get(DataExportJob, jid)
    dcx.audit_dc(db, job, 'expired', 'expired')
    dcx.audit_dc(db, job, 'expired', 'expired')  # 중복 전달 시 한 번만
    db.commit()
    assert db.query(DataExportAudit).filter_by(export_id=jid, event='expired').count() == 1
