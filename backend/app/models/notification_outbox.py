"""알림 Outbox 모델 — WS·이메일 전달 보장(트랜잭셔널 outbox 패턴)"""

import uuid
from datetime import datetime

from sqlalchemy import String, Text, Integer, DateTime, ForeignKey, Index, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class NotificationOutbox(Base):
    __tablename__ = "notification_outbox"
    # MB2-ORM-IDX-06: 폴링 워커가 (status='pending', channel=..., available_at<=now)로 조회하므로
    # 복합 인덱스로 풀스캔을 방지한다.
    __table_args__ = (
        Index(
            "ix_notification_outbox_status_channel_available",
            "status",
            "channel",
            "available_at",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # WS 채널은 연관 알림 ID를, 이메일 채널은 대상 사용자를 참조
    notification_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("notifications.id"), nullable=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    channel: Mapped[str] = mapped_column(String(10), nullable=False)  # "ws" | "email"
    recipient: Mapped[str | None] = mapped_column(String(500))  # 이메일 주소(email 채널)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False)  # pending/sent/failed
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    available_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    last_error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
