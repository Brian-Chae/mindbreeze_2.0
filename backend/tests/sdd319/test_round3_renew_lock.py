"""round-3 실제 PostgreSQL: renew 병렬성과 ledger·종료 경계. 합성 DB는 보존한다."""
from __future__ import annotations

import threading
import uuid
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from dataclasses import replace
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import sessionmaker

from app.models.live_state import CaptureStream, LiveCommandLedger, LiveOutbox, LiveSessionEpoch
from app.services import session_live_commands as slc
from app.services.session_live_ledger import lock_epoch
from tests.sdd246.commands.conftest import World
from tests.sdd308.test_s5_measurement import preserved_pg_url

T0 = datetime(2026, 11, 7, tzinfo=timezone.utc)


@pytest.fixture(scope='session')
def pg_url():
    yield from preserved_pg_url()


@pytest.fixture(scope='session')
def pg_engine(pg_url):
    engine = sa.create_engine(pg_url, pool_size=20, max_overflow=20)
    yield engine
    engine.dispose()


@pytest.fixture
def maker(pg_engine):
    return sessionmaker(bind=pg_engine, autoflush=False)


@pytest.fixture
def world(maker):
    return World(maker)


@pytest.fixture(autouse=True)
def handlers():
    saved = dict(slc._HANDLERS)
    yield
    slc._HANDLERS.clear()
    slc._HANDLERS.update(saved)


@contextmanager
def sql_statements(engine):
    statements = []
    def before(conn, cursor, statement, params, context, many):
        statements.append(statement)
    sa.event.listen(engine, 'before_cursor_execute', before)
    try:
        yield statements
    finally:
        sa.event.remove(engine, 'before_cursor_execute', before)


def start(maker, world, member=0):
    cmd = slc.LiveCommand(uuid.uuid4(), world.session_id, 'capture.start', {
        'device_profile': 'linkband2-v1', 'algorithm_version': 'web-ts-1', 'model_version': 'b0'})
    with maker() as db:
        return slc.apply_command(db, world.member(member), cmd, now=T0)


def renew(world, stream, **kw):
    return slc.LiveCommand(uuid.uuid4(), world.session_id, 'capture.renew', {
        'stream_id': stream.result['stream_id'], 'owner_generation': '1',
        'clock_anchor_id': str(uuid.uuid4())}, **kw)


def apply(maker, actor, cmd, **kw):
    with maker() as db:
        return slc.apply_command(db, actor, cmd, now=T0 + timedelta(seconds=10), **kw)


def test_다른_stream_renew는_한_stream_락대기와_독립적으로_완료(maker, world, pg_engine):
    first, second = start(maker, world), start(maker, world, 1)
    reached = threading.Event()
    def before(conn, cursor, statement, params, context, many):
        if threading.current_thread().name.startswith('blocked-renew') and 'FROM capture_stream' in statement and 'FOR UPDATE' in statement:
            reached.set()
    sa.event.listen(pg_engine, 'before_cursor_execute', before)
    blocker = maker()
    blocker.execute(sa.select(CaptureStream).where(CaptureStream.id == uuid.UUID(first.result['stream_id'])).with_for_update())
    try:
        with ThreadPoolExecutor(1, thread_name_prefix='blocked-renew') as pool:
            pending = pool.submit(apply, maker, world.member(), renew(world, first))
            try:
                assert reached.wait(3), '첫 renew가 stream 잠금에 도달하지 못함'
                with ThreadPoolExecutor(1) as independent:
                    fast = independent.submit(apply, maker, world.member(1), renew(world, second))
                    try:
                        result = fast.result(timeout=1)
                        assert result.status == 'applied'
                    finally:
                        blocker.rollback()
                assert pending.result(timeout=3).status == 'applied'
            finally:
                blocker.rollback()
    finally:
        blocker.close()
        sa.event.remove(pg_engine, 'before_cursor_execute', before)


def test_동일_renew_ID_100회는_한번만_연장하고_원결과재생(maker, world):
    stream = start(maker, world)
    cmd = renew(world, stream)
    with ThreadPoolExecutor(20) as pool:
        results = list(pool.map(lambda _: apply(maker, world.member(), cmd), range(100)))
    assert sum(not r.duplicate for r in results) == 1
    assert {r.entity_version for r in results} == {2}
    assert {r.revision for r in results} == {stream.revision}
    with maker() as db:
        assert db.scalar(sa.select(sa.func.count()).select_from(LiveCommandLedger).where(LiveCommandLedger.command_id == cmd.command_id)) == 1
        assert db.scalar(sa.select(sa.func.count()).select_from(LiveOutbox).where(LiveOutbox.session_id == world.session_id)) == 1
        assert db.get(CaptureStream, uuid.UUID(stream.result['stream_id'])).entity_version == 2


