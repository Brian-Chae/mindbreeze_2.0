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


# ── 3차: 100 동시 join/enter 재현(풀 20+20, 같은 클래스 행 FOR UPDATE 직렬화) ──
def test_entry_queue_100_concurrent_pool_exhaustion(pg_url, capsys):
    """운영 증상 재현: 인증 의존성이 연결을 잡은 채 같은 행 잠금을 기다리면 풀(20+20)이 고갈된다.
    대기줄 on/off 전후 비교. SDD319_BENCH=1 에서만 실행."""
    import asyncio

    import sqlalchemy as sa
    from fastapi import Depends, FastAPI
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy.orm import sessionmaker

    from app.services import entry_queue as eq
    from app.config import settings

    eng = sa.create_engine(pg_url, pool_size=20, max_overflow=20, pool_timeout=3)
    Maker = sessionmaker(bind=eng, autoflush=False)
    with Maker() as s:
        s.execute(sa.text("create table if not exists _eq_lock(id int primary key)"))
        s.execute(sa.text("insert into _eq_lock values (1) on conflict do nothing"))
        s.commit()

    def get_db():
        db = Maker()
        try:
            yield db
        finally:
            db.close()

    def get_user(db=Depends(get_db)):
        db.execute(sa.text("select 1"))  # get_current_user 의 사용자 조회: 이 시점부터 연결을 쥔다
        return {"id": "u"}

    def handler(db):
        db.execute(sa.text("select * from _eq_lock where id=1 for update"))
        time.sleep(0.15)  # 클래스 행 잠금 하 처리(멤버 N 잠금·갱신 모사)
        db.commit()

    def build(with_queue: bool):
        app = FastAPI()
        deps = [Depends(eq.join_slot)] if with_queue else []

        @app.post("/join/{cid}")
        def join(cid: str, user=Depends(get_user), db=Depends(get_db)):
            handler(db)
            return {"ok": True}

        if with_queue:  # 슬롯 의존성은 인자 맨 앞에 둔다(실제 엔드포인트와 동일)
            app2 = FastAPI()

            @app2.post("/join/{class_id}")
            async def join2(class_id: str, _s=Depends(eq.join_slot), user=Depends(get_user), db=Depends(get_db)):
                await asyncio.get_running_loop().run_in_executor(None, handler, db)
                return {"ok": True}

            return app2
        return app

    async def run(app):
        import anyio.to_thread
        anyio.to_thread.current_default_thread_limiter().total_tokens = 64  # 운영 anyio_thread_tokens(64) > 풀(40)
        lat, codes = [], []
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t", timeout=120) as c:
            async def one():
                t0 = time.monotonic()
                try:
                    r = await c.post("/join/c1")
                    codes.append(r.status_code)
                except Exception as exc:  # noqa: BLE001
                    codes.append(type(exc).__name__)
                lat.append(time.monotonic() - t0)
            await asyncio.gather(*[one() for _ in range(100)])
        lat.sort()
        return codes, lat[int(len(lat) * 0.95) - 1], lat[-1]

    settings.entry_queue_concurrency = 5
    settings.entry_queue_wait_sec = 45.0
    out = {}
    for name, q in (("전(대기줄 없음)", False), ("후(대기줄 5)", True)):
        codes, p95, mx = asyncio.run(run(build(q)))
        ok = sum(1 for c in codes if c == 200)
        out[name] = f"성공 {ok}/100, 비200={sorted({str(c) for c in codes if c != 200})}, p95={p95:.1f}s, max={mx:.1f}s"
    with eng.connect() as c:
        c.execute(sa.text("drop table _eq_lock")); c.commit()
    eng.dispose()
    with capsys.disabled():
        for k, v in out.items():
            print(f"\n[벤치 100 동시 join] {k}: {v}")
