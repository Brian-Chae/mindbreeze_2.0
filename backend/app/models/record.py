"""SessionRecord, EEGRecord, EEGRawChunk, Report, AudioChunk Models"""

import uuid
from datetime import datetime

from sqlalchemy import String, Integer, Float, Text, Boolean, DateTime, ForeignKey, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class SessionRecord(Base):
    __tablename__ = "session_records"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("sessions.id"), unique=True, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="idle", nullable=False)  # idle/recording/processing/completed/failed
    transcript: Mapped[str | None] = mapped_column(Text)
    ai_summary: Mapped[dict] = mapped_column(JSONB, default=dict)
    counselor_notes: Mapped[str | None] = mapped_column(Text)
    markers: Mapped[list] = mapped_column(JSONB, default=list)
    is_edited: Mapped[bool] = mapped_column(Boolean, default=False)
    edit_history: Mapped[list] = mapped_column(JSONB, default=list)
    audio_s3_key: Mapped[str | None] = mapped_column(String(500))
    recording_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    recording_ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    session = relationship("Session", back_populates="record")


class AudioChunk(Base):
    __tablename__ = "audio_chunks"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False)
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class EEGRecord(Base):
    __tablename__ = "eeg_records"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("sessions.id"), nullable=False)
    # SDD-027: 게스트 raw 보존을 위해 user_id nullable. 소유는 participant_id 로 식별한다.
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    # SDD-027: 참여자 기반 소유(게스트 포함) — 업로드 소유 검증(resolve_upload_participant)과 정합.
    participant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("session_participants.id", ondelete="CASCADE"), nullable=True, index=True,
    )
    # SDD-027: 실행 세그먼트 식별자(play/resume). raw chunk 묶음을 세그먼트 단위로 구분한다.
    play_group_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    s3_key: Mapped[str] = mapped_column(String(500), nullable=False)
    duration_sec: Mapped[int | None] = mapped_column(Integer)
    sample_rate: Mapped[int] = mapped_column(Integer, default=250)
    # SDD-027: 이 레코드에 속한 raw chunk(업로드 확인 완료) 개수. ack 시 증가한다.
    file_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    analysis_result: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    session = relationship("Session", back_populates="eeg_records")


class EEGRawChunk(Base):
    """SDD-027: LINK BAND raw EEG 청크 manifest.

    SDK raw → 로컬 영속 큐 → presigned PUT → ack(확인) 경로의 서버 측 원장이다.
    실제 raw 바이트는 S3(object_key)에 저장되고, 이 테이블은 메타데이터·업로드 상태만 보유한다.
    게스트도 participant_id 로 소유되며 user_id 는 nullable 이다(게스트 raw 지원).
    """

    __tablename__ = "eeg_raw_chunks"
    __table_args__ = (
        # 참여자·스트림별 청크 인덱스가 유일 — 동일 청크 재발급/중복 ack 를 멱등 처리한다.
        UniqueConstraint(
            "session_id", "participant_id", "stream_id", "chunk_index",
            name="uq_eeg_raw_chunk",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    # 게스트 raw 지원 — 소유는 participant_id, user_id 는 로그인 참가자만 채운다.
    participant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("session_participants.id", ondelete="CASCADE"), nullable=True, index=True,
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    # 스트림 식별자(디바이스/세그먼트 단위). 기본 'default'.
    stream_id: Mapped[str] = mapped_column(String(64), default="default", nullable=False)
    # 스트림 내 0-based 청크 순번
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    # 청크 시간 범위(디바이스 ms epoch) — null 보존
    start_ms: Mapped[float | None] = mapped_column(Float)
    end_ms: Mapped[float | None] = mapped_column(Float)
    # 샘플레이트/채널/단위/스키마 — raw 재해석에 필요한 계약 메타데이터
    sample_rate: Mapped[int] = mapped_column(Integer, default=250, nullable=False)
    channel_count: Mapped[int] = mapped_column(Integer, default=2, nullable=False)
    unit: Mapped[str] = mapped_column(String(20), default="uV", nullable=False)
    schema_version: Mapped[str] = mapped_column(String(20), default="1.0", nullable=False)
    # 무결성 검증용 체크섬(예: sha256) — 클라이언트 제공, null 보존
    checksum: Mapped[str | None] = mapped_column(String(128))
    size_bytes: Mapped[int | None] = mapped_column(Integer)
    # S3 객체 키
    object_key: Mapped[str] = mapped_column(String(500), nullable=False)
    # 업로드 상태: pending(presigned 발급) → uploaded(ack) / failed
    upload_status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    uploaded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Report(Base):
    __tablename__ = "reports"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("sessions.id"), nullable=False)
    # SDD-027: 게스트 리포트 지원 — user_id nullable, 소유는 participant_id 로 보완한다.
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    participant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("session_participants.id", ondelete="CASCADE"), nullable=True, index=True,
    )
    type: Mapped[str] = mapped_column(String(20), nullable=False)
    content: Mapped[dict] = mapped_column(JSONB, nullable=False)
    # SDD-027: 리포트 상태머신 — pending_analysis → pending_review(승인 게이트) → completed / error
    status: Mapped[str] = mapped_column(String(30), default="pending_analysis", nullable=False)
    # SDD-027: 품질 게이트에서 파생한 데이터 신뢰도(high/medium/low). EEG 미측정이면 null(치환 금지).
    data_credibility: Mapped[str | None] = mapped_column(String(20))
    pdf_url: Mapped[str | None] = mapped_column(String(500))
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    session = relationship("Session", back_populates="reports")
