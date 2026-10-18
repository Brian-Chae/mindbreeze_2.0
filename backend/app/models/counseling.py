"""SDD-214: 상담군 모델 (counseling_guests · counseling_relationships · counseling_relationship_counselors ·
counseling_relationship_events · guest_claim_events)

컬럼 정의의 정본은 specs/sdd-214-class-structure-phase1/schema-contract.md. CHECK 는 PG 마이그레이션(054)에만 있다.
Phase 1 에서는 세션 생성 경로가 호스트별 보관용 관계(is_placeholder)만 만들고, counseling_guests 등은 비어 있다.
"""

import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, event, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class CounselingGuest(Base):
    __tablename__ = "counseling_guests"
    __table_args__ = (
        # 같은 이메일이 서로 다른 상담사에게는 별개 행이다(상담사 간 기록 격리).
        Index(
            "uq_guest_email_per_counselor",
            "created_by_counselor_id",
            "email_norm",
            unique=True,
            postgresql_where=text("email_norm IS NOT NULL AND claimed_user_id IS NULL AND pii_scrubbed_at IS NULL"),
            sqlite_where=text("email_norm IS NOT NULL AND claimed_user_id IS NULL AND pii_scrubbed_at IS NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id"))
    created_by_counselor_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    display_name: Mapped[str | None] = mapped_column(String(100))
    email: Mapped[str | None] = mapped_column(String(320))
    email_norm: Mapped[str | None] = mapped_column(String(320), index=True)
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    gender: Mapped[str | None] = mapped_column(String(20))
    birth_date: Mapped[date | None] = mapped_column(Date)
    # 재방문 비밀의 SHA-256. 평문은 저장하지 않는다.
    reentry_secret_hash: Mapped[str | None] = mapped_column(String(64))
    reentry_ver: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    reentry_issued_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reentry_last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    privacy_consent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    privacy_notice_version: Mapped[str | None] = mapped_column(String(20))
    claimed_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    claim_method: Mapped[str | None] = mapped_column(String(20))  # email_otp, counselor_confirmed, admin
    pii_scrubbed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class CounselingRelationship(Base):
    __tablename__ = "counseling_relationships"
    __table_args__ = (
        Index(
            "uq_rel_active_pair", "counselor_id", "client_user_id", unique=True,
            postgresql_where=text("client_user_id IS NOT NULL AND status = 'active'"),
            sqlite_where=text("client_user_id IS NOT NULL AND status = 'active'"),
        ),
        Index(
            "uq_rel_guest", "client_guest_id", unique=True,
            postgresql_where=text("client_guest_id IS NOT NULL"),
            sqlite_where=text("client_guest_id IS NOT NULL"),
        ),
        Index(
            "uq_rel_placeholder", "counselor_id", unique=True,
            postgresql_where=text("is_placeholder"),
            sqlite_where=text("is_placeholder"),
        ),
        Index("ix_counseling_relationships_counselor_status", "counselor_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=True, index=True
    )
    organization_attribution_known: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    counselor_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    client_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True
    )
    client_guest_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("counseling_guests.id", ondelete="RESTRICT"), nullable=True
    )
    # 내담자가 아직 정해지지 않은 상담 세션을 담는 상담사별 보관용 관계(상담사당 1개)
    is_placeholder: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    # client_counselor_links 와는 약결합. 이 모듈은 링크를 만들지 않는다.
    link_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("client_counselor_links.id", ondelete="SET NULL"), nullable=True
    )
    title: Mapped[str | None] = mapped_column(String(200))
    modality_default: Mapped[str | None] = mapped_column(String(20))  # clinical, hypnosis
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="active", server_default="active")
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    closed_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    close_reason: Mapped[str | None] = mapped_column(String(40))
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reopened_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    predecessor_relationship_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("counseling_relationships.id", ondelete="RESTRICT"), nullable=True
    )
    default_duration_min: Mapped[int | None] = mapped_column(Integer)
    location_type: Mapped[str | None] = mapped_column(String(20))
    location_address: Mapped[str | None] = mapped_column(String(300))
    linkband_mode: Mapped[str | None] = mapped_column(String(20))
    record_audio: Mapped[bool | None] = mapped_column(Boolean)
    record_video: Mapped[bool | None] = mapped_column(Boolean)
    reminder_offsets: Mapped[list | None] = mapped_column(JSONB)
    access_code: Mapped[str | None] = mapped_column(String(6))
    legacy_access_code: Mapped[str | None] = mapped_column(String(6))
    # 삭제는 숨김(보존 전환). 값이 있으면 모든 ORM 조회에서 제외된다(app/core/database.py).
    hidden_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class CounselingRelationshipCounselor(Base):
    """관계의 담당 상담사 이력. sessions 복합 FK 의 참조 대상이다."""

    __tablename__ = "counseling_relationship_counselors"
    __table_args__ = (
        UniqueConstraint("relationship_id", "counselor_id", name="uq_rel_counselors_rel_counselor"),
        Index("ix_rel_counselors_counselor_id", "counselor_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    relationship_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("counseling_relationships.id", ondelete="RESTRICT"), nullable=False
    )
    counselor_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="active", server_default="active")
    from_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    to_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class CounselingRelationshipEvent(Base):
    """상담 관계 상태 전이 이력(append-only, FK 없음)."""

    __tablename__ = "counseling_relationship_events"
    __table_args__ = (Index("ix_rel_events_relationship_id", "relationship_id"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    relationship_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    from_status: Mapped[str | None] = mapped_column(String(10))
    to_status: Mapped[str] = mapped_column(String(10), nullable=False)
    actor_kind: Mapped[str] = mapped_column(String(20), nullable=False)  # counselor, client, system, platform_admin
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class GuestClaimEvent(Base):
    """비회원 → 회원 전환 이력(append-only, FK 없음). 건수만 남기고 개인정보는 기록하지 않는다."""

    __tablename__ = "guest_claim_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    guest_client_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    method: Mapped[str] = mapped_column(String(20), nullable=False)  # email_otp, counselor_confirmed, admin
    rewritten_counts: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


for _model, _label in ((CounselingRelationshipEvent, "상담 관계 이력"), (GuestClaimEvent, "비회원 전환 이력")):

    def _forbid_update(mapper, connection, target, _label=_label) -> None:  # noqa: ARG001
        raise ValueError(f"{_label}은 수정할 수 없습니다(append-only)")

    def _forbid_delete(mapper, connection, target, _label=_label) -> None:  # noqa: ARG001
        raise ValueError(f"{_label}은 삭제할 수 없습니다(append-only)")

    event.listen(_model, "before_update", _forbid_update)
    event.listen(_model, "before_delete", _forbid_delete)
