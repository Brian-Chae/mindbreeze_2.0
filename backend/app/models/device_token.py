"""SDD-190/192: 푸시 디바이스 토큰 모델(앱 FCM + 웹 푸시 구독).

앱(Capacitor)이 FCM 등록 토큰을 올려두는 테이블. 발송기(push_service)는 사용자별
`revoked_at IS NULL` 행만 대상으로 삼는다. 토큰은 기기 식별자이므로 로그·응답에
전체 값을 남기지 않는다(접두사+길이만).
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class DeviceToken(Base):
    __tablename__ = "device_tokens"
    # 발송기가 (user_id, revoked_at IS NULL)로 조회하므로 복합 인덱스로 풀스캔을 막는다.
    __table_args__ = (
        Index("ix_device_tokens_user_revoked", "user_id", "revoked_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    # FCM 등록 토큰 — 기기당 1개. 기기 소유자가 바뀌면 같은 행의 user_id 를 이전한다.
    token: Mapped[str] = mapped_column(String(512), nullable=False, unique=True)
    platform: Mapped[str] = mapped_column(String(10), nullable=False)  # "ios" | "android"
    # SDD-192: platform="web" 일 때 token 은 구독 endpoint, 암호화 키는 아래 두 컬럼.
    p256dh: Mapped[str | None] = mapped_column(String(255))
    auth: Mapped[str | None] = mapped_column(String(64))
    app_version: Mapped[str | None] = mapped_column(String(50))
    device_label: Mapped[str | None] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # 소프트 해지 — 로그아웃·FCM UNREGISTERED 응답 시 기록한다(행은 남긴다).
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
