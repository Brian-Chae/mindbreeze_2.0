"""SDD-264 — 폰이 보고한 생성 총량(기대량). 참여자당 1행, 필드별 단조 증가만 허용한다.

- feature: 폰이 만든 feature 창 총수. raw_*: 신호별 원시 청크 총수(미보고 NULL).
- final: 폰이 더 만들 것이 없다고 보고한 최종값 여부.
- 계약 정본: specs/sdd-264-upload-progress-expected/contract.md
"""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class SessionIngestExpected(Base):
    __tablename__ = "session_ingest_expected"

    participant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("session_participants.id", ondelete="CASCADE"), primary_key=True)
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    feature: Mapped[int] = mapped_column(Integer, nullable=False)
    raw_eeg: Mapped[int | None] = mapped_column(Integer, nullable=True)
    raw_ppg: Mapped[int | None] = mapped_column(Integer, nullable=True)
    raw_acc: Mapped[int | None] = mapped_column(Integer, nullable=True)
    final: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    first_reported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    reported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
