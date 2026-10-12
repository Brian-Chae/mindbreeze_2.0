"""OTP 서비스 — 6자리 숫자 OTP 발급/검증, Redis 기반"""

import secrets

from fastapi import HTTPException, status
from redis.asyncio import Redis

OTP_TTL_SECONDS = 600
OTP_COOLDOWN_SECONDS = 60
# SEC-06: 6자리 OTP(경우의 수 100만)를 TTL(10분) 동안 무제한 시도하면
#   현실적인 시간 안에 전수 대입이 가능하다. 이메일별 실패 횟수를 제한한다.
OTP_MAX_ATTEMPTS = 5


def _otp_key(email: str) -> str:
    return f"otp:{email.lower()}"


def _cooldown_key(email: str) -> str:
    return f"otp_cooldown:{email.lower()}"


def _attempt_key(email: str) -> str:
    # SEC-06: 이메일별 OTP 검증 실패 카운터
    return f"otp_attempt:{email.lower()}"


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
    # SEC-06: 새 OTP 발급 시 실패 카운터를 초기화해 이전 잠금을 해제한다.
    await redis.delete(_attempt_key(email))
    return code


async def verify_otp(email: str, code: str, redis: Redis) -> bool:
    """OTP 검증 — 일치 시 즉시 삭제(1회용).

    SEC-06: 불일치가 임계(5회)를 넘으면 OTP 를 폐기해 TTL 동안의 무차별 대입을 막는다.
    """
    stored = await redis.get(_otp_key(email))
    if stored is None:
        # OTP 없음(미발급/만료/잠금) → 실패
        return False

    if stored != code:
        attempts = await redis.incr(_attempt_key(email))
        # 첫 실패 시 OTP 수명과 동일한 TTL 을 걸어 카운터가 무한정 남지 않게 한다.
        if attempts == 1:
            await redis.expire(_attempt_key(email), OTP_TTL_SECONDS)
        if attempts >= OTP_MAX_ATTEMPTS:
            # 임계 초과 → OTP 폐기·잠금 (새 OTP 발급 전까지 검증 불가)
            await redis.delete(_otp_key(email))
            await redis.delete(_attempt_key(email))
        return False

    await redis.delete(_otp_key(email))
    await redis.delete(_attempt_key(email))
    return True
