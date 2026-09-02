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
from app.tasks.email import send_counselor_invite_email, send_org_invite_email

# 초대 토큰 유효기간 — 7일 (스펙 §7)
INVITE_TTL_DAYS = 7
INVITE_TTL_SECONDS = INVITE_TTL_DAYS * 24 * 60 * 60

# SDD-017: 기관 담당자 초대와 상담사 초대가 동일 토큰 인프라를 공유한다.
# 토큰 type 은 화이트리스트로만 수용한다.
TOKEN_TYPE = "org_admin_invite"
COUNSELOR_TOKEN_TYPE = "counselor_invite"
ALLOWED_INVITE_TYPES = {TOKEN_TYPE, COUNSELOR_TOKEN_TYPE}

# Redis key prefix — 발급·소비가 반드시 동일 key 를 쓰도록 token_type 별 prefix 를 고정한다.
_INVITE_KEY_PREFIX = {
    TOKEN_TYPE: "org_invite",
    COUNSELOR_TOKEN_TYPE: "counselor_invite",
}

# 재발송 레이트 리밋 — 기관당 60초 1회
RESEND_COOLDOWN_SECONDS = 60

_PASSWORD_RE = re.compile(r"^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$")


def _invite_key(jti: str, token_type: str) -> str:
    """jti → user_id 매핑 Redis key. token_type 에 따라 prefix 를 분리한다.

    발급(issue)과 소비(consume)가 반드시 이 동일 함수를 통해 key 를 만들어야
    두 경로의 prefix 가 어긋나지 않는다.
    """
    prefix = _INVITE_KEY_PREFIX.get(token_type, "org_invite")
    return f"{prefix}:{jti}"


def _resend_key(org_id: str) -> str:
    return f"org_invite_resend:{org_id}"


def _counselor_send_key(org_id: str) -> str:
    """상담사 초기 초대 레이트리밋 key (기관당)."""
    return f"counselor_invite_send:{org_id}"


def _counselor_resend_key(org_id: str) -> str:
    """상담사 초대 재발송 쿨다운 key (org_admin 초대와 분리)."""
    return f"counselor_invite_resend:{org_id}"


def _validate_password(password: str) -> None:
    if not _PASSWORD_RE.match(password or ""):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="비밀번호는 8자 이상이며 영문·숫자·특수문자를 모두 포함해야 합니다",
        )


async def _issue(user: User, redis: Redis, *, token_type: str) -> str:
    """초대 토큰을 발급하고 비밀번호 설정 링크를 반환한다 (이메일 발송 제외).

    토큰 원문은 이 링크(=이메일 본문)에만 존재하며 DB·로그·API 응답 어디에도
    저장하지 않는다. Redis 에는 jti → user_id 매핑만 남긴다.
    """
    jti = uuid.uuid4().hex
    expire = datetime.now(timezone.utc) + timedelta(seconds=INVITE_TTL_SECONDS)
    payload = {
        "sub": str(user.id),
        "exp": expire,
        "type": token_type,
        "jti": jti,
    }
    token = jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)

    await redis.setex(_invite_key(jti, token_type), INVITE_TTL_SECONDS, str(user.id))

    return f"{settings.frontend_base_url.rstrip('/')}/set-password?token={token}"


async def issue_invite(user: User, org_name: str, redis: Redis) -> bool:
    """기관 담당자(org_admin) 초대 토큰 발급 + 비밀번호 설정 링크 이메일 발송.

    반환값은 이메일 발송 성공 여부.
    """
    invite_link = await _issue(user, redis, token_type=TOKEN_TYPE)
    return send_org_invite_email(
        user.email,
        invite_link,
        admin_name=user.name,
        org_name=org_name,
        expires_days=INVITE_TTL_DAYS,
    )


async def issue_counselor_invite(user: User, org_name: str, redis: Redis) -> bool:
    """상담사(counselor) 초대 토큰 발급 + 비밀번호 설정 링크 이메일 발송 (SDD-017).

    org_admin 초대와 동일한 토큰 인프라를 쓰되 type="counselor_invite" 로 구분한다.
    """
    invite_link = await _issue(user, redis, token_type=COUNSELOR_TOKEN_TYPE)
    return send_counselor_invite_email(
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


async def check_counselor_send_cooldown(org_id: str, redis: Redis) -> None:
    """상담사 초기 초대 레이트리밋 — 쿨다운 중이면 429 (이메일 폭탄 방지)."""
    if await redis.get(_counselor_send_key(org_id)):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"상담사 초대는 {RESEND_COOLDOWN_SECONDS}초에 한 번만 보낼 수 있습니다",
        )


async def mark_counselor_sent(org_id: str, redis: Redis) -> None:
    """상담사 초기 초대 쿨다운 시작."""
    await redis.setex(_counselor_send_key(org_id), RESEND_COOLDOWN_SECONDS, "1")


async def check_counselor_resend_cooldown(org_id: str, redis: Redis) -> None:
    """상담사 초대 재발송 레이트 리밋 — 쿨다운 중이면 429."""
    if await redis.get(_counselor_resend_key(org_id)):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"초대 메일은 {RESEND_COOLDOWN_SECONDS}초에 한 번만 재발송할 수 있습니다",
        )


async def mark_counselor_resent(org_id: str, redis: Redis) -> None:
    """상담사 초대 재발송 쿨다운 시작."""
    await redis.setex(_counselor_resend_key(org_id), RESEND_COOLDOWN_SECONDS, "1")


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

    token_type = payload.get("type")
    if token_type not in ALLOWED_INVITE_TYPES:
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

    stored = await redis.get(_invite_key(jti, token_type))
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

    await redis.delete(_invite_key(jti, token_type))
    return user
