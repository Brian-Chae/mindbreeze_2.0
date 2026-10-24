"""SDD-244 M1 — 생체신호(EEG/PPG/ACC) 수집 스트림·세그먼트·gap·종료 의도·manifest revision 원장.

raw 청크 자체는 기존 eeg_raw_chunks(signal_type/segment_id 확장)에 둔다. 이 모듈은 청크를 묶는
수집 실행(stream)·재접속/시계 구간(segment)과 종료 시점의 완전성 판정(manifest revision)을 보관한다.
큰 배열은 DB에 복제하지 않는다(객체 저장소 + hash 참조).
"""
import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint, func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class BiosignalStream(Base):
    """수집 실행 1회(stream_id는 클라이언트가 만든 UUID 문자열)."""

    __tablename__ = "biosignal_streams"
    __table_args__ = (UniqueConstraint("session_id", "participant_id", "stream_id", name="uq_biosignal_stream"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    participant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("session_participants.id", ondelete="CASCADE"), nullable=False, index=True)
    stream_id: Mapped[str] = mapped_column(String(64), nullable=False)
    play_group_id: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class BiosignalSegment(Base):
    """stream 안의 재접속/clock reset/profile 변경 구간. 신호별 profile·rate·time_basis를 보존."""

    __tablename__ = "biosignal_segments"
    __table_args__ = (
        UniqueConstraint("stream_pk", "segment_id", "signal_type", name="uq_biosignal_segment"),
        CheckConstraint("signal_type IN ('eeg','ppg','acc')", name="ck_biosignal_segment_signal"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    stream_pk: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("biosignal_streams.id", ondelete="CASCADE"), nullable=False, index=True)
    segment_id: Mapped[str] = mapped_column(String(64), nullable=False)
    signal_type: Mapped[str] = mapped_column(String(8), nullable=False)
    profile_id: Mapped[str | None] = mapped_column(String(64))
    profile_hash: Mapped[str | None] = mapped_column(String(64))
    time_basis: Mapped[str | None] = mapped_column(String(20))
    rate_numerator: Mapped[int | None] = mapped_column(Integer)
    rate_denominator: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class BiosignalGapEvent(Base):
    """수집 gap 이벤트(멱등 수신). 보간/삭제 없이 원인·범위만 기록."""

    __tablename__ = "biosignal_gap_events"
    __table_args__ = (
        UniqueConstraint("session_id", "participant_id", "event_id", name="uq_biosignal_gap_event"),
        CheckConstraint("signal IN ('eeg','ppg','acc')", name="ck_biosignal_gap_signal"),
        Index("ix_biosignal_gap_seq", "session_id", "participant_id", "sequence"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False)
    participant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("session_participants.id", ondelete="CASCADE"), nullable=False)
    event_id: Mapped[str] = mapped_column(String(64), nullable=False)
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    signal: Mapped[str] = mapped_column(String(8), nullable=False)
    stream_id: Mapped[str] = mapped_column(String(64), nullable=False)
    segment_id: Mapped[str] = mapped_column(String(64), nullable=False)
    start_us: Mapped[int] = mapped_column(BigInteger, nullable=False)
    end_us: Mapped[int | None] = mapped_column(BigInteger)
    discovered_at_us: Mapped[int] = mapped_column(BigInteger, nullable=False)
    reason: Mapped[str] = mapped_column(String(32), nullable=False)
    observed_or_estimated: Mapped[str] = mapped_column(String(12), nullable=False)
    expected_samples: Mapped[int | None] = mapped_column(Integer)
    received_samples: Mapped[int | None] = mapped_column(Integer)
    reconnect_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    payload_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class BiosignalCloseIntent(Base):
    """종료 의도(멱등). 서버는 expected set을 ACK 원장과 대조해 manifest revision을 만든다."""

    __tablename__ = "biosignal_close_intents"
    __table_args__ = (UniqueConstraint("session_id", "participant_id", "intent_id", name="uq_biosignal_close_intent"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False)
    participant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("session_participants.id", ondelete="CASCADE"), nullable=False)
    intent_id: Mapped[str] = mapped_column(String(64), nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    payload_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class BiosignalManifestRevision(Base):
    """회차·참여자 manifest의 불변 revision. 후발 ACK는 새 revision을 만들고 기존 행은 수정하지 않는다."""

    __tablename__ = "biosignal_manifest_revisions"
    __table_args__ = (
        UniqueConstraint("session_id", "participant_id", "revision", name="uq_biosignal_manifest_revision"),
        CheckConstraint("revision > 0", name="ck_biosignal_manifest_revision_pos"),
        CheckConstraint("close_state IN ('pending_upload','partial','complete','unknown')", name="ck_biosignal_manifest_state"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    participant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("session_participants.id", ondelete="CASCADE"), nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    close_state: Mapped[str] = mapped_column(String(16), nullable=False)
    close_intent_id: Mapped[str | None] = mapped_column(String(64))
    # 내부 DTO(내부 ID 포함 가능). 공개 변환은 서비스에서 whitelist로 한다.
    content: Mapped[dict] = mapped_column(JSONB, nullable=False)
    content_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class BiosignalManifestCurrent(Base):
    """회차·참여자별 최신 revision 포인터(이 행만 갱신된다)."""

    __tablename__ = "biosignal_manifest_current"

    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="CASCADE"), primary_key=True)
    participant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("session_participants.id", ondelete="CASCADE"), primary_key=True)
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

