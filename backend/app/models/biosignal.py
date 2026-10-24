"""SDD-244 M1 — 생체신호(EEG/PPG/ACC) 수집 스트림·세그먼트·gap·종료 의도·manifest revision 원장.

raw 청크 자체는 기존 eeg_raw_chunks(signal_type/segment_id 확장)에 둔다. 이 모듈은 청크를 묶는
수집 실행(stream)·재접속/시계 구간(segment)과 종료 시점의 완전성 판정(manifest revision)을 보관한다.
큰 배열은 DB에 복제하지 않는다(객체 저장소 + hash 참조).
"""
import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger, CheckConstraint, DateTime, Float, ForeignKey, Index, Integer, String, UniqueConstraint, func, text,
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


class BiosignalArtifact(Base):
    """raw 가 아닌 산출물(feature/raw_derived/indices/normalization/algorithm)의 업로드·검증 원장.

    본문은 객체 저장소(내용 주소 key)에 있고 이 행은 메타·ACK 상태·scope·순번만 가진다.
    """

    __tablename__ = "biosignal_artifacts"
    __table_args__ = (
        UniqueConstraint("session_id", "participant_id", "artifact_alias", name="uq_biosignal_artifact_alias"),
        CheckConstraint("artifact_kind IN ('feature','raw_derived','indices','normalization','algorithm')", name="ck_biosignal_artifact_kind"),
        CheckConstraint("upload_status IN ('pending','uploaded','failed')", name="ck_biosignal_artifact_status"),
        CheckConstraint("row_count >= 0 AND sequence >= 0 AND size_bytes > 0", name="ck_biosignal_artifact_counts"),
        # 같은 scope+순번 슬롯에는 한 내용만 존재한다(NULL scope 도 같은 값으로 취급)
        Index(
            "uq_biosignal_artifact_slot", "session_id", "participant_id", "artifact_kind",
            func.coalesce(text("stream_id"), text("''")), func.coalesce(text("segment_id"), text("''")),
            func.coalesce(text("signal"), text("''")), func.coalesce(text("view_instance_id"), text("''")), "sequence",
            unique=True,
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    participant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("session_participants.id", ondelete="CASCADE"), nullable=False)
    artifact_alias: Mapped[str] = mapped_column(String(64), nullable=False)
    artifact_kind: Mapped[str] = mapped_column(String(20), nullable=False)
    signal: Mapped[str | None] = mapped_column(String(8))
    stream_id: Mapped[str | None] = mapped_column(String(64))
    segment_id: Mapped[str | None] = mapped_column(String(64))
    view_instance_id: Mapped[str | None] = mapped_column(String(64))
    play_group_id: Mapped[str | None] = mapped_column(String(64))
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    first_sequence: Mapped[int | None] = mapped_column(Integer)
    last_sequence: Mapped[int | None] = mapped_column(Integer)
    row_count: Mapped[int] = mapped_column(Integer, nullable=False)
    content_encoding: Mapped[str] = mapped_column(String(10), default="identity", nullable=False)
    schema_version: Mapped[str] = mapped_column(String(40), nullable=False)
    checksum: Mapped[str] = mapped_column(String(64), nullable=False)
    uncompressed_sha256: Mapped[str | None] = mapped_column(String(64))
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    time_from_us: Mapped[int | None] = mapped_column(BigInteger)
    time_to_us: Mapped[int | None] = mapped_column(BigInteger)
    # 90일 raw-equivalent(raw_derived) / feature 정책 / 메타 정책 구분
    retention_class: Mapped[str] = mapped_column(String(20), nullable=False)
    object_key: Mapped[str] = mapped_column(String(500), nullable=False)
    object_version_id: Mapped[str | None] = mapped_column(String(200))
    upload_status: Mapped[str] = mapped_column(String(10), default="pending", nullable=False)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    failure_reason: Mapped[str | None] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class BiosignalFeatureAlias(Base):
    """FeatureRecord.feature_id_alias → 포함 artifact (객체를 파싱하지 않고 업로드 요청의 목록으로 색인)."""

    __tablename__ = "biosignal_feature_aliases"
    __table_args__ = (UniqueConstraint("session_id", "participant_id", "feature_alias", name="uq_biosignal_feature_alias"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False)
    participant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("session_participants.id", ondelete="CASCADE"), nullable=False)
    feature_alias: Mapped[str] = mapped_column(String(64), nullable=False)
    artifact_pk: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("biosignal_artifacts.id", ondelete="CASCADE"), nullable=False, index=True)


class DisplaySnapshot(Base):
    """당시 화면 6지표 1Hz 검색 원장(정본 snapshot 은 indices artifact 객체). stream/view/second 당 1행."""

    __tablename__ = "display_snapshots"
    __table_args__ = (
        UniqueConstraint(
            "session_id", "participant_id", "stream_alias", "view_instance_alias", "second_index",
            name="uq_display_snapshot",
        ),
        Index("ix_display_snapshots_participant_time", "session_id", "participant_id", "t_rel_ms"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False)
    participant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("session_participants.id", ondelete="CASCADE"), nullable=False)
    artifact_pk: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("biosignal_artifacts.id", ondelete="CASCADE"), nullable=False, index=True)
    stream_alias: Mapped[str] = mapped_column(String(64), nullable=False)
    view_instance_alias: Mapped[str] = mapped_column(String(64), nullable=False)
    view_instance_id: Mapped[str | None] = mapped_column(String(64))
    view_kind: Mapped[str] = mapped_column(String(24), nullable=False)
    second_index: Mapped[int] = mapped_column(Integer, nullable=False)
    t_rel_ms: Mapped[float] = mapped_column(Float, nullable=False)
    play_group_id: Mapped[str | None] = mapped_column(String(64))
    window_index: Mapped[int | None] = mapped_column(Integer)
    displayed_at_us: Mapped[int | None] = mapped_column(BigInteger)
    render_status: Mapped[str] = mapped_column(String(16), nullable=False)
    source: Mapped[str] = mapped_column(String(20), nullable=False)
    display_match: Mapped[str] = mapped_column(String(12), nullable=False)  # true/false/unverified
    focus_value: Mapped[int | None] = mapped_column(Integer)
    relaxation_value: Mapped[int | None] = mapped_column(Integer)
    emotional_value: Mapped[int | None] = mapped_column(Integer)
    bpm_value: Mapped[int | None] = mapped_column(Integer)
    respiration_value: Mapped[int | None] = mapped_column(Integer)
    hrv_value: Mapped[int | None] = mapped_column(Integer)  # SDNN(ms)
    normalization_hash: Mapped[str | None] = mapped_column(String(64))
    # 6지표가 가리킨 feature_id_alias 목록 — 종료 판정에서 해석 가능 여부를 검사한다
    source_feature_aliases: Mapped[list | None] = mapped_column(JSONB)
    display_pipeline_version: Mapped[str | None] = mapped_column(String(80))
    unavailable_reason: Mapped[str | None] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class NormalizationSnapshotRow(Base):
    """정규화 모델 snapshot(content-addressed). 모델 변경은 새 행이며 과거 기록에 최신 모델을 적용하지 않는다."""

    __tablename__ = "normalization_snapshots"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    params_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    model_id_alias: Mapped[str] = mapped_column(String(64), nullable=False)
    version: Mapped[str] = mapped_column(String(80), nullable=False)
    formula_version: Mapped[str] = mapped_column(String(80), nullable=False)
    content: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
