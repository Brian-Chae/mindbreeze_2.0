"""Refresh 토큰 — JWT 발급/회전/폐기. jti 기반 재사용 감지."""

import uuid
from datetime import datetime, timedelta, timezone

from jose import jwt
from sqlalchemy.orm import Session

from app.config import settings
from app.models.refresh_token import RefreshToken


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _encode(user_id: str, jti: str, expire: datetime, remember: bool = True) -> str:
    # remember 클레임으로 "로그인 상태 유지" 선택을 토큰 회전(refresh) 후에도 이어받는다.
    # 기존에 발급된 토큰에는 클레임이 없으므로 읽는 쪽에서 True(기존 동작)로 폴백한다.
    payload = {
        "sub": user_id,
        "exp": expire,
        "type": "refresh",
        "jti": jti,
        "remember": bool(remember),
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def issue_refresh_token(user_id: str, db: Session, remember: bool = True) -> str:
    """신규 Refresh 토큰 발급 + DB 기록.

    remember=False 로 발급된 토큰은 refresh 회전 시에도 세션 쿠키로 재발급된다.
    """
    jti = uuid.uuid4().hex
    expire = _now() + timedelta(days=settings.refresh_token_expire_days)
    token = _encode(user_id, jti, expire, remember=remember)

    db.add(RefreshToken(jti=jti, user_id=uuid.UUID(user_id), expires_at=expire))
    db.commit()
    return token


def rotate_refresh_token(
    old_jti: str, user_id: str, db: Session, remember: bool = True
) -> str:
    """기존 토큰 폐기 → 신규 발급. 호출 전 재사용 여부는 라우터에서 검증."""
    old = db.query(RefreshToken).filter(RefreshToken.jti == old_jti).first()
    if old and old.revoked_at is None:
        old.revoked_at = _now()

    new_jti = uuid.uuid4().hex
    expire = _now() + timedelta(days=settings.refresh_token_expire_days)
    new_token = _encode(user_id, new_jti, expire, remember=remember)

    if old:
        old.replaced_by = new_jti

    db.add(RefreshToken(jti=new_jti, user_id=uuid.UUID(user_id), expires_at=expire))
    db.commit()
    return new_token


def revoke_token(jti: str, db: Session) -> None:
    """단일 토큰 폐기"""
    token = db.query(RefreshToken).filter(RefreshToken.jti == jti).first()
    if token and token.revoked_at is None:
        token.revoked_at = _now()
        db.commit()


def revoke_all_user_tokens(user_id: str, db: Session) -> None:
    """사용자 전체 활성 토큰 폐기 (재사용 감지 시)"""
    db.query(RefreshToken).filter(
        RefreshToken.user_id == uuid.UUID(user_id),
        RefreshToken.revoked_at.is_(None),
    ).update({"revoked_at": _now()})
    db.commit()
