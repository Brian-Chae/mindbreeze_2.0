"""SDD-190: 디바이스 토큰 등록·해지·조회 서비스.

규칙
- token 은 전역 UNIQUE 다. 같은 토큰을 다른 사용자가 등록하면 **기기 소유자 이전**으로
  보고 같은 행의 user_id 를 바꾸고 revoked_at 을 해제한다(기기 양도·계정 전환).
- 해지는 소프트 해지(revoked_at) — 행을 지우지 않는다. 발송 대상에서만 빠진다.
- 토큰 값은 로그에 남기지 않는다. 식별이 필요하면 `mask_token` 결과만 쓴다.
"""

import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy.orm import Session as DBSession

from app.models.device_token import DeviceToken

logger = logging.getLogger(__name__)


def mask_token(token: str) -> str:
    """토큰 비식별 표기 — 접두사 6자 + 길이만. 로그·last_error 에 이 형식만 쓴다."""
    if not token:
        return "<empty>"
    return f"{token[:6]}…(len={len(token)})"


def _to_uuid(value: str | uuid.UUID) -> uuid.UUID:
    return value if isinstance(value, uuid.UUID) else uuid.UUID(str(value))


def register_token(
    db: DBSession,
    user_id: str | uuid.UUID,
    *,
    token: str,
    platform: str,
    app_version: str | None = None,
    device_label: str | None = None,
    p256dh: str | None = None,
    auth: str | None = None,
) -> DeviceToken:
    """토큰 upsert — 행은 토큰당 1개. 재등록 시 last_seen_at·메타를 갱신한다."""
    now = datetime.now(timezone.utc)
    owner = _to_uuid(user_id)
    row = db.query(DeviceToken).filter(DeviceToken.token == token).first()

    if row is None:
        row = DeviceToken(
            user_id=owner,
            token=token,
            platform=platform,
            p256dh=p256dh,
            auth=auth,
            app_version=app_version,
            device_label=device_label,
            last_seen_at=now,
        )
        db.add(row)
    else:
        # 소유자 이전 + 해지 해제(같은 기기를 다시 쓰기 시작한 경우)
        row.user_id = owner
        row.platform = platform
        row.p256dh = p256dh
        row.auth = auth
        row.last_seen_at = now
        row.revoked_at = None
        if app_version is not None:
            row.app_version = app_version
        if device_label is not None:
            row.device_label = device_label

    db.commit()
    db.refresh(row)
    return row


def revoke_token(db: DBSession, user_id: str | uuid.UUID, token: str) -> bool:
    """본인 토큰 해지. 없거나 타인 토큰이면 False(API 는 404) — 존재 여부를 흘리지 않는다."""
    row = (
        db.query(DeviceToken)
        .filter(DeviceToken.token == token, DeviceToken.user_id == _to_uuid(user_id))
        .first()
    )
    if row is None:
        return False
    if row.revoked_at is None:
        row.revoked_at = datetime.now(timezone.utc)
        db.commit()
    return True


def revoke_token_value(db: DBSession, token: str) -> None:
    """FCM 이 무효(UNREGISTERED 등)라고 응답한 토큰을 사용자 무관하게 해지한다."""
    row = db.query(DeviceToken).filter(DeviceToken.token == token).first()
    if row is None or row.revoked_at is not None:
        return
    row.revoked_at = datetime.now(timezone.utc)
    db.commit()
    logger.info("[device_service] 무효 토큰 해지: %s", mask_token(token))


def list_active_tokens(db: DBSession, user_id: str | uuid.UUID) -> list[DeviceToken]:
    """발송 대상 토큰(미해지) 목록 — 등록 순."""
    return (
        db.query(DeviceToken)
        .filter(DeviceToken.user_id == _to_uuid(user_id), DeviceToken.revoked_at.is_(None))
        .order_by(DeviceToken.created_at)
        .all()
    )
