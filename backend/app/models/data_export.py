"""SDD-071 분석용 내보내기 작업과 민감정보 접근 감사 원장."""
import uuid
from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class DataExportJob(Base):
    __tablename__ = 'data_export_jobs'
    __table_args__ = (
        UniqueConstraint('user_id', 'idempotency_key', name='uq_data_export_idempotency'),
        CheckConstraint("status IN ('queued','preparing','ready','ready_with_warnings','failed','expired','cancelled')", name='ck_data_export_status'),
        # SDD-243: 일괄(data_center) 작업은 대상이 data_export_targets 에 있어 단건 컬럼이 비어 있을 수 있다. 단건은 기존 필수 유지.
        CheckConstraint("kind <> 'single' OR (session_id IS NOT NULL AND participant_id IS NOT NULL AND consent_eeg IS NOT NULL)",
                        name='ck_data_export_single_required'),
        CheckConstraint("kind IN ('single','data_center')", name='ck_data_export_kind'),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey('users.id'), nullable=False, index=True)
    requester_role: Mapped[str] = mapped_column(String(20), nullable=False)
    # 원천 삭제 후에도 S3 정리 원장을 보존한다. 접근 시 실제 원천 존재를 재검사한다.
    session_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    participant_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    include: Mapped[list] = mapped_column(JSONB, nullable=False)
    purpose: Mapped[str] = mapped_column(Text, nullable=False)
    idempotency_key: Mapped[str | None] = mapped_column(String(128))
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default='queued', index=True)
    schema_version: Mapped[str] = mapped_column(String(30), nullable=False, default='data-export-1.0')
    consent_policy_version: Mapped[str] = mapped_column(String(50), nullable=False, default='p0-service-analysis-1')
    consent_eeg: Mapped[bool | None] = mapped_column(nullable=True)
    snapshot_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    object_key: Mapped[str | None] = mapped_column(String(500))
    size_bytes: Mapped[int | None] = mapped_column(BigInteger)
    checksum: Mapped[str | None] = mapped_column(String(64))
    completed_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    warnings: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    error_code: Mapped[str | None] = mapped_column(String(60))
    # ── SDD-243 데이터 센터 일괄 작업(M243-1). 모두 nullable/default 라 구버전 서버와 공존한다. ──
    kind: Mapped[str] = mapped_column(String(20), nullable=False, default='single', server_default='single')
    scope_org_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)
    export_scope: Mapped[str | None] = mapped_column(String(20))
    identity: Mapped[str | None] = mapped_column(String(20))
    purpose_type: Mapped[str | None] = mapped_column(String(20))
    reason: Mapped[str | None] = mapped_column(Text)
    policy_version: Mapped[str | None] = mapped_column(String(50))
    policy_hash: Mapped[str | None] = mapped_column(String(64))
    preview_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    target_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default='1')
    participant_total: Mapped[int | None] = mapped_column(Integer)
    auth_epoch: Mapped[int | None] = mapped_column(Integer)
    lease_owner: Mapped[str | None] = mapped_column(String(64))
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    fencing_token: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default='0')
    expected_part_count: Mapped[int | None] = mapped_column(Integer)


class DataExportPreview(Base):
    """SDD-243 preview 원장: 고정 대상·정책·요청 해시. 토큰 원문은 저장하지 않고 해시만 보관한다."""
    __tablename__ = 'data_export_previews'
    __table_args__ = (
        Index('ix_data_export_previews_actor_created', 'actor_id', 'created_at'),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    actor_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey('users.id'), nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    scope_org_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    export_scope: Mapped[str] = mapped_column(String(20), nullable=False)
    target_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    purpose_type: Mapped[str] = mapped_column(String(20), nullable=False)
    identity: Mapped[str] = mapped_column(String(20), nullable=False)
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    request: Mapped[dict] = mapped_column(JSONB, nullable=False)
    as_of: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    session_count: Mapped[int] = mapped_column(Integer, nullable=False)
    participant_count: Mapped[int] = mapped_column(Integer, nullable=False)
    estimated_bytes: Mapped[int | None] = mapped_column(BigInteger)
    estimated_part_count: Mapped[int | None] = mapped_column(Integer)
    exclusions: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    exclusion_counts: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    policy_version: Mapped[str] = mapped_column(String(50), nullable=False)
    policy_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    consumed_job_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class DataExportTarget(Base):
    """preview 가 고정한 (회차, 참여자, manifest revision). 원천 삭제로 cascade 되지 않도록 FK 를 두지 않는다."""
    __tablename__ = 'data_export_targets'
    __table_args__ = (
        UniqueConstraint('job_id', 'session_id', 'participant_id', name='uq_data_export_target_job'),
        UniqueConstraint('preview_id', 'session_id', 'participant_id', name='uq_data_export_target_preview'),
        Index('ix_data_export_targets_job_ordinal', 'job_id', 'ordinal'),
        Index('ix_data_export_targets_preview_ordinal', 'preview_id', 'ordinal'),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    preview_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey('data_export_previews.id'))
    job_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey('data_export_jobs.id'))
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    session_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    participant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    manifest_revision: Mapped[int | None] = mapped_column(Integer)
    source_deadline: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    consent_state: Mapped[str | None] = mapped_column(String(20))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class DataExportPart(Base):
    """SDD-243 ZIP part(M243-2). object 참조는 API 로 노출하지 않는다."""
    __tablename__ = 'data_export_parts'
    __table_args__ = (
        UniqueConstraint('job_id', 'part_no', name='uq_data_export_part_no'),
        CheckConstraint('part_no >= 1', name='ck_data_export_part_no'),
        CheckConstraint('size_bytes IS NULL OR (size_bytes >= 0 AND size_bytes <= 1000000000)', name='ck_data_export_part_size'),
        CheckConstraint("status IN ('pending','building','ready','failed','expired')", name='ck_data_export_part_status'),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey('data_export_jobs.id'), nullable=False, index=True)
    part_no: Mapped[int] = mapped_column(Integer, nullable=False)
    object_key: Mapped[str | None] = mapped_column(String(500))
    object_version: Mapped[str | None] = mapped_column(String(200))
    size_bytes: Mapped[int | None] = mapped_column(BigInteger)
    checksum: Mapped[str | None] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(20), nullable=False, default='pending', server_default='pending')
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class DataExportDispatchOutbox(Base):
    """SDD-243 큐 적재 outbox(M243-2): job 생성 트랜잭션에 함께 커밋되고 cron 이 재전달한다."""
    __tablename__ = 'data_export_dispatch_outbox'
    __table_args__ = (
        CheckConstraint("status IN ('pending','delivering','published')", name='ck_data_export_outbox_status'),
        Index('ix_data_export_outbox_status_next', 'status', 'next_attempt_at'),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey('data_export_jobs.id'), nullable=False, unique=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default='pending', server_default='pending')
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default='0')
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class DataExportAudit(Base):
    """대상 삭제 이후에도 감사 보존: 외부키 없이 식별자만 기록하며 URL·생체값은 저장하지 않는다."""
    __tablename__ = 'data_export_audits'
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    export_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    session_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    participant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    purpose: Mapped[str] = mapped_column(Text, nullable=False)
    policy_version: Mapped[str] = mapped_column(String(50), nullable=False)
    event: Mapped[str] = mapped_column(String(40), nullable=False)
    result: Mapped[str] = mapped_column(String(60), nullable=False)
    size_bytes: Mapped[int | None] = mapped_column(BigInteger)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
