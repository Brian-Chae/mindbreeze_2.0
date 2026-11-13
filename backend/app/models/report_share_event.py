"""리포트 공유 메일 발송 이력 (SDD-327 T11).

수신자 주소 원문은 저장하지 않는다(마스킹 표기 + 해시만). 발송은 큐 인자로만 전달 후 폐기.
"""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, String, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class ReportShareEvent(Base):
    __tablename__ = "report_share_events"
    __table_args__ = (
        CheckConstraint("status IN ('queued','sent','failed')", name="ck_report_share_events_status"),
        Index("ix_report_share_events_report_created", "report_id", text("created_at DESC")),
        Index("ix_report_share_events_sender_created", "sender_user_id", "created_at"),
        Index("ix_report_share_events_jti", "jti"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    report_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("reports.id", ondelete="CASCADE"), nullable=False
    )
    sender_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    sender_role: Mapped[str] = mapped_column(String(20), nullable=False)
    recipient_masked: Mapped[str] = mapped_column(String(255), nullable=False)
    recipient_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    jti: Mapped[str | None] = mapped_column(String(64))
    attached: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="queued", server_default="queued")
    error_code: Mapped[str | None] = mapped_column(String(50))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
