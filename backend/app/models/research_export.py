"""연구 DB 내보내기 배치 (SDD-209 B13 / BE-R3 · MG-7).

연구 동의(미철회) 참여자의 **비식별 데이터만** 번들(Parquet + manifest.json)로 만들어 S3 스테이징 prefix 에 올리고,
Spark(DGX)가 pull 한 뒤 ack API 로 회신하면 ``research_consents.export_state`` 가 ``acked`` 가 된다.
이 SDD 에서 Spark 실접속·실전송은 하지 않는다(스테이징 포맷·ack API·계약 테스트까지).

- ``research_export_batches``: 배치 1건 = 세션 1개의 번들. 상태 ``built → uploaded → acked`` | ``failed`` | ``cancelled``.
- ``research_export_items``: 배치 안의 연구 동의 건별 항목. append-only — 재내보내기는 새 revision 항목이 추가될 뿐
  기존 항목(해시)은 바뀌지 않는다.
세션/참여자/동의 FK 를 두지 않는다(CASCADE 금지) — 스크럽·숨김·삭제 뒤에도 적재 이력과 철회 대조가 남아야 한다.
번들 안에는 원본 세션/참여자 UUID 가 없다(가명 ID 만).
"""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Index, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class ResearchExportBatch(Base):
    __tablename__ = "research_export_batches"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # 내부 추적용 — 번들 안에는 싣지 않는다.
    session_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    # building | uploaded | acked | failed | cancelled
    status: Mapped[str] = mapped_column(String(15), nullable=False, default="building")
    key_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # S3 스테이징 prefix(예: research-export/<batch_id>/) 와 manifest 해시/바이트
    prefix: Mapped[str | None] = mapped_column(String(200), nullable=True)
    manifest_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    total_bytes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    file_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    attempt: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    alerted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    uploaded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    acked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ResearchExportItem(Base):
    __tablename__ = "research_export_items"
    __table_args__ = (
        UniqueConstraint("batch_id", "consent_id", name="uq_research_export_item"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    batch_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    consent_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    research_subject_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    # 같은 동의 건의 N 번째 내보내기(1부터). 재내보내기는 새 revision.
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    # 이 항목에 담긴 데이터(원자료 행 요약)의 sha256 — 같으면 재내보내기를 건너뛴다(중복 제거).
    content_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    rows: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    # SDD-244 M3: 연구 bundle item 스키마 버전·신호 범위(기존 행 NULL = v2 기존 범주)
    bundle_schema_version: Mapped[str | None] = mapped_column(String(20), nullable=True)
    signal_scope: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class ResearchSignalReceipt(Base):
    """SDD-244 M3: 신호·산출물 종류별 연구 반출 ACK 영수증(스키마만 — 서비스는 후속 Task).

    EEG ACK 가 PPG/ACC·파형·indices 이관 성공을 뜻하지 않도록 (신호, 산출물 종류, manifest revision, hash)를 키로 한다.
    기존 research_consents.export_state 와 독립이며 과거 EEG ACK 를 다른 신호로 backfill 하지 않는다.
    세션/참여자 FK 를 두지 않는다(CASCADE 로 연구 증거가 사라지면 안 된다).
    """

    __tablename__ = "research_signal_receipts"
    __table_args__ = (
        UniqueConstraint(
            "participant_id", "signal", "artifact_kind", "manifest_revision", "manifest_sha256",
            name="uq_research_signal_receipt",
        ),
        CheckConstraint("signal IN ('eeg','ppg','acc')", name="ck_research_signal_receipt_signal"),
        CheckConstraint("manifest_revision > 0", name="ck_research_signal_receipt_revision"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    participant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    consent_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    signal: Mapped[str] = mapped_column(String(8), nullable=False)
    artifact_kind: Mapped[str] = mapped_column(String(20), nullable=False)
    manifest_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    manifest_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    schema_version: Mapped[str] = mapped_column(String(20), nullable=False)
    batch_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    acked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class ObjectDeletionOutbox(Base):
    """SDD-244 M3: 객체 삭제 outbox(스키마만). 삭제 결정→원장 commit→객체 삭제 재시도→완료 기록.

    tombstone 에는 payload·재식별 값을 담지 않는다(종류·크기·해시 정도). 객체 삭제 실패를 DB 성공으로 감추지 않도록
    state 가 done 이 될 때까지 재시도 대상이다.
    """

    __tablename__ = "object_deletion_outbox"
    __table_args__ = (
        UniqueConstraint("object_key", name="uq_object_deletion_outbox_key"),
        CheckConstraint("state IN ('pending','in_progress','done','failed_permanent')", name="ck_object_deletion_state"),
        Index("ix_object_deletion_outbox_due", "state", "next_attempt_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    object_key: Mapped[str] = mapped_column(String(500), nullable=False)
    source_table: Mapped[str] = mapped_column(String(40), nullable=False)
    reason: Mapped[str] = mapped_column(String(40), nullable=False)
    state: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(String(200), nullable=True)
    tombstone: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
