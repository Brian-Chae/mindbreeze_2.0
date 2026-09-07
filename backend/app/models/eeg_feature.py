"""SDD-022/023 EEGFeatureWindow — 1초 단위 EEG feature 시계열.

하루밴드 리포트 엔진(eeg_metrics)이 소비하는 윈도우 단위 원천 feature 를 저장한다.
- SDD-022(P0): 서버 산출(포팅) 검증. 7지표 산출 원천 컬럼.
- SDD-023(P1): LINK BAND 실연동 ingestion. 밴드파워·게스트 참가자 식별 컬럼 추가.

null 보존 원칙: 산출 불가한 feature 는 NULL 로 저장하며 0 으로 치환하지 않는다.
"""

import uuid
from datetime import datetime

from sqlalchemy import Float, Integer, String, DateTime, ForeignKey, Index, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class EEGFeatureWindow(Base):
    __tablename__ = "eeg_feature_windows"
    __table_args__ = (
        # SDD-023: 참가자별 초 인덱스가 유일 — 그룹 세션에서 다수 참가자가 동일 초 인덱스를
        # 업로드해도 충돌하지 않으며, 동일 참가자의 재업로드(중복)는 방지한다.
        # SDD-026: play_group_id 를 제약에 포함 — pause/resume 으로 second_offset(window_index)가
        # 0 부터 재시작해도 실행 세그먼트가 다르면(play_group_id 상이) 충돌하지 않아 데이터가 보존된다.
        UniqueConstraint(
            "session_id", "participant_id", "play_group_id", "window_index",
            name="uq_eeg_feature_window",
        ),
        # SDD-028: batch key(window_index 범위) 조회·최신값 조회를 인덱스로 지원한다.
        # (session_id, participant_id, window_index) 복합 인덱스로 라이브·롤업의 참가자별
        # 윈도우 범위 스캔을 전체 스캔에서 인덱스 범위 스캔으로 전환한다.
        Index(
            "ix_eeg_feature_window_batch_key",
            "session_id", "participant_id", "window_index",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    # SDD-023: 게스트 참가자는 user_id 가 없으므로 nullable. 로그인 참가자만 채운다.
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True,
    )
    # SDD-023: 실연동 ingestion 의 소유 참가자(게스트 포함). 최신 윈도우 조회·게스트 명상에 사용.
    participant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("session_participants.id", ondelete="CASCADE"), nullable=True, index=True,
    )
    # SDD-026: 실행 세그먼트 식별자(play/resume 마다 새 값). pause/resume 시 window_index 재시작
    # 충돌을 방지한다. 레거시(미전달) 데이터는 NULL 로 남아 기존 window_index 멱등 동작을 유지한다.
    play_group_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    # 0-based 초 인덱스 (윈도우 순서)
    window_index: Mapped[int] = mapped_column(Integer, nullable=False)
    # 윈도우 품질 — valid/degraded/invalid (§A4.4 게이트 집계 입력)
    quality: Mapped[str] = mapped_column(String(10), default="valid", nullable=False)

    # SDD-023: 디바이스 원시 타임스탬프(ms epoch) — TimestampSynchronizer 동기화 값 (null 보존)
    device_timestamp_ms: Mapped[float | None] = mapped_column(Float)

    # ── 7지표 산출 원천 feature (전부 nullable — null 보존) ──
    focus_index: Mapped[float | None] = mapped_column(Float)
    cognitive_load: Mapped[float | None] = mapped_column(Float)
    relaxation_index: Mapped[float | None] = mapped_column(Float)
    stress_index: Mapped[float | None] = mapped_column(Float)
    emotional_stability: Mapped[float | None] = mapped_column(Float)
    total_neural_activity: Mapped[float | None] = mapped_column(Float)
    faa: Mapped[float | None] = mapped_column(Float)
    hemispheric_balance: Mapped[float | None] = mapped_column(Float)

    # ── SDD-023: 밴드파워·부가 지표 원천 feature (전부 nullable — null 보존) ──
    delta_power: Mapped[float | None] = mapped_column(Float)
    theta_power: Mapped[float | None] = mapped_column(Float)
    alpha_power: Mapped[float | None] = mapped_column(Float)
    beta_power: Mapped[float | None] = mapped_column(Float)
    gamma_power: Mapped[float | None] = mapped_column(Float)
    total_power: Mapped[float | None] = mapped_column(Float)
    meditation_level: Mapped[float | None] = mapped_column(Float)
    attention_level: Mapped[float | None] = mapped_column(Float)
    # 신호 품질 원시값(0~1). quality(valid/degraded/invalid) 문자열은 여기서 파생한다.
    signal_quality: Mapped[float | None] = mapped_column(Float)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
