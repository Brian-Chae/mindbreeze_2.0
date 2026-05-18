"""로그인 잠금 서비스 — 5회 실패 시 15분 잠금"""

from fastapi import HTTPException, status
from redis.asyncio import Redis

MAX_ATTEMPTS = 5
WINDOW_SECONDS = 15 * 60  # 15분


def _attempt_key(email: str) -> str:
    return f"attempt:{email.lower()}"


def _lock_key(email: str) -> str:
    return f"lock:{email.lower()}"


async def check_login_lock(email: str, redis: Redis) -> None:
    """잠금 상태이면 423 예외"""
    if await redis.get(_lock_key(email)):
        raise HTTPException(
            status_code=status.HTTP_423_LOCKED,
            detail="계정이 잠겼습니다. 15분 후 다시 시도해주세요",
        )


async def record_failed_attempt(email: str, redis: Redis) -> None:
    """실패 카운트 INCR. 5회 초과 시 잠금."""
    key = _attempt_key(email)
    count = await redis.incr(key)
    if count == 1:
        await redis.expire(key, WINDOW_SECONDS)
    if count >= MAX_ATTEMPTS:
        await redis.setex(_lock_key(email), WINDOW_SECONDS, "1")


async def reset_attempts(email: str, redis: Redis) -> None:
    """로그인 성공 시 카운터·잠금 삭제"""
    await redis.delete(_attempt_key(email), _lock_key(email))
