"""SDD-260 S5 — 저장을 막는 자원(DB 풀·스레드풀·archive 슬롯) 설정 · V-S14 일부."""
from __future__ import annotations

import asyncio

import pytest
from fastapi import HTTPException

from app.config import Settings


def test_S5_기본값_DB풀_20_20_archive_슬롯_16_대기_0_5초():
    f = Settings.model_fields
    assert f["db_pool_size"].default == 20 and f["db_max_overflow"].default == 20
    assert f["archive_max_concurrent"].default == 16 and f["archive_slot_wait_sec"].default == 0.5


def test_S5_슬롯_초과_429_Retry_After는_2에서_6_사이_정수(monkeypatch):
    from app.api import deps

    monkeypatch.setattr(deps.settings, "archive_slot_wait_sec", 0.0)
    held = [deps._archive_slots.acquire(blocking=False) for _ in range(deps.settings.archive_max_concurrent)]
    try:
        seen = set()
        for _ in range(60):
            gen = deps.archive_upload_slot()
            with pytest.raises(HTTPException) as e:
                next(gen)
            assert e.value.status_code == 429 and e.value.detail == {"code": "archive_busy"}
            seen.add(int(e.value.headers["Retry-After"]))
        assert seen <= {2, 3, 4, 5, 6} and len(seen) >= 2
    finally:
        for ok in held:
            if ok:
                deps._archive_slots.release()


def test_S5_lifespan이_기본_executor_32와_anyio_토큰_64를_설정한다(monkeypatch):
    import anyio.to_thread
    from app import main

    async def run():
        async with main.lifespan(main.app):
            loop = asyncio.get_running_loop()
            ex = loop._default_executor
            assert ex is not None and ex._max_workers == 32
            assert anyio.to_thread.current_default_thread_limiter().total_tokens == 64

    monkeypatch.setattr(main.settings, "jwt_secret_key", "sdd260-test-secret-0123456789abcdef")
    monkeypatch.setattr(main, "production_config_problems", lambda _s: [])
    monkeypatch.setattr(main, "_outbox_ws_poll_loop", lambda: asyncio.sleep(0))
    asyncio.run(run())
