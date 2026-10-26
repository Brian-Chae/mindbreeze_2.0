"""SDD-243 M243-1/2 스키마: 단건 호환 CHECK, 일괄 nullable, part 크기/유일성, outbox 유일성, 원천 FK cascade 없음."""
from __future__ import annotations

import uuid

import pytest
import sqlalchemy as sa

pytestmark = pytest.mark.pg


def _user(conn) -> uuid.UUID:
    uid = uuid.uuid4()
    conn.execute(sa.text("insert into users (id, email, password_hash, name, role, status, auth_provider, verified_tier) "
                         "values (:i, :e, 'x', 'u', 'platform_admin', 'active', 'email', 'unverified')"),
                 {'i': uid, 'e': f'{uid.hex[:8]}@example.invalid'})
    return uid


def _job(conn, uid, **over):
    values = dict(id=uuid.uuid4(), user_id=uid, role='platform_admin', include='[]', purpose='p', req='h' * 64)
    values.update(over)
    cols = ('id, user_id, requester_role, include, purpose, request_hash, status, schema_version, consent_policy_version, '
            'expires_at, completed_count, warnings, kind' + (', session_id, participant_id, consent_eeg' if 'sid' in over else ''))
    vals = (":id, :user_id, :role, cast(:include as jsonb), :purpose, :req, 'queued', 's', 'v', now() + interval '1 day', 0, "
            "cast('[]' as jsonb), :kind" + (', :sid, :pid, :ce' if 'sid' in over else ''))
    params = {k: values[k] for k in ('id', 'user_id', 'role', 'include', 'purpose', 'req')}
    params['kind'] = over.get('kind', 'single')
    if 'sid' in over:
        params.update(sid=over['sid'], pid=over['pid'], ce=over['ce'])
    conn.execute(sa.text(f'insert into data_export_jobs ({cols}) values ({vals})'), params)
    return values['id']


def test_single_jobs_keep_required_columns_and_bulk_may_omit(pg_conn):
    uid = _user(pg_conn)
    # 일괄(data_center) 은 단건 컬럼 없이 생성된다
    _job(pg_conn, uid, kind='data_center')
    # 단건은 기존 필수 유지: 컬럼이 비면 CHECK 위반
    with pytest.raises(sa.exc.IntegrityError):
        with pg_conn.begin_nested():
            _job(pg_conn, uid, kind='single')
    # 단건을 완전하게 채우면 통과
    _job(pg_conn, uid, kind='single', sid=uuid.uuid4(), pid=uuid.uuid4(), ce=True)
    # 알 수 없는 kind 는 거절
    with pytest.raises(sa.exc.IntegrityError):
        with pg_conn.begin_nested():
            _job(pg_conn, uid, kind='bogus')
    row = pg_conn.execute(sa.text("select kind, fencing_token, target_count from data_export_jobs where kind='data_center'")).first()
    assert tuple(row) == ('data_center', 0, 1)  # 기본값


def test_idempotency_unique_is_kept(pg_conn):
    uid = _user(pg_conn)
    j1 = _job(pg_conn, uid, kind='data_center')
    pg_conn.execute(sa.text("update data_export_jobs set idempotency_key='k' where id=:i"), {'i': j1})
    j2 = _job(pg_conn, uid, kind='data_center')
    with pytest.raises(sa.exc.IntegrityError):
        with pg_conn.begin_nested():
            pg_conn.execute(sa.text("update data_export_jobs set idempotency_key='k' where id=:i"), {'i': j2})


def test_parts_and_outbox_constraints(pg_conn):
    uid = _user(pg_conn)
    jid = _job(pg_conn, uid, kind='data_center')
    ins = "insert into data_export_parts (id, job_id, part_no, size_bytes) values (:i, :j, :n, :s)"
    pg_conn.execute(sa.text(ins), {'i': uuid.uuid4(), 'j': jid, 'n': 1, 's': 1_000_000_000})  # 경계값 허용
    for n, s in ((1, 10), (2, 1_000_000_001), (0, 10), (3, -1)):  # 중복 part_no / 1GB 초과 / part_no 0 / 음수
        with pytest.raises(sa.exc.IntegrityError):
            with pg_conn.begin_nested():
                pg_conn.execute(sa.text(ins), {'i': uuid.uuid4(), 'j': jid, 'n': n, 's': s})
    pg_conn.execute(sa.text("insert into data_export_dispatch_outbox (id, job_id) values (:i, :j)"), {'i': uuid.uuid4(), 'j': jid})
    with pytest.raises(sa.exc.IntegrityError):  # job 당 outbox 1행
        with pg_conn.begin_nested():
            pg_conn.execute(sa.text("insert into data_export_dispatch_outbox (id, job_id) values (:i, :j)"), {'i': uuid.uuid4(), 'j': jid})
    with pytest.raises(sa.exc.IntegrityError):
        with pg_conn.begin_nested():
            pg_conn.execute(sa.text("insert into data_export_dispatch_outbox (id, job_id, status) values (:i, :j, 'bogus')"),
                            {'i': uuid.uuid4(), 'j': _job(pg_conn, uid, kind='data_center')})


def test_targets_have_no_source_foreign_keys(pg_conn):
    """대상은 원천(session/participant) FK 가 없어 원천 삭제가 감사·작업 증거로 cascade 되지 않는다."""
    fks = sa.inspect(pg_conn).get_foreign_keys('data_export_targets')
    referred = {fk['referred_table'] for fk in fks}
    assert referred <= {'data_export_previews', 'data_export_jobs'}
    jobs_fks = {fk['referred_table'] for fk in sa.inspect(pg_conn).get_foreign_keys('data_export_jobs')}
    assert jobs_fks == {'users'}
