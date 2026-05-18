"""OTP 서비스 — 6자리 숫자 OTP 발급/검증, Redis 기반"""

import secrets

from fastapi import HTTPException, status
from redis.asyncio import Redis

OTP_TTL_SECONDS = 600
OTP_COOLDOWN_SECONDS = 60


def _otp_key(email: str) -> str:
    return f"otp:{email.lower()}"


def _cooldown_key(email: str) -> str:
    return f"otp_cooldown:{email.lower()}"


async def generate_otp(email: str, redis: Redis) -> str:
    """OTP 생성 → Redis 저장. 60초 쿨다운 중이면 429."""
    if await redis.get(_cooldown_key(email)):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="잠시 후 다시 시도해주세요 (60초 쿨다운)",
        )

    code = f"{secrets.randbelow(1_000_000):06d}"
    await redis.setex(_otp_key(email), OTP_TTL_SECONDS, code)
    await redis.setex(_cooldown_key(email), OTP_COOLDOWN_SECONDS, "1")
    return code


async def verify_otp(email: str, code: str, redis: Redis) -> bool:
    """OTP 검증 — 일치 시 즉시 삭제(1회용)."""
    stored = await redis.get(_otp_key(email))
    if stored is None or stored != code:
        return False
    await redis.delete(_otp_key(email))
    return True
