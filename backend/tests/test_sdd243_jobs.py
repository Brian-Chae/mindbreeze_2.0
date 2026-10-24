"""SDD-243 B05 — preview 고정·작업 원장·멱등/한도·outbox·lease/fencing·재인가.

ZIP 생성(B06)·재인증 검증기(B07)는 이 Task 의 범위가 아니므로 주입점(fake)으로 검증한다.
"""
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import pytest

from app.api.v1 import data_center as api
from app.config import settings
from app.main import app
from app.models.data_export import (DataExportAudit, DataExportDispatchOutbox, DataExportJob, DataExportPart,
                                    DataExportTarget)
from app.models.research import ResearchConsent
from app.models.user_org_membership import UserOrgMembership
from app.services import data_center_export as dcx, export_reauth
from tests.sdd243_helpers import (add_features, add_raw, auth, db, dc_enabled, mk_class, mk_part, mk_session, mk_user,  # noqa: F401
                                  world)
from tests.test_sdd243_measurements import FakeBackend, build_manifest, chunk_ref, eeg_maker

BASE = '/api/v1/data-center'


class OkVerifier:
    def verify(self, db, context, proof, **kw):
        return proof == 'ok-proof'


@pytest.fixture
def env(client, world, db, dc_enabled, monkeypatch):
    monkeypatch.setattr(export_reauth, '_verifier', OkVerifier())
    monkeypatch.setattr(settings, 'data_center_export_reauth_required', True)  # 스위치 켜짐 = 기존 SDD-243 동작
    sent: list[UUID] = []
    monkeypatch.setattr(dcx, 'enqueue_job', lambda job_id: sent.append(job_id))
    for sess, part in ((world.s_a1, world.p_a1_c), (world.s_a1, world.p_a1_c2), (world.s_a2, world.p_a2_c),
                       (world.s_b1, world.p_b1_c), (world.s_b2, world.p_b2_c2)):
        add_features(db, sess, part, 2)
    db.commit()
    world.sent = sent
    yield world
    app.dependency_overrides.pop(api.backend_dep, None)


def body(scope, target, **kw):
    base = {'scope': scope, 'target_id': str(target), 'include': ['features']}
    base.update(kw)
    return base


def preview(client, user, payload, org=None):
    return client.post(BASE + '/exports/preview', params={'org_id': str(org)} if org else None, json=payload, headers=auth(user))


def create(client, user, token, *, key='k1', reason='운영 점검', proof='ok-proof', org=None):
    headers = auth(user)
    if key:
        headers['Idempotency-Key'] = key
    return client.post(BASE + '/exports', params={'org_id': str(org)} if org else None,
                       json={'preview_token': token, 'reason': reason, 'reauth_proof': proof}, headers=headers)


def new_preview(client, user, scope='session', target=None, **kw):
    r = preview(client, user, body(scope, target, **kw))
    assert r.status_code == 200, r.text
    return r.json()


# ── 50/51회차·클래스 무제한 ─────────────────────────────────────────────

def test_50_51_and_class_unlimited(client, env, db):
    w = env
    member = mk_user(db, 'client', '다회차회원')
    ids = []
    for i in range(51):
        s = mk_session(db, w.counselor, w.cls_a, w.org_a, day=10 + i, seq=100 + i)
        p = mk_part(db, s, member)
        add_features(db, s, p, 1)
        ids.append(s.id)
    db.commit()
    r = preview(client, w.admin_a, body('member', member.id))
    assert r.status_code == 413 and r.json()['detail']['code'] == 'too_many_sessions'
    assert r.json()['detail']['total'] == 51 and r.json()['detail']['max'] == 50
    first = new_preview(client, w.admin_a, 'member', member.id, range={'batch_index': 1})
    second = new_preview(client, w.admin_a, 'member', member.id, range={'batch_index': 2})
    assert (first['session_count'], second['session_count']) == (50, 1)
    assert first['participant_count'] == 50  # 회원은 회차마다 본인만
    assert preview(client, w.admin_a, body('member', member.id, range={'batch_index': 3})).status_code == 422
    assert preview(client, w.admin_a, body('member', member.id, range={'session_ids': [str(i) for i in ids]})).status_code == 413
    assert new_preview(client, w.admin_a, 'member', member.id,
                       range={'session_ids': [str(i) for i in ids[:50]]})['session_count'] == 50
    assert preview(client, w.admin_a, body('member', member.id, range={'session_ids': [str(ids[0]), str(uuid4())]})).status_code == 404
    # 클래스 전체는 회차·참여자 수 제한이 없다
    cls = new_preview(client, w.admin_a, 'class', w.cls_a.id)
    assert cls['session_count'] == 53 and cls['participant_count'] == 51 + 3
    # 회차 101참여자
    big = mk_session(db, w.counselor, w.cls_a, w.org_a, day=200)
    for _ in range(101):
        p = mk_part(db, big, mk_user(db, 'client', '참여'))
        add_features(db, big, p, 1)
    db.commit()
    assert new_preview(client, w.admin_a, 'session', big.id)['participant_count'] == 101


