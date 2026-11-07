"""SDD-319 round-1: renew 멱등·리스 정본·projection 독립성을 실제 로컬 PG/Redis로 검증한다.

시험용 DB와 Redis namespace는 보존한다. PG/Redis 연결 불가 환경에서는 skip한다.
"""
from __future__ import annotations

import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import pytest
import sqlalchemy as sa

from app.models.live_state import LiveCommandLedger, LiveOutbox, LiveSessionEpoch
from app.services import class_participation_service as cps
from app.services import session_live_commands as slc
from tests.sdd246.commands.conftest import _isolate_handlers, maker, pg_engine, world  # noqa: F401
from tests.sdd246.commands.test_capture_cutoff_pg import T0, _c, _start, _stream
from tests.sdd246.state.conftest import prefix, redis_url  # noqa: F401
from tests.sdd308.test_s5_measurement import preserved_live, preserved_pg_url


@pytest.fixture(scope='session')
def pg_url():
    yield from preserved_pg_url()


@pytest.fixture
def live(redis_url, prefix):
    yield from preserved_live(redis_url, prefix)


def _revision_and_outbox(maker, session_id):
    with maker() as db:
        epoch = db.get(LiveSessionEpoch, session_id)
        count = db.scalar(sa.select(sa.func.count()).select_from(LiveOutbox).where(
            LiveOutbox.session_id == session_id))
        return int(epoch.revision), int(count)


def test_같은_renew_12동시_요청은_리스와_entity_version을_한번만_변경(maker, world):
    started = _start(maker, world)
    stream_id = started.result['stream_id']
    before = _stream(maker, stream_id)
    before_revision = _revision_and_outbox(maker, world.session_id)
    cmd = _c(world, 'capture.renew', {
        'stream_id': stream_id, 'owner_generation': '1', 'clock_anchor_id': str(uuid.uuid4())})
    gate = threading.Barrier(12)
    renewed_at = T0 + timedelta(seconds=25)

    def run(_):
        gate.wait(timeout=10)
        with maker() as db:
            return slc.apply_command(db, world.member(), cmd, now=renewed_at)

    with ThreadPoolExecutor(max_workers=12) as pool:
        results = list(pool.map(run, range(12)))
    assert all(r.status == 'applied' and r.committed for r in results)
    assert sum(not r.duplicate for r in results) == 1
    assert sum(r.duplicate for r in results) == 11
    assert all(r.result == results[0].result for r in results)
    after = _stream(maker, stream_id)
    assert int(after.entity_version) == int(before.entity_version) + 1
    assert after.lease_expires_at == renewed_at + timedelta(seconds=slc.CAPTURE_LEASE_SECONDS)
    assert after.offline_bound_until == renewed_at + timedelta(seconds=slc.CAPTURE_OFFLINE_BOUND_SECONDS)
    assert after.clock_anchor_id == uuid.UUID(cmd.payload['clock_anchor_id'])
    assert _revision_and_outbox(maker, world.session_id) == before_revision
    with maker() as db:
        assert db.scalar(sa.select(sa.func.count()).select_from(LiveCommandLedger).where(
            LiveCommandLedger.session_id == world.session_id,
            LiveCommandLedger.command_id == cmd.command_id)) == 1


def test_실제_projector_락이_busy여도_renew는_DB_리스_ACK를_반환(maker, world, live, monkeypatch):
    monkeypatch.setattr(slc, '_utcnow', lambda: T0)
    with maker() as db:
        started = cps.run_live_command(db, world.member(), _c(world, 'capture.start', {
            'device_profile': 'linkband2-v1', 'algorithm_version': 'web-ts-1', 'model_version': 'b0'}), live=live)
    assert started.ack['status'] == 'applied'
    stream_id = started.ack['result']['stream_id']
    before = _revision_and_outbox(maker, world.session_id)
    before_stream = _stream(maker, stream_id)
    fence = live.acquire_projector(world.session_id, ttl_ms=5000)
    assert fence is not None
    # 별도 발행자 락은 TTL로 끝난다. 시험이 직접 키/데이터를 삭제하지 않는다.
    renewed_at = T0 + timedelta(seconds=25)
    monkeypatch.setattr(slc, '_utcnow', lambda: renewed_at)
    cmd = _c(world, 'capture.renew', {
        'stream_id': stream_id, 'owner_generation': '1', 'clock_anchor_id': str(uuid.uuid4())})
    with maker() as db:
        outcome = cps.run_live_command(db, world.member(), cmd, live=live, drain_wait_s=0.02)
    assert outcome.ack['status'] == 'applied'
    assert outcome.committed and not outcome.degraded
    expires_at = renewed_at + timedelta(seconds=slc.CAPTURE_LEASE_SECONDS)
    assert outcome.ack['result']['lease']['expires_at_ms'] == int(expires_at.timestamp() * 1000)
    after = _stream(maker, stream_id)
    assert after.lease_expires_at == expires_at
    assert int(after.entity_version) == int(before_stream.entity_version) + 1
    assert _revision_and_outbox(maker, world.session_id) == before
    assert live.read_meta(world.session_id)['applied_revision'] == str(before[0])
    with maker() as db:
        duplicate = cps.run_live_command(db, world.member(), cmd, live=live, drain_wait_s=0.02)
    assert duplicate.ack['status'] == 'duplicate'
    assert duplicate.ack['result']['lease'] == outcome.ack['result']['lease']
    assert int(_stream(maker, stream_id).entity_version) == int(after.entity_version)
