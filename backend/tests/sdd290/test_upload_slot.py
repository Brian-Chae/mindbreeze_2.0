"""SDD-290 — archive 업로드 슬롯 32 / 대기 1.0s: 포화 429·대기·해제·자원 정합 시험."""
from __future__ import annotations

import threading
import time

import pytest
from fastapi import HTTPException

from app.api import deps
from app.config import Settings


def _hold_all():
    return [deps._archive_slots.acquire(blocking=False) for _ in range(deps.settings.archive_max_concurrent)]


def _release(held):
    for ok in held:
        if ok:
            deps._archive_slots.release()


def test_V1_기본값은_슬롯_32_대기_1_0초():
    f = Settings.model_fields
    assert f["archive_max_concurrent"].default == 32
    assert f["archive_slot_wait_sec"].default == 1.0
    assert deps.settings.archive_max_concurrent == 32  # 세마포어가 변경된 값으로 만들어졌다


def test_V2_32개까지_통과하고_33번째는_429_archive_busy(monkeypatch):
    monkeypatch.setattr(deps.settings, "archive_slot_wait_sec", 0.0)
    gens = [deps.archive_upload_slot() for _ in range(32)]
    try:
        for g in gens:
            next(g)  # 32개 모두 슬롯 획득
        extra = deps.archive_upload_slot()
        with pytest.raises(HTTPException) as e:
            next(extra)
        assert e.value.status_code == 429 and e.value.detail == {"code": "archive_busy"}
        assert 2 <= int(e.value.headers["Retry-After"]) <= 6
    finally:
        for g in gens:
            g.close()
    # 모두 반환되면 다시 32개를 잡을 수 있다(누수 없음)
    held = _hold_all()
    try:
        assert all(held)
    finally:
        _release(held)


def test_V3_대기시간_안에_슬롯이_풀리면_429_없이_통과한다(monkeypatch):
    monkeypatch.setattr(deps.settings, "archive_slot_wait_sec", 1.0)
    held = _hold_all()
    threading.Timer(0.3, lambda: deps._archive_slots.release()).start()
    held.pop()  # 위 Timer 가 하나를 해제한다
    try:
        g = deps.archive_upload_slot()
        t0 = time.monotonic()
        next(g)
        assert 0.2 <= time.monotonic() - t0 < 1.0
        g.close()
    finally:
        _release(held)


def test_V4_대기시간을_넘기면_429(monkeypatch):
    monkeypatch.setattr(deps.settings, "archive_slot_wait_sec", 0.3)
    held = _hold_all()
    try:
        g = deps.archive_upload_slot()
        t0 = time.monotonic()
        with pytest.raises(HTTPException) as e:
            next(g)
        assert e.value.status_code == 429
        assert 0.25 <= time.monotonic() - t0 < 1.0
    finally:
        _release(held)


def test_V5_자원_정합_슬롯과_대기_스레드가_anyio_안_슬롯이_DB풀_안():
    s = Settings()
    pool_total = s.db_pool_size + s.db_max_overflow
    # 슬롯을 쥔 요청 + 슬롯을 기다리는 요청(둘 다 anyio 스레드 1개씩) 최악이 토큰 이내
    assert 2 * s.archive_max_concurrent <= s.anyio_thread_tokens
    # 슬롯을 모두 DB 연결로 쓰는 최악도 풀 한도 이내(실제로는 ack 가 S3 검증 중 연결을 반납)
    assert s.archive_max_concurrent < pool_total
    assert s.archive_slot_wait_sec <= 2.0  # 대기가 길수록 스레드를 오래 점유
