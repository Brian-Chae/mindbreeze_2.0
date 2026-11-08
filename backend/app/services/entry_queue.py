"""SDD-319 3차 — 동시 입장 대기줄(키별 동시 처리 상한).

100명이 클래스 시작과 동시에 join/enter 를 쏘면 같은 클래스·회차 행 잠금을 기다리는 요청이 DB 연결(풀 20+20)을
전부 쥐고 있다가 QueuePool timeout 으로 500 이 났다. 이 대기줄은 **DB 연결을 잡기 전**(get_current_user/get_db 보다
먼저 평가되는 의존성)에서 키(클래스/회차)별 동시 처리 수를 제한한다. 대기 중에는 연결 0개, 이벤트루프 대기만 쓴다.

- 프로세스 로컬 asyncio 세마포어: join/enter 는 nginx 허용목록 밖이라 소켓 단일 프로세스(8000)로만 간다
  (deploy/templates/nginx/mindbreeze.conf.tpl 의 `mb_socket` default). REST 분산 인스턴스로 가도 인스턴스별 상한이라
  연결 사용은 (상한 x 프로세스 수)로 여전히 제한된다.
- 대기 시한 초과 시 503 `entry_busy` + Retry-After(재시도 가능 오류, SDD-308 `lock_busy` 와 같은 계열).
"""
from __future__ import annotations

import asyncio
import logging
import random
from collections.abc import AsyncIterator

from fastapi import HTTPException, status

from app.config import settings

logger = logging.getLogger(__name__)


class _Gate:
    __slots__ = ("sem", "users")

    def __init__(self, limit: int) -> None:
        self.sem = asyncio.Semaphore(limit)
        self.users = 0  # 실행 중 + 대기 중 수. 0 이 되면 키를 지운다.


_gates: dict[tuple[str, str], _Gate] = {}
stats = {"admitted": 0, "queued": 0, "timeouts": 0, "peak_waiting": 0}
_waiting = 0


async def acquire_slot(kind: str, key: str, *, limit: int | None = None, wait_sec: float | None = None) -> _Gate | None:
    """슬롯을 얻고 게이트를 돌려준다(release_slot 로 반납). 상한 0 이하면 비활성(None)."""
    global _waiting
    limit = settings.entry_queue_concurrency if limit is None else limit
    if limit <= 0:
        return None
    wait_sec = settings.entry_queue_wait_sec if wait_sec is None else wait_sec
    gk = (kind, key)
    gate = _gates.get(gk)
    if gate is None:
        gate = _gates[gk] = _Gate(limit)
    gate.users += 1
    queued = gate.sem.locked()
    if queued:
        stats["queued"] += 1
        _waiting += 1
        stats["peak_waiting"] = max(stats["peak_waiting"], _waiting)
    try:
        await asyncio.wait_for(gate.sem.acquire(), timeout=wait_sec)
    except asyncio.TimeoutError:
        stats["timeouts"] += 1
        _drop(gk, gate)
        logger.warning("[entry_queue] %s 대기 시한 초과 key=%s wait=%.0fs", kind, key[:8], wait_sec)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "entry_busy", "retryable": True},
            headers={"Retry-After": str(random.randint(2, 6))},
        )
    except BaseException:  # 취소(클라이언트 끊김) — 카운터 정리 후 전파
        _drop(gk, gate)
        raise
    finally:
        if queued:
            _waiting -= 1
    stats["admitted"] += 1
    return gate


def _drop(gk: tuple[str, str], gate: _Gate) -> None:
    gate.users -= 1
    if gate.users <= 0 and _gates.get(gk) is gate:
        del _gates[gk]


def release_slot(kind: str, key: str, gate: _Gate | None) -> None:
    if gate is None:
        return
    gate.sem.release()
    _drop((kind, key), gate)


async def _slot(kind: str, key: str) -> AsyncIterator[None]:
    gate = await acquire_slot(kind, key)
    try:
        yield
    finally:
        release_slot(kind, key, gate)


async def join_slot(class_id: str) -> AsyncIterator[None]:
    """POST /classes/{class_id}/join — 클래스 단위. get_db 보다 먼저 평가돼야 한다(엔드포인트 인자 맨 앞)."""
    async for _ in _slot("join", str(class_id)):
        yield


async def enter_slot(session_id: str) -> AsyncIterator[None]:
    """POST /sessions/{session_id}/enter — 회차 단위. get_db 보다 먼저 평가돼야 한다."""
    async for _ in _slot("enter", str(session_id)):
        yield
