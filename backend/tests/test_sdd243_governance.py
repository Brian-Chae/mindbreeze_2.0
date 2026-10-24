"""SDD-243 B03 — 동의·보관·표준 조회: GET 무변경, 기관 403, 역연결 0, 접수/원장 구분."""
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import event

from app.models.account_deletion import AccountDeletionLedger, AccountDeletionObject, AccountDeletionRequest
from app.models.normalization_baseline import NormalizationBaseline
from app.models.research import ResearchConsent
from app.models.research_export import ResearchExportBatch
from app.models.retention_sweep_run import RetentionSweepRun
from tests.sdd243_helpers import auth, db, dc_enabled, mk_session, world  # noqa: F401

BASE = '/api/v1/data-center'
NOW = datetime.now(timezone.utc)


def get(client, user, path, **params):
    return client.get(BASE + path, params={k: str(v) for k, v in params.items()}, headers=auth(user))


@pytest.fixture
def gov(db, world):
    w = world
    w.rc_agreed = ResearchConsent(session_id=w.s_a1.id, participant_id=w.p_a1_c.id, consented=True, notice_version='r5-2',
                                  consented_at=NOW, research_subject_id='f' * 64, key_version=1, export_state='pending')
    w.rc_withdrawn = ResearchConsent(session_id=w.s_a1.id, participant_id=w.p_a1_c2.id, consented=True, notice_version='r5-1',
                                     consented_at=NOW, withdrawn_at=NOW, research_subject_id='e' * 64, key_version=1,
                                     export_state='withdrawn')
    db.add_all([w.rc_agreed, w.rc_withdrawn])
    w.batch = ResearchExportBatch(session_id=w.s_a1.id, status='failed', prefix='research-export/secret-prefix/',
                                  manifest_sha256='a' * 64, total_bytes=10, file_count=2, attempt=3,
                                  last_error='ClientError: AccessDenied for s3://bucket/research-export/secret-prefix/x')
    db.add(w.batch)
    w.run = RetentionSweepRun(mode='dry_run', trigger='manual', enabled=False, status='completed', finished_at=NOW, report={
        'mode': 'dry_run', 'blocked_reason': 'sweep_disabled',
        'cutoffs': {'raw_days': 90, 'guest_pii_days': 90, 'apply_from': None, 'evaluated_at': NOW.isoformat()},
        'raw': {'sessions': 2, 'eeg_raw_chunks': 5, 'bytes_known': 123, 'deleted': {'eeg_raw_chunks': 0}},
        'research_hold': {'participants': 1, 'blocked': 0, 'queued_for_export': 1, 'overdue': 0},
        'guest_pii': {'participants': 1}, 'orphan_cleanup': None,
        'internal_paths': ['/var/lib/secret'], 'object_keys': ['s3://private/x']})
    db.add(w.run)
    db.add(AccountDeletionRequest(email='someone@example.invalid', status='received'))
    ledger = AccountDeletionLedger(user_id=uuid.uuid4(), email_hash='h' * 64, role='client', deleted_at=NOW,
                                   purge_after=NOW + timedelta(days=30), status='requested',
                                   retained_reasons={'shared_session_media_retained': 2, 'note': '자유문 PII'})
    db.add(ledger)
    db.flush()
    db.add(AccountDeletionObject(ledger_id=ledger.id, object_key='private/key', kind='s3', status='pending'))
    db.add(AccountDeletionObject(ledger_id=ledger.id, object_key='private/key2', kind='s3', status='deleted'))
    db.add(NormalizationBaseline(user_id='real-user-id', device_id='DEV-1234', gender='female', birth_date='1990-01-01',
                                 pipeline_version='p1', closed={'a': 1.0}, open={'a': 2.0}, is_active=True))
    # 보관 기한 후보: 오래된 회차
    w.s_a1.ended_at = NOW - timedelta(days=95)
    w.s_a2.ended_at = NOW - timedelta(days=85)
    db.commit()
    return w


def test_governance_get_has_no_mutation(client, gov, db, dc_enabled, monkeypatch):
    from app.services import retention_sweep_service
    monkeypatch.setattr(retention_sweep_service, 'run_retention_sweep',
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError('GET 에서 스위프 실행 금지')))
    writes = []
    engine = db.get_bind()

    def spy(conn, cursor, statement, *a):
        if statement.lstrip().upper().startswith(('INSERT', 'UPDATE', 'DELETE')):
            writes.append(statement[:60])

    event.listen(engine, 'before_cursor_execute', spy)
    try:
        for path in ('/research-batches', f'/research-batches/{gov.batch.id}', '/retention-runs',
                     f'/retention-runs/{gov.run.id}', '/retention-candidates', '/account-deletions',
                     '/account-deletions?kind=request', '/baselines', '/consents', '/consents?kind=research'):
            r = client.get(BASE + path, headers=auth(gov.platform))
            assert r.status_code == 200, (path, r.text)
    finally:
        event.remove(engine, 'before_cursor_execute', spy)
    assert writes == []
    assert db.query(RetentionSweepRun).count() == 1