def test_facilitator_period_rules(client, env):
    w = env
    assert preview(client, w.admin_a, body('facilitator', w.counselor.id)).status_code == 422
    assert preview(client, w.admin_a, body('facilitator', w.counselor.id,
                                           range={'date_from': '2026-10-05', 'date_to': '2026-10-01'})).status_code == 422
    ok = new_preview(client, w.admin_a, 'facilitator', w.counselor.id, range={'date_from': '2026-10-01', 'date_to': '2026-10-01'})
    assert ok['session_count'] == 1  # KST 10/01 에 시작한 a1 만(a2 는 10/02)
    none = preview(client, w.admin_a, body('facilitator', w.counselor.id, range={'date_from': '2027-01-01', 'date_to': '2027-01-02'}))
    assert none.status_code == 422 and none.json()['detail']['code'] == 'no_sessions'


def test_preview_scope_and_exclusions(client, env):
    w = env
    cls = new_preview(client, w.admin_a, 'class', w.cls_a.id)
    assert cls['eligible'] and cls['session_count'] == 2 and cls['participant_count'] == 3
    counts = cls['exclusion_counts']
    assert counts['not_completed'] == 1 and counts['band_not_used'] == 1  # 진행 전 회차, 데이터 없는 비회원
    assert cls['policy_version'] == 'dc-policy-1' and cls['targets'][0]['ordinal'] == 1
    assert 'estimated_part_count' in cls and cls['estimated_part_count'] == 1
    # 범위 밖·연구·report
    for scope, target in (('session', w.s_b1.id), ('class', w.cls_b.id), ('session', w.s_solo.id), ('class', w.cls_unknown.id)):
        assert preview(client, w.admin_a, body(scope, target)).status_code == 404
    r = preview(client, w.admin_a, body('session', w.s_a1.id, purpose='research'))
    assert r.status_code == 403 and r.json()['detail']['code'] == 'research_forbidden'
    assert preview(client, w.admin_a, body('session', w.s_a1.id, include=['report'])).status_code == 422
    assert preview(client, w.admin_a, body('session', w.s_a1.id, scope_org_id=str(w.org_b.id))).status_code == 409
    assert preview(client, w.counselor, body('session', w.s_a1.id)).status_code == 403
    assert preview(client, w.admin_ab, body('session', w.s_b1.id)).status_code == 400  # 기관 선택 필요
    assert preview(client, w.admin_ab, body('session', w.s_b1.id), org=w.org_b.id).status_code == 200
    assert preview(client, w.admin_ab, body('session', w.s_b1.id), org=w.org_a.id).status_code == 404


def test_research_requires_consent(client, env, db):
    w = env
    db.add(ResearchConsent(session_id=w.s_a1.id, participant_id=w.p_a1_c.id, consented=True, consented_at=datetime.now(timezone.utc)))
    db.add(ResearchConsent(session_id=w.s_a1.id, participant_id=w.p_a1_c2.id, consented=True,
                           consented_at=datetime.now(timezone.utc), withdrawn_at=datetime.now(timezone.utc)))
    db.commit()
    r = new_preview(client, w.platform, 'session', w.s_a1.id, purpose='research')
    assert r['participant_count'] == 1 and r['exclusion_counts']['consent_missing'] >= 2
    assert preview(client, w.platform, body('session', w.s_a1.id, purpose='research', identity='identified')).status_code == 403


# ── raw: manifest revision 고정 ─────────────────────────────────────────

