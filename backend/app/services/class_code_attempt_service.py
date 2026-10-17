"""클래스 코드 입장 시도 제한 (SDD-209 B4 / BE-4 · P10).

4자리 코드는 10,000 공간이라 무차별 대입에 약하다. 노출 위험을 "시도 제한 + 종료 즉시 무효화"로
수용하므로 세 단위로 제한한다(Redis, 비동기 — login_attempt_service 와 같은 방식).

1. IP 단위: 실패(틀린/없는/종료 코드)가 ``IP_MAX_FAILURES`` 회 이상이면 ``LOCK_SECONDS`` 동안 해당
   IP 의 **올바른 코드도 거부**한다. 성공하면 카운터를 비운다.
2. 코드 단위: 같은 코드 값에 대한 요청이 분당 ``CODE_MAX_PER_MINUTE`` 회를 넘으면 거부한다
   (성공 포함 — 확인된 코드로의 반복 입장 시도 억제). 키는 코드 해시라 Redis 에도 원문이 없다.
3. 전체 유입: 모든 IP 합산 실패가 ``GLOBAL_MAX_FAILURES`` / ``GLOBAL_WINDOW_SECONDS`` 를 넘으면
   분산 대입 공격으로 보고 전체 시도를 일시 거부한다.

거부 응답은 모두 같은 429 이며 어느 단위인지 노출하지 않는다. 코드 원문은 로그·키에 남기지 않는다.
"""

from __future__ import annotations

import hashlib

from fastapi import HTTPException, status
from redis.asyncio import Redis

IP_MAX_FAILURES = 10
IP_WINDOW_SECONDS = 10 * 60
LOCK_SECONDS = 15 * 60
CODE_MAX_PER_MINUTE = 120
GLOBAL_MAX_FAILURES = 300
GLOBAL_WINDOW_SECONDS = 5 * 60
GLOBAL_LOCK_SECONDS = 60

THROTTLE_DETAIL = "시도가 너무 많아요. 잠시 후 다시 입력해 주세요."


def _scope(ip: str | None) -> str:
    return (ip or "unknown").lower()


def _ip_fail_key(ip: str | None) -> str:
    return f"clscode:fail:{_scope(ip)}"


def _ip_lock_key(ip: str | None) -> str:
    return f"clscode:lock:{_scope(ip)}"


def _code_key(code: str) -> str:
    digest = hashlib.sha256(code.encode()).hexdigest()[:16]
    return f"clscode:code:{digest}"


_GLOBAL_FAIL_KEY = "clscode:global:fail"
_GLOBAL_LOCK_KEY = "clscode:global:lock"


def _throttled() -> HTTPException:
    return HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=THROTTLE_DETAIL)


async def check_allowed(redis: Redis, ip: str | None) -> None:
    """코드 확인 전에 호출 — IP 잠금 또는 전체 잠금이면 429."""
    if await redis.get(_ip_lock_key(ip)) or await redis.get(_GLOBAL_LOCK_KEY):
        raise _throttled()


async def note_code_request(redis: Redis, code: str | None) -> None:
    """같은 코드 값 반복 요청 제한 — 형식이 올바른 코드에만 적용한다."""
    if not code:
        return
    key = _code_key(code)
    count = await redis.incr(key)
    if count == 1:
        await redis.expire(key, 60)
    if count > CODE_MAX_PER_MINUTE:
        raise _throttled()


async def record_failure(redis: Redis, ip: str | None) -> None:
    """코드 확인 실패(없는/틀린/종료)를 IP·전체 단위로 센다."""
    key = _ip_fail_key(ip)
    count = await redis.incr(key)
    if count == 1:
        await redis.expire(key, IP_WINDOW_SECONDS)
    if count >= IP_MAX_FAILURES:
        await redis.setex(_ip_lock_key(ip), LOCK_SECONDS, "1")

    global_count = await redis.incr(_GLOBAL_FAIL_KEY)
    if global_count == 1:
        await redis.expire(_GLOBAL_FAIL_KEY, GLOBAL_WINDOW_SECONDS)
    if global_count >= GLOBAL_MAX_FAILURES:
        await redis.setex(_GLOBAL_LOCK_KEY, GLOBAL_LOCK_SECONDS, "1")


async def record_success(redis: Redis, ip: str | None) -> None:
    """성공 시 해당 IP 의 실패 카운터를 비운다(잠금 중에는 도달하지 않는다)."""
    await redis.delete(_ip_fail_key(ip))
