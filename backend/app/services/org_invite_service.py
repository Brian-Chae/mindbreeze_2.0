"""기관 담당자 초대 토큰 서비스 (SDD-016)

기존 ``password_reset_service`` 와 동일한 메커니즘을 재사용한다.
  - JWT(jti 포함)를 발급해 이메일 링크로만 전달한다.
  - Redis 에는 토큰 원문이 아니라 jti → user_id 매핑만 보관한다.
  - 사용 즉시 jti 를 삭제해 일회용을 보장하고, TTL 로 만료를 처리한다.

임시 비밀번호를 메일로 보내지 않으므로, 유출 시에도 계정이 곧바로 탈취되지 않는다.
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from jose import JWTError, jwt
from redis.asyncio import Redis
from sqlalchemy.orm import Session

from app.config import settings
from app.core.security import hash_password
from app.models.password_history import PasswordHistory
from app.models.user import User
from app.tasks.email import send_org_invite_email

# 초대 토큰 유효기간 — 7일 (스펙 §7)
INVITE_TTL_DAYS = 7
INVITE_TTL_SECONDS = INVITE_TTL_DAYS * 24 * 60 * 60
TOKEN_TYPE = "org_admin_invite"

# 재발송 레이트 리밋 — 기관당 60초 1회
RESEND_COOLDOWN_SECONDS = 60

_PASSWORD_RE = re.compile(r"^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$")


def _invite_key(jti: str) -> str:
    return f"org_invite:{jti}"


def _resend_key(org_id: str) -> str:
    return f"org_invite_resend:{org_id}"


def _validate_password(password: str) -> None:
    if not _PASSWORD_RE.match(password or ""):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="비밀번호는 8자 이상이며 영문·숫자·특수문자를 모두 포함해야 합니다",
        )


async def issue_invite(user: User, org_name: str, redis: Redis) -> bool:
    """초대 토큰 발급 + 비밀번호 설정 링크 이메일 발송.

    반환값은 이메일 발송 성공 여부. 토큰 원문은 이메일 본문에만 존재하며
    DB·로그·API 응답 어디에도 저장하지 않는다.
    """
    jti = uuid.uuid4().hex
    expire = datetime.now(timezone.utc) + timedelta(seconds=INVITE_TTL_SECONDS)
    payload = {
        "sub": str(user.id),
        "exp": expire,
        "type": TOKEN_TYPE,
        "jti": jti,
    }
    token = jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)

    await redis.setex(_invite_key(jti), INVITE_TTL_SECONDS, str(user.id))

    invite_link = f"{settings.frontend_base_url.rstrip('/')}/set-password?token={token}"
    return send_org_invite_email(
        user.email,
        invite_link,
        admin_name=user.name,
        org_name=org_name,
        expires_days=INVITE_TTL_DAYS,
    )


async def check_resend_cooldown(org_id: str, redis: Redis) -> None:
    """재발송 레이트 리밋 — 쿨다운 중이면 429."""
    if await redis.get(_resend_key(org_id)):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"초대 메일은 {RESEND_COOLDOWN_SECONDS}초에 한 번만 재발송할 수 있습니다",
        )


async def mark_resent(org_id: str, redis: Redis) -> None:
    """재발송 쿨다운 시작."""
    await redis.setex(_resend_key(org_id), RESEND_COOLDOWN_SECONDS, "1")


async def consume_invite(token: str, new_password: str, db: Session, redis: Redis) -> User:
    """초대 토큰 검증 → 비밀번호 최초 설정 + 계정 활성화.

    토큰은 일회용이다. 검증 통과 후 jti 를 즉시 삭제해 재사용을 막는다.
    """
    _validate_password(new_password)

    try:
        payload = jwt.decode(
            token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm]
        )
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="초대 토큰이 만료되었거나 유효하지 않습니다",
        )

    if payload.get("type") != TOKEN_TYPE:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="초대 토큰 형식이 올바르지 않습니다",
        )

    jti = payload.get("jti")
    user_id = payload.get("sub")
    if not jti or not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="초대 토큰에 필수 클레임이 없습니다",
        )

    stored = await redis.get(_invite_key(jti))
    if stored is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="이미 사용되었거나 만료된 초대 토큰입니다",
        )

    user = db.query(User).filter(User.id == uuid.UUID(user_id)).first()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="사용자를 찾을 수 없습니다"
        )

    new_hash = hash_password(new_password)
    user.password_hash = new_hash
    # 초대 수락 = 이메일 소유 증명이므로 계정을 활성화한다
    user.status = "active"
    user.verified_tier = "email"
    db.add(PasswordHistory(user_id=user.id, password_hash=new_hash))
    db.commit()
    db.refresh(user)

    await redis.delete(_invite_key(jti))
    return user