class RawOwners(FakeBackend):
    """raw 를 가진 참여자에게만 manifest 를 돌려준다(실제 T06 처럼 참여자별 manifest)."""

    def __init__(self, manifest, owners):
        super().__init__(manifest, eeg_maker())
        self.owners = {str(o) for o in owners}

    def get_manifest(self, session_id, participant_id, revision=None):
        return self.manifest if str(participant_id) in self.owners else None


def use_manifest(w, manifest):
    app.dependency_overrides[api.backend_dep] = lambda: RawOwners(manifest, [w.p_a1_c.id, w.p_a1_c2.id])


def raw_env(client, w, db, manifest):
    add_raw(db, w.s_a1, w.p_a1_c)
    add_raw(db, w.s_a1, w.p_a1_c2, (50,))
    db.commit()
    use_manifest(w, manifest)


def test_preview_revision_pinned(client, env, db):
    w = env
    raw_env(client, w, db, build_manifest([chunk_ref(0)]))
    pv = new_preview(client, w.admin_a, 'session', w.s_a1.id, include=['eeg_raw', 'features'])
    assert {t['manifest_revision'] for t in pv['targets']} == {2}
    assert pv['estimated_bytes'] >= 350
    # preview 뒤에 후발 revision 이 생겨도 고정 대상은 바뀌지 않는다
    newer = build_manifest([chunk_ref(0)])
    object.__setattr__(newer, 'revision', 3)
    use_manifest(w, newer)
    r = create(client, w.admin_a, pv['preview_token'])
    assert r.status_code == 202, r.text
    db.expire_all()
    targets = db.query(DataExportTarget).filter(DataExportTarget.job_id == UUID(r.json()['export_id'])).all()
    assert len(targets) == 2 and {t.manifest_revision for t in targets} == {2}
    assert all(t.source_deadline is not None for t in targets)  # raw 원천 기한 고정


def test_manifest_states(client, env, db):
    w = env
    raw_env(client, w, db, build_manifest([chunk_ref(0)], close_state='partial'))
    r = preview(client, w.admin_a, body('session', w.s_a1.id, include=['eeg_raw']))
    assert r.status_code == 409 and r.json()['detail']['code'] == 'manifest_partial'
    assert preview(client, w.admin_a, body('session', w.s_a1.id, include=['eeg_raw'], allow_partial=True)).status_code == 200
    use_manifest(w, build_manifest([chunk_ref(0)], close_state='pending_upload'))
    r = preview(client, w.admin_a, body('session', w.s_a1.id, include=['eeg_raw']))
    assert r.status_code == 409 and r.json()['detail']['code'] == 'manifest_pending'
    app.dependency_overrides[api.backend_dep] = lambda: FakeBackend(None, eeg_maker())
    r = preview(client, w.admin_a, body('session', w.s_a1.id, include=['eeg_raw'])).json()
    assert r['eligible'] is False and r['blocked_reason'] == 'no_eligible_targets' and r['preview_token'] == ''
    assert r['exclusion_counts']['manifest_not_connected'] == 3
    ppg = build_manifest([chunk_ref(0)])
    use_manifest(w, ppg)
    r = preview(client, w.admin_a, body('session', w.s_a1.id, include=['eeg_raw', 'ppg_raw'])).json()
    assert r['eligible'] and r['exclusion_counts']['unsupported_client'] == 2  # PPG 미지원은 사유와 함께 제외, EEG 는 유지


def test_expired_raw_source_excluded(client, env, db):
    w = env
    add_raw(db, w.s_a1, w.p_a1_c)
    from app.models.record import EEGRawChunk
    for chunk in db.query(EEGRawChunk).filter(EEGRawChunk.participant_id == w.p_a1_c.id).all():
        chunk.uploaded_at = datetime.now(timezone.utc) - timedelta(days=100)
    db.commit()
    use_manifest(w, build_manifest([chunk_ref(0)]))
    r = preview(client, w.admin_a, body('participant', w.p_a1_c.id, include=['eeg_raw'])).json()
    assert r['eligible'] is False and r['exclusion_counts']['expired'] == 1


# ── 생성: 멱등·한도·재인증·재인가 ───────────────────────────────────────

