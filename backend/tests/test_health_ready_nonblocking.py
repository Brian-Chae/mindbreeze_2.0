"""/health/ready 의 DB 점검이 이벤트 루프를 막지 않는지 검증.

운영 11/10: 풀 고갈 시 동기 DB 점검이 루프 스레드에서 pool_timeout(30s) 동안 대기 →
실시간 서버(Socket.IO) 전체가 30초 멈추고 전원 끊김. 점검은 스레드에서 돌고 5초 상한이어야 한다.
"""
import asyncio
import time
from unittest.mock import patch

import pytest

import app.main as main_mod


class _SlowSession:
    def __enter__(self):
        time.sleep(1.5)  # 풀 대기 흉내(동기 블로킹)
        return self

    def __exit__(self, *a):
        return False

    def execute(self, *a, **k):
        return None


class _FakeRedis:
    async def ping(self):
        return True


@pytest.mark.asyncio
async def test_health_ready_does_not_block_event_loop():
    ticks = 0

    async def ticker():
        nonlocal ticks
        while True:
            await asyncio.sleep(0.05)
            ticks += 1

    with patch("app.core.database.SessionLocal", _SlowSession), patch(
        "app.core.redis.get_redis", lambda: _FakeRedis()
    ):
        t = asyncio.create_task(ticker())
        resp = await main_mod.health_ready()
        t.cancel()
    assert resp.status_code == 200
    # 루프가 막혔다면 1.5초 동안 tick 이 거의 0
    assert ticks >= 10, ticks


@pytest.mark.asyncio
async def test_health_ready_db_timeout_returns_503_fast():
    class _Hang(_SlowSession):
        def __enter__(self):
            time.sleep(7)
            return self

    with patch("app.core.database.SessionLocal", _Hang), patch(
        "app.core.redis.get_redis", lambda: _FakeRedis()
    ):
        t0 = time.monotonic()
        resp = await main_mod.health_ready()
        took = time.monotonic() - t0
    assert resp.status_code == 503
    assert took < 6, took
