"""SDD-243 B05 — PostgreSQL 경합: 동시 생성(활성 한도·멱등), 동시 claim, 동시 outbox 전달.

격리 합성 DB(마이그레이션 완료 DB 의 템플릿 복제본)에서만 실행한다: PG_SMOKE=1 DATABASE_URL=postgresql://…
  PG_SMOKE=1 DATABASE_URL=… pytest --confcutdir=tests/pg tests/pg/test_sdd243_jobs.py
"""
from __future__ import annotations

import threading
from datetime import datetime, timedelta, timezone

import pytest
import sqlalchemy as sa
from fastapi import HTTPException
from sqlalchemy.orm import Session as OrmSession

pytestmark = pytest.mark.pg


class OkVerifier:
    def verify(self, db, context, proof, **kw):
        return proof == 'ok'


@pytest.fixture(scope='session')
def head_template(scratch_db):
    """공유 DB 는 앞선 테스트의 잔여 연결 때문에 TEMPLATE 복제가 거부될 수 있다 — 아무도 접속하지 않는 전용 템플릿을 head 로 만든다."""
    from tests.pg.conftest import alembic_ok
    url = scratch_db('sdd243tpl')
    alembic_ok(url, 'upgrade', 'head')
    return sa.engine.make_url(url).database


@pytest.fixture
def pgdb(pg_engine, scratch_db, head_template, monkeypatch):
    from app.config import settings
    from app.services import data_center_export as dcx, export_reauth

    url = scratch_db('sdd243jobs', template=head_template)
    engine = sa.create_engine(url, pool_size=10, max_overflow=10)
    monkeypatch.setattr(settings, 'data_center_enabled', True)
    monkeypatch.setattr(export_reauth, '_verifier', OkVerifier())
    monkeypatch.setattr(dcx, 'enqueue_job', lambda job_id: None)
    from tests.sdd243_helpers import add_features, mk_class, mk_member, mk_org, mk_part, mk_session, mk_user
    with OrmSession(engine) as db:
        # PG 제약(부모 하나·진행자 복합 FK)을 지키는 최소 합성 월드
        platform = mk_user(db, 'platform_admin', '플랫폼')
        org_a = mk_org(db, '기관A')
        admin_a = mk_user(db, 'org_admin', '관리자A')
        mk_member(db, admin_a, org_a, 'org_admin')
        counselor = mk_user(db, 'counselor', '상담사')
        mk_member(db, counselor, org_a, 'counselor')
        cls_a = mk_class(db, org_a, counselor, 'A명상')
        s_a1 = mk_session(db, counselor, cls_a, org_a, day=0, seq=1)
        s_a2 = mk_session(db, counselor, cls_a, org_a, day=1, seq=2)
        for sess in (s_a1, s_a2):
            for name in ('회원1', '회원2'):
                add_features(db, sess, mk_part(db, sess, mk_user(db, 'client', name)), 2)
        db.commit()
        ids = {'admin_a': admin_a.id, 'platform': platform.id, 's_a1': s_a1.id, 's_a2': s_a2.id, 'cls_a': cls_a.id, 'org_a': org_a.id}
    yield engine, ids
    engine.dispose()


def previews(engine, ids, n):
    from app.schemas.data_export import DataCenterExportRequest
    from app.services import data_center_export as dcx
    from app.services.data_center_policy import resolve_context

    tokens = []
    for i in range(n):
        with OrmSession(engine) as db:
            ctx = resolve_context(db, ids['admin_a'], None)
            # 서로 다른 요청(해시)이 되도록 eeg_format/include 를 바꾼다
            req = DataCenterExportRequest(scope='session', target_id=ids['s_a1'], include=['features'],
                                          eeg_format='csv' if i % 2 == 0 else 'parquet',
                                          participant_ids=None if i < 2 else None)
            tokens.append(dcx.preview_export(db, ctx, req, __import__('app.services.data_center_measurement',
                                                                      fromlist=['x']).NullBackend()).preview_token)
    return tokens


def run_threads(fns):
    barrier = threading.Barrier(len(fns))
    results: list = [None] * len(fns)

    def wrap(i, fn):
        barrier.wait()
        try:
            results[i] = ('ok', fn())
        except HTTPException as exc:
            results[i] = ('http', exc.status_code, exc.detail)

    threads = [threading.Thread(target=wrap, args=(i, f)) for i, f in enumerate(fns)]
    [t.start() for t in threads]
    [t.join(30) for t in threads]
    return results


