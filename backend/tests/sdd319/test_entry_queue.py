"""SDD-319 3차 — 동시 입장 대기줄 단위 시험(Q1~Q5)."""
from __future__ import annotations

import asyncio

import pytest
from fastapi import Depends, FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient

from app.services import entry_queue as eq


@pytest.fixture(autouse=True)
def _clean():
    eq._gates.clear()
    eq._waiting = 0
    yield
    assert eq._gates == {}, "슬롯/카운터 누수"


async def _run(n, limit, hold, key="k", wait=5.0, kind="join"):
    cur = peak = 0
    order = []

    async def one(i):
        nonlocal cur, peak
        gate = await eq.acquire_slot(kind, key, limit=limit, wait_sec=wait)
        try:
            order.append(i)
            cur += 1
            peak = max(peak, cur)
            await asyncio.sleep(hold)
            cur -= 1
        finally:
            eq.release_slot(kind, key, gate)

    tasks = []
    for i in range(n):
        tasks.append(asyncio.create_task(one(i)))
        await asyncio.sleep(0)
    res = await asyncio.gather(*tasks, return_exceptions=True)
    return peak, order, res


@pytest.mark.asyncio
async def test_Q1_동시_실행은_상한_이하이고_전부_처리_FIFO():
    peak, order, res = await _run(30, 5, 0.02)
    assert peak <= 5
    assert not [r for r in res if isinstance(r, Exception)]
    assert order == list(range(30))


@pytest.mark.asyncio
async def test_Q2_다른_키는_서로_막지_않는다():
    async def hold_a():
        g = await eq.acquire_slot("join", "A", limit=1, wait_sec=1)
        await asyncio.sleep(0.3)
        eq.release_slot("join", "A", g)

    t = asyncio.create_task(hold_a())
    await asyncio.sleep(0.01)
    loop = asyncio.get_running_loop()
    t0 = loop.time()
    g = await eq.acquire_slot("join", "B", limit=1, wait_sec=1)
    assert loop.time() - t0 < 0.1
    eq.release_slot("join", "B", g)
    await t


@pytest.mark.asyncio
async def test_Q3_대기_시한_초과는_503_entry_busy_Retry_After_누수없음():
    g = await eq.acquire_slot("enter", "S", limit=1, wait_sec=1)
    with pytest.raises(HTTPException) as ei:
        await eq.acquire_slot("enter", "S", limit=1, wait_sec=0.05)
    assert ei.value.status_code == 503
    assert ei.value.detail == {"code": "entry_busy", "retryable": True}
    assert 2 <= int(ei.value.headers["Retry-After"]) <= 6
    eq.release_slot("enter", "S", g)


@pytest.mark.asyncio
async def test_Q5_취소에서도_슬롯_반환_상한0은_비활성():
    g = await eq.acquire_slot("join", "C", limit=1, wait_sec=1)
    waiter = asyncio.create_task(eq.acquire_slot("join", "C", limit=1, wait_sec=5))
    await asyncio.sleep(0.02)
    waiter.cancel()
    with pytest.raises(asyncio.CancelledError):
        await waiter
    eq.release_slot("join", "C", g)
    assert await eq.acquire_slot("join", "C", limit=0) is None
    eq.release_slot("join", "C", None)


@pytest.mark.asyncio
async def test_Q4_대기_중에는_DB_연결을_잡지_않는다(monkeypatch):
    """슬롯 의존성이 get_db 보다 먼저 평가되면, 상한 이내 요청만 연결을 연다."""
    monkeypatch.setattr(eq.settings, "entry_queue_concurrency", 3)
    monkeypatch.setattr(eq.settings, "entry_queue_wait_sec", 10.0)
    opened = peak = 0

    def get_db():
        nonlocal opened, peak
        opened += 1
        peak = max(peak, opened)
        try:
            yield object()
        finally:
            opened -= 1

    def get_user(db=Depends(get_db)):  # 실제 get_current_user 처럼 get_db 에 의존
        return {"id": "u"}

    app = FastAPI()

    @app.post("/x/{class_id}")
    async def ep(class_id: str, _s: None = Depends(eq.join_slot), user=Depends(get_user)):
        await asyncio.sleep(0.05)
        return {"ok": True}

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        rs = await asyncio.gather(*[c.post("/x/c1") for _ in range(30)])
    assert all(r.status_code == 200 for r in rs)
    assert peak <= 3, f"대기 중 연결 점유: peak={peak}"


def test_Q6_실제_라우트에_대기줄이_get_db보다_먼저_걸려있다():
    """join/enter 라우트의 dependencies 에 슬롯이 있고, 데코레이터 의존성은 엔드포인트 인자(get_current_user/get_db)보다 먼저 해석된다."""
    from app.main import app

    found = {}
    for r in app.routes:
        path = getattr(r, "path", "")
        if path.endswith("/classes/{class_id}/join") and "POST" in r.methods:
            found["join"] = r
        if path.endswith("/sessions/{session_id}/enter") and "POST" in r.methods:
            found["enter"] = r
    assert set(found) == {"join", "enter"}
    for kind, fn in (("join", eq.join_slot), ("enter", eq.enter_slot)):
        calls = [d.call for d in found[kind].dependant.dependencies]
        assert calls[0] is fn or fn in calls[:2], (kind, calls[:3])
        from app.core.database import get_db
        flat = [d.call for d in found[kind].dependant.dependencies]
        assert flat.index(fn) < flat.index(__import__("app.api.deps", fromlist=["x"]).get_current_user)