def test_create_requires_header_reason_and_reauth(client, env, monkeypatch):
    w = env
    token = new_preview(client, w.admin_a, 'session', w.s_a1.id)['preview_token']
    assert create(client, w.admin_a, token, key=None).status_code == 422
    assert create(client, w.admin_a, token, reason=' a ').json()['detail']['code'] == 'reason_invalid'
    assert create(client, w.admin_a, token, proof=None).json()['detail']['code'] == 'reauth_required'
    assert create(client, w.admin_a, token, proof='wrong').json()['detail']['code'] == 'reauth_invalid'
    monkeypatch.setattr(export_reauth, '_verifier', None)
    assert create(client, w.admin_a, token).json()['detail']['code'] == 'reauth_unavailable'  # 검증기 없으면 fail closed
    assert create(client, w.platform, token).status_code == 404  # 타인의 preview 토큰


def test_idempotency_and_active_limit(client, env, db, monkeypatch):
    w = env
    t1 = new_preview(client, w.admin_a, 'session', w.s_a1.id)
    r1 = create(client, w.admin_a, t1['preview_token'], key='same')
    assert r1.status_code == 202
    job_id = r1.json()['export_id']
    again = create(client, w.admin_a, t1['preview_token'], key='same')
    assert again.status_code == 202 and again.json()['export_id'] == job_id  # 같은 키+같은 요청 = 같은 작업
    t2 = new_preview(client, w.admin_a, 'session', w.s_a2.id)
    diff = create(client, w.admin_a, t2['preview_token'], key='same')
    assert diff.status_code == 409 and diff.json()['detail']['code'] == 'request_hash_mismatch'
    busy = create(client, w.admin_a, t2['preview_token'], key='other')
    assert busy.status_code == 429 and busy.json()['detail']['export_id'] == job_id  # 활성 작업 1개
    assert create(client, w.admin_a, t1['preview_token'], key='third').json()['detail']['code'] == 'preview_consumed'
    monkeypatch.setattr(settings, 'data_center_max_active_jobs_per_actor', 2)  # 설정값 변경 반영(정책 해시 변경)
    t3 = new_preview(client, w.admin_a, 'session', w.s_a2.id)
    assert create(client, w.admin_a, t3['preview_token'], key='k3').status_code == 202
    t4 = new_preview(client, w.admin_a, 'session', w.s_a1.id, include=['features'], eeg_format='parquet')
    assert create(client, w.admin_a, t4['preview_token'], key='k4').status_code == 429
    # 다른 관리자는 별개 한도
    t5 = new_preview(client, w.platform, 'session', w.s_a1.id)
    assert create(client, w.platform, t5['preview_token'], key='p1').status_code == 202
    db.expire_all()
    assert db.query(DataExportJob).filter(DataExportJob.kind == 'data_center').count() == 3
    # 큐에는 작업당 한 번씩만 전달
    assert len(w.sent) == 3 and len(set(w.sent)) == 3


def test_create_reauthorizes_after_preview(client, env, db, monkeypatch):
    w = env
    # (a) 동의 철회
    t = new_preview(client, w.admin_a, 'session', w.s_a1.id)['preview_token']
    w.p_a1_c.consent_eeg = w.p_a1_c.eeg_collection_consented = False
    db.commit()
    r = create(client, w.admin_a, t)
    assert r.status_code == 409 and r.json()['detail']['code'] == 'scope_changed'
    w.p_a1_c.consent_eeg = w.p_a1_c.eeg_collection_consented = True
    db.commit()
    # (b) 참여자 제거
    t = new_preview(client, w.admin_a, 'session', w.s_a1.id)['preview_token']
    w.p_a1_c2.removed_at = datetime.now(timezone.utc)
    db.commit()
    assert create(client, w.admin_a, t, key='b').json()['detail']['code'] == 'scope_changed'
    w.p_a1_c2.removed_at = None
    db.commit()
    # (c) 정책 변경(더 엄격)
    t = new_preview(client, w.admin_a, 'session', w.s_a1.id, identity='identified')['preview_token']
    monkeypatch.setattr(settings, 'data_center_org_identified_operations_enabled', False)
    r = create(client, w.admin_a, t, key='c')
    assert r.status_code == 409 and r.json()['detail']['code'] == 'policy_changed'
    monkeypatch.setattr(settings, 'data_center_org_identified_operations_enabled', True)
    # (d) preview 만료
    t = new_preview(client, w.admin_a, 'session', w.s_a1.id)['preview_token']
    from app.models.data_export import DataExportPreview
    db.query(DataExportPreview).update({'expires_at': datetime.now(timezone.utc) - timedelta(seconds=1)})
    db.commit()
    assert create(client, w.admin_a, t, key='d').json()['detail']['code'] == 'preview_expired'
    # (e) 소속 해제 → 기관 관리자 권한 상실
    t = new_preview(client, w.admin_a, 'session', w.s_a2.id)['preview_token']
    db.query(UserOrgMembership).filter(UserOrgMembership.user_id == w.admin_a.id).update({'status': 'left'})
    db.commit()
    assert create(client, w.admin_a, t, key='e').status_code == 403
    assert db.query(DataExportJob).filter(DataExportJob.kind == 'data_center').count() == 0