def test_org_governance_denied(client, gov, dc_enabled):
    for path in ('/research-batches', f'/research-batches/{gov.batch.id}', '/retention-runs', f'/retention-runs/{gov.run.id}',
                 '/retention-candidates', '/account-deletions', '/baselines', '/consents?kind=research'):
        r = client.get(BASE + path, headers=auth(gov.admin_a))
        assert r.status_code == 403, path
        assert r.json()['detail']['code'] in ('platform_only', 'research_forbidden')
    for user in (gov.counselor, gov.client):
        assert client.get(BASE + '/baselines', headers=auth(user)).status_code == 403
    # 수집 동의는 기관 범위 안에서만
    r = get(client, gov.admin_a, '/consents', limit=100).json()
    assert {i['session_id'] for i in r['items']} <= {str(gov.s_a1.id), str(gov.s_a2.id), str(gov.s_a_open.id)}
    assert all(i['scope'] == 'collection' for i in r['items']) and r['items']
    plat = get(client, gov.platform, '/consents', limit=100).json()
    assert {i['session_id'] for i in plat['items']} > {i['session_id'] for i in r['items']}


def test_research_no_reverse_link(client, gov, dc_enabled):
    r = get(client, gov.platform, '/consents', kind='research', limit=100)
    items = r.json()['items']
    assert {i['state'] for i in items} == {'agreed', 'withdrawn'}
    text = r.text
    for secret in ('f' * 64, 'e' * 64, str(gov.p_a1_c.id), str(gov.client.id), gov.client.email):
        assert secret not in text
    assert all(i['participant_id'] is None and i['subject_ref'].startswith('R-') for i in items)
    # 배치: manifest·prefix·S3 키·원문 오류 제외
    batches = get(client, gov.platform, '/research-batches').json()
    detail = get(client, gov.platform, f'/research-batches/{gov.batch.id}').json()
    blob = str(batches) + str(detail)
    for secret in ('secret-prefix', 'a' * 64, 's3://', 'AccessDenied', 'bucket'):
        assert secret not in blob
    assert detail['error_summary'] == 'storage_denied' and detail['attempt'] == 3
    assert {e['kind'] for e in detail['history']} >= {'created'}


def test_retention_projection_and_candidates(client, gov, dc_enabled):
    runs = get(client, gov.platform, '/retention-runs').json()
    assert runs['items'][0]['mode'] == 'dry_run'
    detail = get(client, gov.platform, f'/retention-runs/{gov.run.id}').json()
    assert detail['summary']['raw_sessions']['value'] == 2 and detail['summary']['hold_participants']['value'] == 1
    assert detail['cutoff_at'] and 'internal_paths' not in str(detail) and 'object_keys' not in str(detail)
    cands = get(client, gov.platform, '/retention-candidates', limit=100).json()['items']
    refs = {c['ref'] for c in cands}
    assert len(cands) >= 2 and all(c['ref'].startswith('S-') for c in cands)
    by_reason = {c['reason'] for c in cands}
    assert 'due' in by_reason and 'near_due' in by_reason or 'research_hold' in by_reason
    assert str(gov.s_a1.id) not in str(cands) and refs
    # s_a1 은 기한 경과 + 연구 동의(pending) 보류, s_a2 는 임박
    assert any(c['reason'] == 'research_hold' for c in cands)
    assert any(c['reason'] == 'near_due' for c in cands)


def test_deletion_request_vs_ledger_and_baseline(client, gov, dc_enabled):
    ledger = get(client, gov.platform, '/account-deletions').json()['items']
    assert [i['source'] for i in ledger] == ['ledger'] and ledger[0]['grace_until']
    assert ledger[0]['object_counts'] == {'pending': 1, 'deleted': 1}
    assert ledger[0]['retained_reasons'] == {'shared_session_media_retained': 2}  # 자유문 값 제외
    req = get(client, gov.platform, '/account-deletions', kind='request')
    assert [i['source'] for i in req.json()['items']] == ['request']
    assert 'someone@example.invalid' not in req.text and 'h' * 64 not in str(ledger)
    base = get(client, gov.platform, '/baselines')
    item = base.json()['items'][0]
    assert set(item) == {'baseline_id', 'pipeline_version', 'is_active', 'created_at'}
    for secret in ('real-user-id', 'DEV-1234', 'female', '1990'):
        assert secret not in base.text


def test_retention_gate_states_match_sweep_service():
    from app.services import data_center_governance as gov_svc, retention_sweep_service as sweep
    assert tuple(gov_svc.NO_GATE_STATES) == tuple(sweep._NO_GATE_STATES)
    assert tuple(gov_svc.TARGET_STATUSES) == tuple(sweep.TARGET_STATUSES)
