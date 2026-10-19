"""SDD-214: 명상 클래스군 모델 (classes · class_instructors · class_members · class_member_events)

컬럼 정의의 정본은 specs/sdd-214-class-structure-phase1/schema-contract.md. 열거 값 CHECK 는 PG 마이그레이션(053)에만 있다.
Phase 1 에서는 세션 생성 경로가 classes·class_instructors 를 쓰고, class_members·class_member_events 는 비어 있다.
"""

import uuid
from datetime import date, datetime

from sqlalchemy import (
    Boolean, Date, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, event, func, text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Class(Base):
    __tablename__ = "classes"
    __table_args__ = (
        # 클래스 코드는 활성 클래스 사이에서만 유일하다(종료·취소·보관·숨김 제외). 세션의 uq_sessions_active_access_code 와 같은 의미.
        Index(
            "uq_classes_active_access_code",
            "access_code",
            unique=True,
            postgresql_where=text(
                "access_code IS NOT NULL AND hidden_at IS NULL AND status NOT IN ('completed', 'cancelled', 'archived')"
            ),
            sqlite_where=text(
                "access_code IS NOT NULL AND hidden_at IS NULL AND status NOT IN ('completed', 'cancelled', 'archived')"
            ),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=True, index=True
    )
    organization_attribution_known: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    title: Mapped[str | None] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text)
    schedule_mode: Mapped[str] = mapped_column(String(10), nullable=False, default="fixed", server_default="fixed")  # fixed, rolling
    planned_session_count: Mapped[int | None] = mapped_column(Integer)
    # draft, active, completed, cancelled, archived
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="active", server_default="active", index=True)
    capacity: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    participant_mode: Mapped[str] = mapped_column(String(20), nullable=False, default="one_on_one", server_default="one_on_one")
    linkband_mode: Mapped[str] = mapped_column(String(20), nullable=False, default="none", server_default="none")
    location_type: Mapped[str] = mapped_column(String(20), nullable=False, default="offline", server_default="offline")
    location_address: Mapped[str | None] = mapped_column(String(300))
    default_duration_min: Mapped[int] = mapped_column(Integer, nullable=False)
    record_audio: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    record_video: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    chat_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    sfu_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    reminder_offsets: Mapped[list] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
    recurrence_rule: Mapped[dict | None] = mapped_column(JSONB)
    assignment_rule: Mapped[dict | None] = mapped_column(JSONB)
    draft_schedule: Mapped[dict | None] = mapped_column(JSONB)
    ends_on: Mapped[date | None] = mapped_column(Date)
    generation_cursor: Mapped[date | None] = mapped_column(Date)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    archived_from_status: Mapped[str | None] = mapped_column(String(12))
    access_code: Mapped[str | None] = mapped_column(String(6))
    legacy_access_code: Mapped[str | None] = mapped_column(String(6))
    # 삭제는 숨김(보존 전환). 값이 있으면 모든 ORM 조회에서 제외된다(app/core/database.py).
    hidden_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class ClassInstructor(Base):
    __tablename__ = "class_instructors"
    # (class_id, user_id) 는 sessions 복합 FK 의 참조 대상이다. 제거는 행 삭제가 아니라 status='removed' (soft).
    __table_args__ = (UniqueConstraint("class_id", "user_id", name="uq_class_instructors_class_user"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    class_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("classes.id", ondelete="RESTRICT"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    role: Mapped[str] = mapped_column(String(10), nullable=False, default="lead", server_default="lead")  # lead, assistant, guest
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="active", server_default="active")  # active, removed
    scope_session_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="SET NULL"), nullable=True
    )
    added_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    removed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ClassMember(Base):
    __tablename__ = "class_members"
    __table_args__ = (
        # NULL(비회원)은 서로 다른 값으로 취급되므로 비회원 다중 등록이 허용된다.
        UniqueConstraint("class_id", "user_id", name="uq_class_members_class_user"),
        Index("ix_class_members_class_status", "class_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    class_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("classes.id", ondelete="RESTRICT"), nullable=False
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True)
    kind: Mapped[str] = mapped_column(String(10), nullable=False, default="member", server_default="member")  # member, guest
    # invited, waitlisted, active, completed, left, removed, declined
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    # host_invite, code, email_invite, waitlist_promotion
    joined_via: Mapped[str] = mapped_column(String(20), nullable=False)
    guest_name: Mapped[str | None] = mapped_column(String(100))
    gender: Mapped[str | None] = mapped_column(String(20))
    birth_date: Mapped[date | None] = mapped_column(Date)
    report_email: Mapped[str | None] = mapped_column(String(320))
    pii_scrubbed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    waitlist_position: Mapped[int | None] = mapped_column(Integer)
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    activated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    left_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    removed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    first_session_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="SET NULL"), nullable=True
    )
    report_included_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    notice_ack_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    notice_version: Mapped[str | None] = mapped_column(String(20))
    entry_ver: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class ClassMemberEvent(Base):
    """멤버십 상태 이력(append-only). FK 를 두지 않아 클래스·멤버가 정리된 뒤에도 이력이 남는다."""

    __tablename__ = "class_member_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    class_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    member_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    from_status: Mapped[str | None] = mapped_column(String(20))
    to_status: Mapped[str] = mapped_column(String(20), nullable=False)
    actor_kind: Mapped[str] = mapped_column(String(20), nullable=False)  # self, host, system, platform_admin
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


@event.listens_for(ClassMemberEvent, "before_update")
def _forbid_member_event_update(mapper, connection, target) -> None:  # noqa: ARG001
    raise ValueError("클래스 멤버 이력은 수정할 수 없습니다(append-only)")


@event.listens_for(ClassMemberEvent, "before_delete")
def _forbid_member_event_delete(mapper, connection, target) -> None:  # noqa: ARG001
    raise ValueError("클래스 멤버 이력은 삭제할 수 없습니다(append-only)")
