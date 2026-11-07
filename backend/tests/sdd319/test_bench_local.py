"""SDD-319 — 로컬 전/후 비교 벤치(합류 on/off). 기본 실행에서는 건너뛰고 SDD319_BENCH=1 일 때만 돈다."""
from __future__ import annotations

import os
import statistics
import threading
import time

import pytest

from app.services import class_participation_service as cps
from app.services import live_single_flight as sf
from app.services import session_live_outbox as ob
from tests.sdd246.commands.conftest import World
from tests.sdd246.transport.conftest import make_cmd, _v2_runtime  # noqa: F401
from tests.sdd246.transport.conftest import (  # noqa: F401
    _isolate_handlers, db, live, maker, pg_engine, pg_url, prefix, redis_url,
)

pytestmark = pytest.mark.skipif(not os.environ.get("SDD319_BENCH"), reason="벤치 전용")


@pytest.fixture
def maker(pg_url):  # 벤치 전용: 스레드 수 대비 연결이 모자라 생기는 대기(벤치 인공물)를 제거
    import sqlalchemy as sa
    from sqlalchemy.orm import sessionmaker
    eng = sa.create_engine(pg_url, pool_size=int(os.environ.get("SDD319_POOL", "20")), max_overflow=int(os.environ.get("SDD319_POOL", "20")))
    yield sessionmaker(bind=eng, autoflush=False)
    eng.dispose()


@pytest.fixture
def world(maker):
    return World(maker, n_participants=int(os.environ.get('SDD319_N','40')))


def _scenario(maker, world, live, coalesce: bool):
    if not coalesce:  # 변경 전 동작: 합류 없이 곧바로 실행
        sf.run_coalesced = lambda key, fn: fn()  # type: ignore[assignment]
        sf.coalesced_drain = lambda key, do, need, wait_s=2.0: do()  # type: ignore[assignment]
    with maker() as s:
        cps.seed_live_state(s, world.session_id)
    sf.stats.update({k: 0 for k in sf.stats})
    lat, pend, drains = [], [], []
    real = ob.drain

    dur = []

    def counting(*a, **k):
        drains.append(1)
        t0 = time.monotonic()
        try:
            return real(*a, **k)
        finally:
            dur.append((time.monotonic() - t0) * 1000)

    ob.drain = counting
    stop = time.monotonic() + 8

    def publisher():  # metric 경로 모사: 건별 방송
        while time.monotonic() < stop:
            def _pub():  # publish_session_sync 와 동일: run_coalesced 로 감싼다
                with maker() as s:
                    return cps.publish_pending(s, live, world.session_id, lambda ev: None, wait_s=2.0)
            sf.run_coalesced(("publish", str(world.session_id)), _pub)
            time.sleep(0.005)

    def commander(i):
        while time.monotonic() < stop:
            t = time.monotonic()
            with maker() as s:
                o = cps.run_live_command(s, world.member(i), make_cmd(world, "hand.set", {"raised": True}))
            lat.append((time.monotonic() - t) * 1000)
            pend.append(o.ack.get("code") == "projection_pending")
            time.sleep(0.05)

    N = int(os.environ.get('SDD319_N', '40'))
    ts = [threading.Thread(target=publisher) for _ in range(int(N * .75))] + [threading.Thread(target=commander, args=(i,)) for i in range(N // 2)]
    [t.start() for t in ts]
    [t.join(60) for t in ts]
    ob.drain = real
    lat.sort()
    return {"commands": len(lat), "p50_ms": round(statistics.median(lat)), "p95_ms": round(lat[int(len(lat) * .95)]),
            "projection_pending": sum(pend), "drain_calls": len(drains), "sf": dict(sf.stats), "drain_ms_p50": round(statistics.median(dur)) if dur else 0, "drain_ms_max": round(max(dur)) if dur else 0}


@pytest.mark.parametrize("mode", ["before", "after"])
def test_bench(maker, world, live, mode):
    orig = (sf.run_coalesced, sf.coalesced_drain)
    try:
        r = _scenario(maker, world, live, mode == "after")
    finally:
        sf.run_coalesced, sf.coalesced_drain = orig
    print("BENCH", mode, r)
