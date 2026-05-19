"""이메일 검증 토큰 — JWT 기반 단기(15분) 토큰"""

from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from jose import JWTError, jwt

from app.config import settings

EMAIL_VERIFY_TTL_MINUTES = 15
TOKEN_TYPE = "email_verify"


def generate_email_verify_token(email: str) -> str:
    """이메일 검증 통과 → 15분 유효 JWT 발급"""
    expire = datetime.now(timezone.utc) + timedelta(minutes=EMAIL_VERIFY_TTL_MINUTES)
    payload = {"sub": email, "exp": expire, "type": TOKEN_TYPE}
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def verify_email_token(token: str) -> str:
    """JWT 검증 → 이메일 반환. 위조/만료/타입 불일치 시 401."""
    try:
        payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="이메일 검증 토큰이 만료되었거나 유효하지 않습니다",
        )

    if payload.get("type") != TOKEN_TYPE:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="이메일 검증 토큰 형식이 올바르지 않습니다",
        )
    email = payload.get("sub")
    if not email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="이메일 검증 토큰에 이메일 정보가 없습니다",
        )
    return email