# ── 상태·목록: 본인 + 현재 기관 ─────────────────────────────────────────

def test_status_and_list_owner_and_org_scope(client, env, db):
    w = env
    r = preview(client, w.admin_ab, body('session', w.s_a1.id), org=w.org_a.id)
    assert r.status_code == 200
    created = create(client, w.admin_ab, r.json()['preview_token'], org=w.org_a.id, key='ab')
    assert created.status_code == 202
    job_id = created.json()['export_id']
    assert created.headers['cache-control'] == 'no-store'
    ok = client.get(f'{BASE}/exports/{job_id}', params={'org_id': str(w.org_a.id)}, headers=auth(w.admin_ab))
    assert ok.status_code == 200 and ok.json()['status'] == 'queued' and ok.json()['parts'] == []
    assert 'object' not in ok.text and 'key' not in ok.text.replace('Idempotency', '')
    # 같은 관리자라도 다른 기관을 선택하면 보이지 않는다
    assert client.get(f'{BASE}/exports/{job_id}', params={'org_id': str(w.org_b.id)}, headers=auth(w.admin_ab)).status_code == 404
    # 다른 관리자(플랫폼 포함)는 접근 불가
    assert client.get(f'{BASE}/exports/{job_id}', headers=auth(w.platform)).status_code == 404
    assert client.get(f'{BASE}/exports/{job_id}', headers=auth(w.admin_a)).status_code == 404
    lst = client.get(f'{BASE}/exports', params={'org_id': str(w.org_a.id)}, headers=auth(w.admin_ab)).json()
    assert [i['export_id'] for i in lst['items']] == [job_id]
    assert client.get(f'{BASE}/exports', params={'org_id': str(w.org_b.id)}, headers=auth(w.admin_ab)).json()['items'] == []
    assert client.get(f'{BASE}/exports', headers=auth(w.platform)).json()['items'] == []
    # 만료 도달 시 조회가 expired 로 전이하고 감사를 남긴다
    db.query(DataExportJob).update({'expires_at': datetime.now(timezone.utc) - timedelta(seconds=1)})
    db.commit()
    exp = client.get(f'{BASE}/exports/{job_id}', params={'org_id': str(w.org_a.id)}, headers=auth(w.admin_ab)).json()
    assert exp['status'] == 'expired'
    db.expire_all()
    assert {a.event for a in db.query(DataExportAudit).filter(DataExportAudit.export_id == UUID(job_id))} == {'requested', 'expired'}
    # 단건(legacy) API 는 일괄 작업을 보지 못한다
    assert client.get(f'/api/v1/data-exports/{job_id}', headers=auth(w.platform)).status_code == 404


# ── outbox · lease · fencing ────────────────────────────────────────────

def make_job(client, w, key='o1'):
    token = new_preview(client, w.admin_a, 'session', w.s_a1.id)['preview_token']
    r = create(client, w.admin_a, token, key=key)
    assert r.status_code == 202
    return UUID(r.json()['export_id'])