def test_idempotency_race(pgdb):
    from app.services import data_center_export as dcx
    from app.services.data_center_policy import resolve_context
    engine, ids = pgdb
    token = previews(engine, ids, 1)[0]

    def same_key():
        with OrmSession(engine) as db:
            ctx = resolve_context(db, ids['admin_a'], None)
            return str(dcx.create_data_center_export(db, ctx, token, '운영 점검', 'ok', 'same-key').id)

    res = run_threads([same_key] * 4)
    assert [r[0] for r in res] == ['ok'] * 4 and len({r[1] for r in res}) == 1  # 모두 같은 작업
    with OrmSession(engine) as db:
        assert db.execute(sa.text("select count(*) from data_export_jobs where kind='data_center'")).scalar() == 1
        assert db.execute(sa.text('select count(*) from data_export_dispatch_outbox')).scalar() == 1


def test_active_limit_race_one_wins(pgdb, monkeypatch):
    from app.services import data_center_export as dcx
    from app.services.data_center_policy import resolve_context
    engine, ids = pgdb
    tokens = previews(engine, ids, 4)

    def attempt(i):
        def fn():
            with OrmSession(engine) as db:
                ctx = resolve_context(db, ids['admin_a'], None)
                return str(dcx.create_data_center_export(db, ctx, tokens[i], '운영 점검', 'ok', f'key-{i}').id)
        return fn

    res = run_threads([attempt(i) for i in range(4)])
    wins = [r for r in res if r[0] == 'ok']
    losses = [r for r in res if r[0] == 'http']
    assert len(wins) == 1 and len(losses) == 3, res
    assert all(r[1] == 429 and r[2]['export_id'] == wins[0][1] for r in losses)  # 본인 진행 작업 ID 안내
    with OrmSession(engine) as db:
        assert db.execute(sa.text("select count(*) from data_export_jobs where kind='data_center' and status in ('queued','preparing')")).scalar() == 1


def test_active_limit_two_still_serialized(pgdb, monkeypatch):
    from app.config import settings
    from app.services import data_center_export as dcx
    from app.services.data_center_policy import resolve_context
    monkeypatch.setattr(settings, 'data_center_max_active_jobs_per_actor', 2)  # 설정 상향에도 직렬화 검사가 정상
    engine, ids = pgdb
    tokens = previews(engine, ids, 4)

    def attempt(i):
        def fn():
            with OrmSession(engine) as db:
                ctx = resolve_context(db, ids['admin_a'], None)
                return str(dcx.create_data_center_export(db, ctx, tokens[i], '운영 점검', 'ok', f'key-{i}').id)
        return fn

    res = run_threads([attempt(i) for i in range(4)])
    assert sum(1 for r in res if r[0] == 'ok') == 2 and sum(1 for r in res if r[0] == 'http') == 2


def test_concurrent_claim_single_owner_and_outbox_single_delivery(pgdb):
    from app.services import data_center_export as dcx
    from app.services.data_center_policy import resolve_context
    engine, ids = pgdb
    token = previews(engine, ids, 1)[0]
    with OrmSession(engine) as db:
        ctx = resolve_context(db, ids['admin_a'], None)
        job_id = dcx.create_data_center_export(db, ctx, token, '운영 점검', 'ok', 'k').id

    def claim(i):
        def fn():
            with OrmSession(engine) as db:
                return dcx.claim_job(db, job_id, f'w{i}')
        return fn

    res = run_threads([claim(i) for i in range(6)])
    tokens = [r[1] for r in res if r[0] == 'ok' and r[1] is not None]
    assert tokens == [1]  # 정확히 한 worker 만 인수
    # 큐 실패 후 outbox 재전달을 동시에 돌려도 한 번만 전달
    with OrmSession(engine) as db:
        db.execute(sa.text("update data_export_dispatch_outbox set status='pending', next_attempt_at=now() - interval '1 minute'"))
        db.execute(sa.text("update data_export_jobs set status='queued', lease_owner=null, lease_expires_at=null"))
        db.commit()
    sent: list = []
    lock = threading.Lock()

    def deliver():
        with OrmSession(engine) as db:
            return dcx.redeliver_outbox(db, enqueue=lambda j: (lock.acquire(), sent.append(j), lock.release()))

    run_threads([deliver] * 4)
    assert sent == [job_id]