def test_동일_ID_다른_stream_body_동시요청은_충돌(maker, world):
    stream = start(maker, world)
    original = renew(world, stream)
    altered = replace(original, payload={**original.payload, 'stream_id': str(uuid.uuid4())})
    barrier = threading.Barrier(2)
    def run(cmd):
        barrier.wait()
        return apply(maker, world.member(), cmd)
    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(run, (original, altered)))
    assert sum(r.code == 'idempotency_conflict' for r in results) == 1
    assert sum(not r.duplicate for r in results) == 1


def test_같은_stream_서로다른_renew의_entity_version은_단조(maker, world):
    stream = start(maker, world)
    with ThreadPoolExecutor(12) as pool:
        results = list(pool.map(lambda _: apply(maker, world.member(), renew(world, stream)), range(24)))
    assert sorted(r.entity_version for r in results) == list(range(2, 26))
    assert {r.revision for r in results} == {stream.revision}


@pytest.mark.parametrize('transition', ['close', 'end', 'revoke', 'epoch'])
def test_배타_경계가_먼저_commit되면_renew는_이전상태를_갱신하지_않음(maker, world, transition):
    from app.models.session import Session
    stream = start(maker, world)
    cmd = renew(world, stream, expected_epoch=1)
    locked = maker()
    epoch = lock_epoch(locked, world.session_id)
    ctx = slc.HandlerContext(db=locked, actor=world.host(), command=cmd,
                             session=locked.get(Session, world.session_id), epoch_row=epoch,
                             now=T0 + timedelta(seconds=5))
    if transition == 'close':
        row = locked.get(CaptureStream, uuid.UUID(stream.result['stream_id']))
        row.status = 'closed'; row.lease_expires_at = None
    elif transition == 'end':
        locked.get(Session, world.session_id).status = 'completed'
        slc.end_session_cutoff(ctx)
    elif transition == 'revoke':
        slc.revoke_participant_capture(ctx, world.members[0][1], code=slc.CUTOFF_EXPELLED)
    else:
        epoch.epoch += 1
    begun = threading.Event()
    def run():
        begun.set()
        return apply(maker, world.member(), cmd)
    try:
        with ThreadPoolExecutor(1) as pool:
            result = pool.submit(run)
            try:
                assert begun.wait(2)
                with pytest.raises(TimeoutError):
                    result.result(timeout=0.15)
            finally:
                locked.commit()
            assert result.result(timeout=3).code in {'stream_not_active', 'session_ended', 'epoch_mismatch'}
    finally:
        locked.close()


def test_cold_epoch없는_renew는_기존처럼_거절원장을_기록(maker, world):
    fake = type('Stream', (), {'result': {'stream_id': str(uuid.uuid4())}})()
    result = apply(maker, world.member(), renew(world, fake))
    assert result.code == 'stream_not_found' and result.committed
    with maker() as db:
        assert db.get(LiveSessionEpoch, world.session_id) is not None


def test_commit_false는_롤백가능하며_리스와원장이_남지않음(maker, world, pg_engine):
    stream = start(maker, world)
    cmd = renew(world, stream)
    with sql_statements(pg_engine) as statements, maker() as db:
        out = slc.apply_command(db, world.member(), cmd, commit=False, now=T0 + timedelta(seconds=10))
        assert out.status == 'applied'
        db.rollback()
    assert any('FROM sessions' in sql and 'FOR NO KEY UPDATE' in sql for sql in statements)
    with maker() as db:
        assert db.get(CaptureStream, uuid.UUID(stream.result['stream_id'])).entity_version == 1
        assert db.scalar(sa.select(LiveCommandLedger).where(LiveCommandLedger.command_id == cmd.command_id)) is None


def test_교체_handler의_outbox는_배타경로에서_revision증가(maker, world, pg_engine):
    stream = start(maker, world)
    def replacement(ctx):
        ctx.emit(domain='device', event_type='device.changed', entity_id=str(ctx.actor.participant_id),
                 entity_version=1, audience=['host'], payload={})
    slc.register_handler('capture.renew', replacement)
    with sql_statements(pg_engine) as statements:
        result = apply(maker, world.member(), renew(world, stream))
    assert any('FROM sessions' in sql and 'FOR NO KEY UPDATE' in sql for sql in statements)
    assert result.status == 'applied' and result.revision == stream.revision + 1


def test_cold_epoch_동시_생성은_교착없이_각_거절원장을_기록(maker, world):
    fake = type('Stream', (), {'result': {'stream_id': str(uuid.uuid4())}})()
    barrier = threading.Barrier(2)
    def run(i):
        barrier.wait()
        return apply(maker, world.member(i), renew(world, fake))
    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(run, range(2)))
    assert all(r.code == 'stream_not_found' and r.committed for r in results)