def test_outbox_and_lease_recovery(client, env, db, monkeypatch):
    w = env
    calls = []

    def flaky(job_id):
        calls.append(job_id)
        raise ConnectionError('broker down')

    monkeypatch.setattr(dcx, 'enqueue_job', flaky)
    job_id = make_job(client, w)
    db.expire_all()
    outbox = db.query(DataExportDispatchOutbox).filter_by(job_id=job_id).one()
    assert outbox.status == 'pending' and outbox.attempts == 1 and outbox.last_error == 'ConnectionError'
    assert db.get(DataExportJob, job_id).status == 'queued'  # 큐 실패여도 작업은 유실되지 않는다
    # 백오프 전에는 재전달하지 않는다
    assert dcx.redeliver_outbox(db)['delivered'] == 0 and len(calls) == 1
    delivered: list[UUID] = []
    later = datetime.now(timezone.utc) + timedelta(seconds=120)
    out = dcx.redeliver_outbox(db, enqueue=delivered.append, moment=later)
    assert out['delivered'] == 1 and delivered == [job_id]
    assert dcx.redeliver_outbox(db, enqueue=delivered.append, moment=later)['delivered'] == 0  # 중복 전달 0
    db.expire_all()
    assert db.query(DataExportDispatchOutbox).filter_by(job_id=job_id).one().status == 'published'
    # 전달 중 죽은 항목(lease 만료)
    db.query(DataExportDispatchOutbox).update({'status': 'delivering', 'lease_expires_at': later - timedelta(seconds=500)})
    db.commit()
    assert dcx.redeliver_outbox(db, enqueue=delivered.append, moment=later)['delivered'] == 1
    assert delivered == [job_id, job_id]


def test_claim_lease_and_fencing(client, env, db):
    w = env
    job_id = make_job(client, w)
    a = dcx.claim_job(db, job_id, 'worker-a')
    assert a == 1
    assert dcx.claim_job(db, job_id, 'worker-b') is None  # lease 유효 중에는 인수 불가
    # worker A 가 죽어 lease 가 만료되면 B 가 인수하고 fencing token 이 증가한다
    db.query(DataExportJob).update({'lease_expires_at': datetime.now(timezone.utc) - timedelta(seconds=1)})
    db.commit()
    b = dcx.claim_job(db, job_id, 'worker-b')
    assert b == 2
    with pytest.raises(dcx.StaleLease):
        dcx.renew_lease(db, job_id, a)
    outcome = dcx.PackageOutcome(parts=[{'part_no': 1, 'object_key': 'k', 'size_bytes': 10, 'checksum': 'c' * 64}],
                                 warnings=[], expected_part_count=1)
    with pytest.raises(dcx.StaleLease):  # 낡은 worker 의 완료 처리는 무시된다
        dcx.finalize_success(db, job_id, a, outcome)
    db.expire_all()
    assert db.get(DataExportJob, job_id).status == 'preparing'
    # part 수가 기대와 다르면 ready 금지
    with pytest.raises(ValueError):
        dcx.finalize_success(db, job_id, b, dcx.PackageOutcome(parts=outcome.parts, warnings=[], expected_part_count=2))
    dcx.finalize_success(db, job_id, b, outcome)
    db.expire_all()
    job = db.get(DataExportJob, job_id)
    assert job.status == 'ready' and job.completed_count == 1 and job.lease_owner is None
    assert [p.status for p in db.query(DataExportPart).filter_by(job_id=job_id)] == ['ready']
    assert {a.event for a in db.query(DataExportAudit).filter_by(export_id=job_id)} == {'requested', 'ready'}
    assert dcx.claim_job(db, job_id, 'worker-c') is None  # 종료 상태는 재인수 불가


def test_stalled_job_is_requeued(client, env, db):
    w = env
    job_id = make_job(client, w)
    dcx.redeliver_outbox(db, enqueue=lambda j: None, moment=datetime.now(timezone.utc) + timedelta(seconds=1))
    assert dcx.claim_job(db, job_id, 'dead-worker') == 1
    later = datetime.now(timezone.utc) + timedelta(seconds=dcx.LEASE_SECONDS + 5)
    again: list[UUID] = []
    out = dcx.redeliver_outbox(db, enqueue=again.append, moment=later)
    assert out['stalled_recovered'] == 1 and again == [job_id]
    assert dcx.claim_job(db, job_id, 'new-worker', moment=later) == 2


def run(db, job_id):
    from app.services.export_service import run_export
    run_export(job_id, db)
    db.expire_all()
    return db.get(DataExportJob, job_id)


