"""Refresh 토큰 — JWT 발급/회전/폐기. jti 기반 재사용 감지."""

import uuid
from datetime import datetime, timedelta, timezone
from typing import cast

from fastapi import HTTPException, status
from jose import jwt
from sqlalchemy import CursorResult, text
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


def issue_refresh_token(
    user_id: str, db: Session, remember: bool = True, *, commit: bool = True
) -> str:
    """신규 Refresh 토큰 발급 + DB 기록.

    remember=False 로 발급된 토큰은 refresh 회전 시에도 세션 쿠키로 재발급된다.
    DATA-03: commit=False 이면 flush 만 수행한다 — 가입 트랜잭션에 합류해
    요청 단위 단일 커밋이 되도록 한다.
    """
    jti = uuid.uuid4().hex
    expire = _now() + timedelta(days=settings.refresh_token_expire_days)
    token = _encode(user_id, jti, expire, remember=remember)

    db.add(RefreshToken(jti=jti, user_id=uuid.UUID(user_id), expires_at=expire))
    if commit:
        db.commit()
    else:
        db.flush()
    return token


def rotate_refresh_token(
    old_jti: str, user_id: str, db: Session, remember: bool = True
) -> str:
    """기존 토큰 폐기 → 신규 발급. 호출 전 재사용 여부는 라우터에서 검증.

    DATA-02: 기존 '조회 후 폐기'는 원자적이지 않아 동시 요청 시 두 개의 유효
    토큰이 발급될 수 있었다. 조건부 UPDATE(revoked_at IS NULL)로 영향 행수가
    정확히 1일 때만 신규 토큰을 발급해 회전을 원자화한다.
    """
    now = _now()
    new_jti = uuid.uuid4().hex
    expire = now + timedelta(days=settings.refresh_token_expire_days)
    new_token = _encode(user_id, new_jti, expire, remember=remember)

    # 원자적 회전 — 이미 폐기된 토큰(revoked_at NOT NULL)이면 0행 → 신규 발급 금지.
    result = db.execute(
        text(
            "UPDATE refresh_tokens SET revoked_at = :now "
            "WHERE jti = :jti AND revoked_at IS NULL"
        ),
        {"now": now, "jti": old_jti},
    )
    if cast(CursorResult, result).rowcount != 1:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="이미 사용되었거나 폐기된 리프레시 토큰입니다",
        )

    # 대체 토큰 참조 기록 (기존 회전 추적 동작 유지)
    db.execute(
        text("UPDATE refresh_tokens SET replaced_by = :new WHERE jti = :jti"),
        {"new": new_jti, "jti": old_jti},
    )

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