def test_renew가_먼저_잡은_공유잠금은_뒤따른_배타경계를_막음(maker, world, pg_engine):
    stream = start(maker, world)
    reached = threading.Event()
    def before(conn, cursor, statement, params, context, many):
        if threading.current_thread().name.startswith('shared-renew') and 'FROM capture_stream' in statement and 'FOR UPDATE' in statement:
            reached.set()
    sa.event.listen(pg_engine, 'before_cursor_execute', before)
    blocker = maker()
    blocker.execute(sa.select(CaptureStream).where(CaptureStream.id == uuid.UUID(stream.result['stream_id'])).with_for_update())
    def exclusive():
        with maker() as db:
            lock_epoch(db, world.session_id)
            db.rollback()
    try:
        with ThreadPoolExecutor(1, thread_name_prefix='shared-renew') as pool:
            pending = pool.submit(apply, maker, world.member(), renew(world, stream))
            try:
                assert reached.wait(3)
                with ThreadPoolExecutor(1) as other:
                    boundary = other.submit(exclusive)
                    try:
                        with pytest.raises(TimeoutError):
                            boundary.result(timeout=0.15)
                    finally:
                        blocker.rollback()
                    boundary.result(timeout=3)
                assert pending.result(timeout=3).status == 'applied'
            finally:
                blocker.rollback()
    finally:
        blocker.close()
        sa.event.remove(pg_engine, 'before_cursor_execute', before)


def test_만료된_active_lease는_기존처럼_갱신가능하며_닫힌_stream은_부활불가(maker, world):
    stream = start(maker, world)
    with maker() as db:
        out = slc.apply_command(db, world.member(), renew(world, stream), now=T0 + timedelta(seconds=60))
    assert out.status == 'applied'
    assert out.result['lease_expires_at_ms'] == int((T0 + timedelta(seconds=90)).timestamp() * 1000)
    close = slc.LiveCommand(uuid.uuid4(), world.session_id, 'capture.close', {
        'stream_id': stream.result['stream_id'], 'reason': 'user', 'final_sequences': {}})
    assert apply(maker, world.member(), close).status == 'applied'
    assert apply(maker, world.member(), renew(world, stream)).code == 'stream_not_active'


@pytest.mark.parametrize('conflict', ['generation', 'version', 'epoch'])
def test_renew의_fencing_version_epoch_거절은_리스불변(maker, world, conflict):
    stream = start(maker, world)
    cmd = renew(world, stream)
    if conflict == 'generation':
        cmd = replace(cmd, payload={**cmd.payload, 'owner_generation': '99'})
    elif conflict == 'version':
        cmd = replace(cmd, expected_entity_version=99)
    else:
        cmd = replace(cmd, expected_epoch=99)
    result = apply(maker, world.member(), cmd)
    assert result.code == {'generation': 'stale_owner_generation', 'version': 'entity_version_conflict', 'epoch': 'epoch_mismatch'}[conflict]
    with maker() as db:
        current = db.get(CaptureStream, uuid.UUID(stream.result['stream_id']))
        assert current.entity_version == 1
        assert current.lease_expires_at == T0 + timedelta(seconds=30)


def test_builtin_renew는_savepoint없이_session을_한번만_조회(maker, world, pg_engine):
    stream = start(maker, world)
    with sql_statements(pg_engine) as statements:
        out = apply(maker, world.member(), renew(world, stream))
    assert out.status == 'applied'
    assert not any(sql.lstrip().upper().startswith(('SAVEPOINT', 'RELEASE SAVEPOINT')) for sql in statements)
    assert sum('FROM sessions' in sql for sql in statements) == 1


def test_renew_flush후_예상밖_예외는_전체롤백하고_재시도가능(maker, world):
    stream = start(maker, world)
    cmd = renew(world, stream)
    flushed = []
    def crash(db, context):
        if any(isinstance(row, CaptureStream) for row in db.dirty):
            flushed.append(True)
            raise RuntimeError('합성 flush 후 오류')
    with maker() as db:
        sa.event.listen(db, 'after_flush', crash)
        try:
            with pytest.raises(RuntimeError, match='합성 flush 후 오류'):
                slc.apply_command(db, world.member(), cmd, now=T0 + timedelta(seconds=10))
        finally:
            sa.event.remove(db, 'after_flush', crash)
    assert flushed == [True]
    with maker() as db:
        current = db.get(CaptureStream, uuid.UUID(stream.result['stream_id']))
        assert current.entity_version == 1
        assert current.lease_expires_at == T0 + timedelta(seconds=30)
        assert db.scalar(sa.select(LiveCommandLedger).where(LiveCommandLedger.command_id == cmd.command_id)) is None
    result = apply(maker, world.member(), cmd)
    assert result.status == 'applied' and not result.duplicate and result.entity_version == 2