def test_worker_dispatch_and_failure_modes(client, env, db, monkeypatch):
    w = env
    # 빌더 미연결 → ready 로 속이지 않고 failed
    monkeypatch.setattr(dcx, 'PACKAGE_BUILDER', None)
    job = run(db, make_job(client, w, 'w1'))
    assert job.status == 'failed' and job.error_code == 'package_builder_unavailable'
    # 빌더가 연결되면 ready
    ok_outcome = dcx.PackageOutcome(parts=[{'part_no': 1, 'object_key': 'x', 'size_bytes': 5, 'checksum': 'd' * 64}],
                                    warnings=['누락 확인됨'], expected_part_count=1)
    monkeypatch.setattr(dcx, 'PACKAGE_BUILDER', lambda db_, job_, token: ok_outcome)
    job = run(db, make_job(client, w, 'w2'))
    assert job.status == 'ready_with_warnings' and job.warnings == ['누락 확인됨']
    # 실행 시점 재인가: 동의 철회 → scope_changed
    jid = make_job(client, w, 'w3')
    w.p_a1_c.consent_eeg = w.p_a1_c.eeg_collection_consented = False
    db.commit()
    assert run(db, jid).error_code == 'scope_changed'
    w.p_a1_c.consent_eeg = w.p_a1_c.eeg_collection_consented = True
    db.commit()
    # 소속 해제 → access_revoked
    jid = make_job(client, w, 'w4')
    db.query(UserOrgMembership).filter(UserOrgMembership.user_id == w.admin_a.id).update({'status': 'left'})
    db.commit()
    assert run(db, jid).error_code == 'access_revoked'
    db.query(UserOrgMembership).filter(UserOrgMembership.user_id == w.admin_a.id).update({'status': 'active'})
    db.commit()
    # 정책 변경 → policy_changed
    jid = make_job(client, w, 'w5')
    monkeypatch.setattr(settings, 'data_center_url_ttl_seconds', 30)
    assert run(db, jid).error_code == 'policy_changed'
    monkeypatch.setattr(settings, 'data_center_url_ttl_seconds', 60)
    # 만료된 작업은 claim 불가 + expire_jobs 가 상태를 전이
    jid = make_job(client, w, 'w6')
    db.query(DataExportJob).filter(DataExportJob.id == jid).update({'expires_at': datetime.now(timezone.utc) - timedelta(seconds=1)})
    db.commit()
    assert dcx.claim_job(db, jid) is None
    assert dcx.expire_jobs(db) >= 1
    db.expire_all()
    assert db.get(DataExportJob, jid).status == 'expired'
    # 예외 메시지·원문이 error_code 에 새지 않는다
    monkeypatch.setattr(dcx, 'PACKAGE_BUILDER', lambda *a: (_ for _ in ()).throw(RuntimeError('secret-path /var/x')))
    jid = make_job(client, w, 'w7')
    job = run(db, jid)
    assert job.error_code == 'generation_failed' and 'secret' not in str(job.error_code)


def test_legacy_single_export_unchanged_by_active_dc_job(client, env, db):
    """일괄 작업이 진행 중이어도 단건 API 의 한도 규칙(요청자당 활성 1개)은 그대로 합산된다."""
    w = env
    make_job(client, w, 'l1')
    legacy = client.post(f'/api/v1/sessions/{w.s_a1.id}/participants/{w.p_a1_c.id}/data-exports',
                         json={'purpose': '상담 경과 분석'}, headers={**auth(w.counselor), 'Idempotency-Key': 'x'})
    assert legacy.status_code in (202, 403, 404, 409)  # 기관 관리자 아님 → 단건 규칙대로 응답(500 없음)


def test_audit_failure_blocks_creation(client, env, db, monkeypatch):
    """감사 기록 실패 시 작업·outbox·대상 연결이 하나도 남지 않는다(fail closed)."""
    w = env
    token = new_preview(client, w.admin_a, 'session', w.s_a1.id)['preview_token']

    def boom(*a, **k):
        raise RuntimeError('audit down')

    monkeypatch.setattr(dcx, 'audit_dc', boom)
    with pytest.raises(RuntimeError):
        create(client, w.admin_a, token)
    db.expire_all()
    assert db.query(DataExportJob).filter(DataExportJob.kind == 'data_center').count() == 0
    assert db.query(DataExportDispatchOutbox).count() == 0
    assert w.sent == []
    from app.models.data_export import DataExportPreview
    assert db.query(DataExportPreview).filter(DataExportPreview.consumed_job_id.isnot(None)).count() == 0
    assert db.query(DataExportTarget).filter(DataExportTarget.job_id.isnot(None)).count() == 0
