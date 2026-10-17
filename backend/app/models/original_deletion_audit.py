"""원본 삭제 감사 (SDD-209 B1 / BE-1④).

플랫폼 관리자의 기간 전 원본 삭제를 대상·실행자·시각·사유와 함께 남긴다.
세션/사용자가 이후 삭제되어도 감사가 휩쓸리지 않도록 FK 없이 UUID 값만 보관한다.
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class OriginalDeletionAudit(Base):
    __tablename__ = "original_deletion_audits"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    actor_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    target_type: Mapped[str] = mapped_column(String(20), nullable=False)  # session
    target_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    scopes: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    result: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
