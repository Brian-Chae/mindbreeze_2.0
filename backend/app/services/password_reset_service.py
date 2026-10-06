"""비밀번호 재설정 서비스 — JWT reset_token + Redis 보관"""

import re
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from jose import JWTError, jwt
from redis.asyncio import Redis
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import settings
from app.core.security import hash_password, verify_password
from app.models.password_history import PasswordHistory
from app.models.user import User
from app.tasks.email import send_password_reset_email

RESET_TTL_MINUTES = 30
# SEC-07: 이메일 단위 쿨다운(초) — 반복 요청에 의한 재설정 메일 폭탄 방지
RESET_EMAIL_COOLDOWN_SECONDS = 60
TOKEN_TYPE = "password_reset"
_PASSWORD_RE = re.compile(r"^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$")


def _validate_password(pw: str) -> None:
    if not _PASSWORD_RE.match(pw):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="비밀번호는 8자 이상이며 영문·숫자·특수문자를 모두 포함해야 합니다",
        )


def _reset_key(jti: str) -> str:
    return f"pwd_reset:{jti}"


def _reset_cooldown_key(email: str) -> str:
    # SEC-07: 이메일별 재설정 요청 쿨다운 키
    return f"pwd_reset_cooldown:{email.lower()}"


async def initiate_reset(email: str, db: Session, redis: Redis) -> None:
    """사용자 존재 시 reset_token 발급 + 이메일 발송. 미존재여도 조용히 통과."""
    # MB2-AUTH-02: 이메일 대소문자 정규화 — 조회·토큰·쿨다운 키를 동일 기준으로 맞춘다.
    email = (email or "").strip().lower()
    # SEC-07: 메일 폭탄 방지 — 쿨다운 중이면 조용히 통과(사용자 존재 노출 방지).
    if await redis.get(_reset_cooldown_key(email)):
        return

    user = db.query(User).filter(func.lower(User.email) == email).first()
    if user is None:
        # 사용자 존재 노출 방지 — 조용히 통과
        return

    jti = uuid.uuid4().hex
    expire = datetime.now(timezone.utc) + timedelta(minutes=RESET_TTL_MINUTES)
    payload = {"sub": email, "exp": expire, "type": TOKEN_TYPE, "jti": jti}
    token = jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)

    await redis.setex(_reset_key(jti), RESET_TTL_MINUTES * 60, str(user.id))
    await redis.setex(_reset_cooldown_key(email), RESET_EMAIL_COOLDOWN_SECONDS, "1")

    # SEC-07: 프론트 base URL 을 붙인 절대 URL 로 생성한다.
    #   기존 상대경로('/auth/...')는 메일 클라이언트에서 열 수 없어 링크가 깨졌다.
    reset_link = f"{settings.frontend_base_url.rstrip('/')}/auth/password/reset?token={token}"
    send_password_reset_email(email, reset_link)


def check_password_history(user_id: str, new_password: str, db: Session) -> bool:
    """직전 3개 비밀번호와 비교 — 재사용이면 False. (스켈레톤)"""
    recent = (
        db.query(PasswordHistory)
        .filter(PasswordHistory.user_id == user_id)
        .order_by(PasswordHistory.created_at.desc())
        .limit(3)
        .all()
    )
    for entry in recent:
        if verify_password(new_password, entry.password_hash):
            return False
    return True


async def complete_reset(
    token: str, new_password: str, db: Session, redis: Redis
) -> None:
    """JWT + Redis 검증 → 비밀번호 업데이트 + 이력 기록 + 토큰 삭제"""
    _validate_password(new_password)

    try:
        payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="재설정 토큰이 만료되었거나 유효하지 않습니다",
        )

    if payload.get("type") != TOKEN_TYPE:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="재설정 토큰 형식이 올바르지 않습니다",
        )

    jti = payload.get("jti")
    email = (payload.get("sub") or "").strip().lower()
    if not jti or not email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="재설정 토큰에 필수 클레임이 없습니다",
        )

    stored = await redis.get(_reset_key(jti))
    if stored is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="이미 사용되었거나 만료된 재설정 토큰입니다",
        )

    user = db.query(User).filter(func.lower(User.email) == email).first()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="사용자를 찾을 수 없습니다",
        )

    # MB2-AUTH-03: 본인 재설정도 직전 3개 비밀번호 재사용을 차단한다 (관리자 재설정과 동일 정책).
    if not check_password_history(str(user.id), new_password, db):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="직전에 사용한 비밀번호는 재사용할 수 없습니다",
        )

    new_hash = hash_password(new_password)
    user.password_hash = new_hash
    db.add(PasswordHistory(user_id=user.id, password_hash=new_hash))
    db.commit()

    # SDD-136: 비밀번호 변경 시 기존 세션(리프레시 토큰) 전부 무효화 — 관리자 재설정과 동일 정책.
    from app.services import refresh_token_service

    refresh_token_service.revoke_all_user_tokens(str(user.id), db)

    await redis.delete(_reset_key(jti))
