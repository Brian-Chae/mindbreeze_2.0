"""SDD-022 EEGFeatureWindow — 1초 단위 EEG feature 시계열.

하루밴드 리포트 엔진(eeg_metrics)이 소비하는 윈도우 단위 원천 feature 를 저장한다.
P0 은 서버 산출(포팅) 검증만 하고, 실제 수집(ingestion)은 P1(하드웨어 필요).

null 보존 원칙: 산출 불가한 feature 는 NULL 로 저장하며 0 으로 치환하지 않는다.
"""

import uuid
from datetime import datetime

from sqlalchemy import Float, Integer, String, DateTime, ForeignKey, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class EEGFeatureWindow(Base):
    __tablename__ = "eeg_feature_windows"
    __table_args__ = (
        # 세션 내 초 인덱스는 유일 — 중복 ingestion 방지
        UniqueConstraint("session_id", "window_index", name="uq_eeg_feature_window"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False,
    )
    # 0-based 초 인덱스 (윈도우 순서)
    window_index: Mapped[int] = mapped_column(Integer, nullable=False)
    # 윈도우 품질 — valid/degraded/invalid (§A4.4 게이트 집계 입력)
    quality: Mapped[str] = mapped_column(String(10), default="valid", nullable=False)

    # ── 7지표 산출 원천 feature (전부 nullable — null 보존) ──
    focus_index: Mapped[float | None] = mapped_column(Float)
    cognitive_load: Mapped[float | None] = mapped_column(Float)
    relaxation_index: Mapped[float | None] = mapped_column(Float)
    stress_index: Mapped[float | None] = mapped_column(Float)
    emotional_stability: Mapped[float | None] = mapped_column(Float)
    total_neural_activity: Mapped[float | None] = mapped_column(Float)
    faa: Mapped[float | None] = mapped_column(Float)
    hemispheric_balance: Mapped[float | None] = mapped_column(Float)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
