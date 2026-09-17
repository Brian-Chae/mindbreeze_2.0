"""관리자 비밀번호 재설정 서비스 (SDD-078)

플랫폼 관리자·기관 관리자가 active 상담사·주 담당자의 비밀번호를
재설정 링크로 재설정한다. 기존 초대 토큰 인프라(JWT + Redis jti)와 동일한
메커니즘을 쓰되, 초대 수락 시멘틱(status 강제 전환)과 격리하기 위해
token_type="admin_password_reset" 별도 소비 경로로 처리한다.

보안 원칙 (기획 §7):
  - 비밀번호 원문 무전송 — 링크 방식만, 임시 비밀번호 금지
  - 토큰 원문은 이메일 본문에만 존재 (DB·로그·API 응답 저장 금지)
  - 일회용(jti) + TTL 24시간 + 재발급 시 이전 토큰 무효화
  - 소비 시 revoke_all_user_tokens 무조건 호출 (전 세션 강제 로그아웃)
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from jose import JWTError, jwt
from redis.asyncio import Redis
from sqlalchemy.orm import Session

from app.config import settings
from app.core.security import hash_password
from app.models.credential import VerificationAudit
from app.models.password_history import PasswordHistory
from app.models.user import User
from app.services import password_reset_service, refresh_token_service
from app.tasks.email import (
    send_admin_password_reset_email,
    send_password_reset_completed_email,
)

TOKEN_TYPE = "admin_password_reset"
# TTL 24시간 — 본인용(30분)보다 길게(대상자 부재 대비), 초대(7일)보다 짧게(탈취 창 최소화)
RESET_TTL_HOURS = 24
RESET_TTL_SECONDS = RESET_TTL_HOURS * 60 * 60
# 남용 방지 쿨다운 — 기관 단위가 아닌 대상자 단위 (여러 상담사 연속 처리는 막지 않음)
COOLDOWN_SECONDS = 60

ACTOR_ROLE_LABELS = {"platform_admin": "플랫폼 관리자", "org_admin": "기관 관리자"}


def _reset_key(jti: str) -> str:
    return f"admin_pwd_reset:{jti}"


def _active_jti_key(user_id: str) -> str:
    """대상자별 현재 유효 jti — 재발급 시 이전 토큰을 무효화하는 데 쓴다."""
    return f"admin_pwd_reset_active:{user_id}"


def _cooldown_key(user_id: str) -> str:
    return f"admin_pwd_reset_cooldown:{user_id}"


def peek_token_type(token: str) -> str | None:
    """토큰의 type 클레임만 확인 — 소비 경로 분기용. 무효 토큰이면 None."""
    try:
        payload = jwt.decode(
            token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm]
        )
    except JWTError:
        return None
    return payload.get("type")


def _ensure_target_resettable(target: User, actor_id: uuid.UUID) -> None:
    """대상 상태 검증 — active만 허용. pending → resend-invite 안내, suspended → 거부."""
    if target.id == actor_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="본인 계정은 로그인 화면의 비밀번호 찾기를 이용해 주세요",
        )
    if target.status == "pending":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="초대 수락 전 계정입니다. 초대 재발송을 사용해 주세요",
        )
    if target.status != "active":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="정지된 계정은 비밀번호를 재설정할 수 없습니다. 정지 해제 후 다시 시도해 주세요",
        )


async def issue_admin_reset(
    target: User,
    *,
    actor_id: uuid.UUID,
    actor_name: str,
    actor_role: str,
    reason: str,
    org_id: uuid.UUID | None,
    db: Session,
    redis: Redis,
) -> tuple[bool, datetime]:
    """재설정 토큰 발급 + 이메일 발송 + 감사 기록.

    권한·기관 활성 검증은 라우터에서 끝난 상태로 호출된다.
    반환값은 (email_sent, expires_at). 토큰 원문은 이메일 링크에만 존재한다.
    """
    _ensure_target_resettable(target, actor_id)

    if await redis.get(_cooldown_key(str(target.id))):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"재설정 링크는 {COOLDOWN_SECONDS}초에 한 번만 발송할 수 있습니다",
        )

    # 재발급 시 이전 토큰 무효화 — 유효 링크는 항상 1개만 존재한다
    previous_jti = await redis.get(_active_jti_key(str(target.id)))
    if previous_jti:
        await redis.delete(_reset_key(previous_jti))

    jti = uuid.uuid4().hex
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=RESET_TTL_SECONDS)
    payload = {
        "sub": str(target.id),
        "exp": expires_at,
        "type": TOKEN_TYPE,
        "jti": jti,
        # 완료 감사 기록에서 "누가 발급한 재설정인지" 추적하기 위한 클레임
        "issued_by": str(actor_id),
    }
    token = jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)

    await redis.setex(_reset_key(jti), RESET_TTL_SECONDS, str(target.id))
    await redis.setex(_active_jti_key(str(target.id)), RESET_TTL_SECONDS, jti)
    await redis.setex(_cooldown_key(str(target.id)), COOLDOWN_SECONDS, "1")

    reset_link = (
        f"{settings.frontend_base_url.rstrip('/')}/set-password?token={token}&type=reset"
    )
    email_sent = send_admin_password_reset_email(
        target.email,
        reset_link,
        target_name=target.name,
        admin_name=actor_name,
        admin_role_label=ACTOR_ROLE_LABELS.get(actor_role, "관리자"),
        expires_hours=RESET_TTL_HOURS,
    )

    db.add(VerificationAudit(
        target_type="user",
        target_id=target.id,
        admin_id=actor_id,
        action="password_reset_issued",
        reason=reason,
        extra={
            "org_id": str(org_id) if org_id else None,
            "target_role": target.role,
            "expires_at": expires_at.isoformat(),
            "email_sent": email_sent,
        },
    ))
    db.commit()

    return email_sent, expires_at


async def complete_admin_reset(
    token: str, new_password: str, db: Session, redis: Redis
) -> User:
    """재설정 토큰 소비 — 비밀번호 정책 + 이력 + 전 세션 무효화 + 완료 알림 + 감사.

    초대 수락과 달리 status는 건드리지 않는다(active 유지).
    """
    password_reset_service._validate_password(new_password)

    try:
        payload = jwt.decode(
            token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm]
        )
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="재설정 링크가 만료되었거나 유효하지 않습니다",
        )

    if payload.get("type") != TOKEN_TYPE:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="재설정 토큰 형식이 올바르지 않습니다",
        )

    jti = payload.get("jti")
    user_id = payload.get("sub")
    if not jti or not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="재설정 토큰에 필수 클레임이 없습니다",
        )

    stored = await redis.get(_reset_key(jti))
    if stored is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="이미 사용되었거나 만료된 재설정 링크입니다",
        )

    user = db.query(User).filter(User.id == uuid.UUID(user_id)).first()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="사용자를 찾을 수 없습니다"
        )
    if user.status != "active":
        # 발급 이후 정지된 계정 — 재설정으로 세션을 되살릴 수 없게 차단한다
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="현재 상태에서는 비밀번호를 재설정할 수 없습니다. 관리자에게 문의하세요",
        )

    # 직전 3개 비밀번호 재사용 차단 (기획 §7.5 — 본인용과 동일 정책)
    if not password_reset_service.check_password_history(str(user.id), new_password, db):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="직전에 사용한 비밀번호는 재사용할 수 없습니다",
        )

    new_hash = hash_password(new_password)
    user.password_hash = new_hash
    db.add(PasswordHistory(user_id=user.id, password_hash=new_hash))

    issued_by = payload.get("issued_by")
    db.add(VerificationAudit(
        target_type="user",
        target_id=user.id,
        admin_id=uuid.UUID(issued_by) if issued_by else None,
        action="password_reset_completed",
        reason=None,
        extra={"issued_by": issued_by, "jti": jti},
    ))
    db.commit()
    db.refresh(user)

    # 일회용 보장 — jti 즉시 삭제
    await redis.delete(_reset_key(jti))
    await redis.delete(_active_jti_key(str(user.id)))

    # 전 세션 강제 로그아웃 — 무조건 호출 (탈취된 세션 차단)
    refresh_token_service.revoke_all_user_tokens(str(user.id), db)

    send_password_reset_completed_email(user.email, name=user.name)

    return user
