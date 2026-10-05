"""로그인 잠금 서비스 — 5회 실패 시 15분 잠금

AUTHZ-04: 잠금 키를 이메일 단독이 아니라 이메일+IP 복합으로 구성한다.
공격자가 피해자 이메일로 실패를 유발해도(계정 잠금 DoS) 특정 IP 에만 잠금이 걸리고,
피해자 본인 IP 의 로그인은 막히지 않는다. 기존 5회/15분 잠금 동작은 그대로 유지한다.
"""

from fastapi import HTTPException, status
from redis.asyncio import Redis

MAX_ATTEMPTS = 5
WINDOW_SECONDS = 15 * 60  # 15분


def _client_scope(ip: str | None) -> str:
    """IP 미상(None)이면 공통 버킷으로 묶어 잠금 우회를 막는다."""
    return (ip or "unknown").lower()


def _attempt_key(email: str, ip: str | None = None) -> str:
    return f"attempt:{_client_scope(ip)}:{email.lower()}"


def _lock_key(email: str, ip: str | None = None) -> str:
    return f"lock:{_client_scope(ip)}:{email.lower()}"


async def check_login_lock(email: str, redis: Redis, ip: str | None = None) -> None:
    """잠금 상태이면 423 예외"""
    if await redis.get(_lock_key(email, ip)):
        raise HTTPException(
            status_code=status.HTTP_423_LOCKED,
            detail="계정이 잠겼습니다. 15분 후 다시 시도해주세요",
        )


async def record_failed_attempt(email: str, redis: Redis, ip: str | None = None) -> None:
    """실패 카운트 INCR. 5회 초과 시 잠금."""
    key = _attempt_key(email, ip)
    count = await redis.incr(key)
    if count == 1:
        await redis.expire(key, WINDOW_SECONDS)
    if count >= MAX_ATTEMPTS:
        await redis.setex(_lock_key(email, ip), WINDOW_SECONDS, "1")


async def reset_attempts(email: str, redis: Redis, ip: str | None = None) -> None:
    """로그인 성공 시 카운터·잠금 삭제"""
    await redis.delete(_attempt_key(email, ip), _lock_key(email, ip))
