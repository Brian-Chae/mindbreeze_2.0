"""SDD-243 B07 — PostgreSQL: 감사 원자성(생성과 한 트랜잭션), event_id 멱등·경합, 원천 cascade 없음.

PG_SMOKE=1 DATABASE_URL=… pytest --confcutdir=tests/pg tests/pg/test_sdd243_audit.py
"""
from __future__ import annotations

import threading

import pytest
import sqlalchemy as sa
from fastapi import HTTPException
from sqlalchemy.orm import Session as OrmSession

from tests.pg.test_sdd243_jobs import OkVerifier, head_template, pgdb, previews, run_threads  # noqa: F401

pytestmark = pytest.mark.pg


def test_audit_failure_rolls_back_job_outbox_and_targets(pgdb, monkeypatch):
    from app.services import data_center_export as dcx
    from app.services.data_center_policy import resolve_context
    engine, ids = pgdb
    token = previews(engine, ids, 1)[0]

    def boom(*a, **k):
        raise RuntimeError('audit down')

    monkeypatch.setattr(dcx, 'audit_dc', boom)
    with OrmSession(engine) as db:
        ctx = resolve_context(db, ids['admin_a'], None)
        with pytest.raises(RuntimeError):
            dcx.create_data_center_export(db, ctx, token, '운영 점검', 'ok', 'k')
    with OrmSession(engine) as db:
        q = lambda sql: db.execute(sa.text(sql)).scalar()  # noqa: E731
        assert q("select count(*) from data_export_jobs where kind='data_center'") == 0
        assert q('select count(*) from data_export_dispatch_outbox') == 0
        assert q('select count(*) from data_export_targets where job_id is not null') == 0
        assert q('select count(*) from data_export_previews where consumed_job_id is not null') == 0


def test_event_id_dedup_under_race_and_audit_targets(pgdb):
    from app.models.data_export import DataExportJob
    from app.services import data_center_export as dcx
    from app.services.data_center_policy import resolve_context
    engine, ids = pgdb
    token = previews(engine, ids, 1)[0]
    with OrmSession(engine) as db:
        ctx = resolve_context(db, ids['admin_a'], None)
        job_id = dcx.create_data_center_export(db, ctx, token, '운영 점검', 'ok', 'k').id
        n_targets = db.execute(sa.text('select count(*) from data_export_targets where job_id=:j'), {'j': job_id}).scalar()
        assert db.execute(sa.text('select count(*) from data_export_audit_targets')).scalar() == n_targets > 0

    def emit():
        with OrmSession(engine) as db:
            job = db.get(DataExportJob, job_id)
            dcx.audit_dc(db, job, 'preparing', 'preparing')
            db.commit()

    run_threads([emit] * 5)
    with OrmSession(engine) as db:
        assert db.execute(sa.text("select count(*) from data_export_audits where export_id=:j and event='preparing'"), {'j': job_id}).scalar() == 1
        # 요청 감사는 정책·목적·사유·해시를 담고 URL/비밀 컬럼은 스키마에 없다
        cols = {c['name'] for c in sa.inspect(db.connection()).get_columns('data_export_audits')}
        assert not ({'url', 'signed_url', 'password', 'proof', 'token'} & cols)
        row = db.execute(sa.text("select identity, purpose_type, reason, request_hash, scope_org_id, session_id from data_export_audits "
                                 "where export_id=:j and event='requested'"), {'j': job_id}).first()
        assert row[0] == 'pseudonymized' and row[1] == 'operations' and row[2] == '운영 점검' and row[3] and row[4] and row[5] is None


def test_no_cascade_from_sources_to_audit(pgdb):
    engine, _ = pgdb
    insp = sa.inspect(engine)
    assert insp.get_foreign_keys('data_export_audits') == []
    assert {fk['referred_table'] for fk in insp.get_foreign_keys('data_export_audit_targets')} == {'data_export_audits'}
    # 일괄 작업 대상도 원천 FK 가 없다
    assert {fk['referred_table'] for fk in insp.get_foreign_keys('data_export_targets')} <= {'data_export_previews', 'data_export_jobs'}
