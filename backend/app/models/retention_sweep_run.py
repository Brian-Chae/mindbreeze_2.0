"""기본 DB 삭제 스위프 실행 이력 (SDD-209 B12 / BE-R2 · MG-6).

dry-run(비활성 포함)·실제 실행 모두 1건씩 남긴다. ``report`` 에 후보 건수·바이트·보류 건수·삭제 건수가 들어간다.
세션/참여자 FK 를 두지 않는다 — 이력은 대상 행이 사라져도 남아야 한다. 개인정보 값은 싣지 않는다(건수·UUID 만).
"""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class RetentionSweepRun(Base):
    __tablename__ = "retention_sweep_runs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # dry_run | execute
    mode: Mapped[str] = mapped_column(String(10), nullable=False)
    # manual | cron
    trigger: Mapped[str] = mapped_column(String(10), nullable=False, default="manual")
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # running | completed | failed
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="running")
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    report: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
