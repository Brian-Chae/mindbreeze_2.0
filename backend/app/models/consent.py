"""Consent — 약관 분리 동의 기록 (tos / privacy / sensitive)"""

import uuid
from datetime import datetime

from sqlalchemy import String, DateTime, Boolean, ForeignKey, func, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Consent(Base):
    __tablename__ = "consents"
    __table_args__ = (UniqueConstraint("user_id", "type", "version", name="uq_consent_user_type_version"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    type: Mapped[str] = mapped_column(String(20), nullable=False)  # tos, privacy, sensitive(필수) / eeg, research(선택, SDD-220)
    version: Mapped[str] = mapped_column(String(20), nullable=False, default="1.0")
    agreed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    agreed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    # SDD-220: 선택 동의(eeg/research) 앱 내 철회 시각. NULL 이면 철회 이력 없음.
    withdrawn_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user = relationship("User", back_populates="consents")
