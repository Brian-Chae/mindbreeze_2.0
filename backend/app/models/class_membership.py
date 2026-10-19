"""SDD-217: 출석·개인 보강·guest 자격·동의 및 presence의 가산 저장소.

자격 원문은 저장하지 않는다. 감사 이력은 원본 FK 삭제에 연쇄 삭제되지 않는다.
"""
import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean, CheckConstraint, DateTime, ForeignKey, ForeignKeyConstraint, Index,
    Integer, String, Text, UniqueConstraint, event, func, text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class ClassAttendanceEvent(Base):
    __tablename__ = 'class_attendance_events'
    __table_args__ = (
        CheckConstraint("old_status IS NULL OR old_status IN ('expected','attended','absent','excused','withdrawn')", name='ck_class_attendance_events_old'),
        CheckConstraint("new_status IN ('expected','attended','absent','excused','withdrawn')", name='ck_class_attendance_events_new'),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    class_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    session_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    participant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    member_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    old_status: Mapped[str | None] = mapped_column(String(20))
    new_status: Mapped[str] = mapped_column(String(20), nullable=False)
    actor_kind: Mapped[str] = mapped_column(String(20), nullable=False)
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    reason: Mapped[str | None] = mapped_column(Text)
    operation_key: Mapped[str] = mapped_column(String(100), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class ClassMakeupAssignment(Base):
    __tablename__ = 'class_makeup_assignments'
    __table_args__ = (
        CheckConstraint("status IN ('reserved','cancelled','completed')", name='ck_class_makeup_assignments_status'),
        CheckConstraint('source_session_id <> target_session_id AND source_participant_id <> target_participant_id', name='ck_class_makeup_assignments_distinct'),
        ForeignKeyConstraint(['source_session_id', 'source_participant_id'],
            ['session_participants.session_id', 'session_participants.id'], name='fk_class_makeup_source_pair', ondelete='RESTRICT'),
        ForeignKeyConstraint(['target_session_id', 'target_participant_id'],
            ['session_participants.session_id', 'session_participants.id'], name='fk_class_makeup_target_pair', ondelete='RESTRICT'),
        Index('uq_class_makeup_assignments_active_source', 'source_participant_id', unique=True,
              postgresql_where=text("status IN ('reserved','completed')"), sqlite_where=text("status IN ('reserved','completed')")),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    class_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey('classes.id', ondelete='RESTRICT'), index=True)
    member_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey('class_members.id', ondelete='RESTRICT'), index=True)
    source_participant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    source_session_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey('sessions.id', ondelete='RESTRICT'))
    target_participant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    target_session_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey('sessions.id', ondelete='RESTRICT'), index=True)
    status: Mapped[str] = mapped_column(String(20), default='reserved', server_default='reserved')
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ClassGuestCredential(Base):
    __tablename__ = 'class_guest_credentials'
    __table_args__ = (
        CheckConstraint("scope IN ('activity','read')", name='ck_class_guest_credentials_scope'),
        CheckConstraint('entry_ver >= 0', name='ck_class_guest_credentials_entry_ver'),
        Index('ix_class_guest_credentials_expires_at', 'expires_at'),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    class_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey('classes.id', ondelete='RESTRICT'), index=True)
    member_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey('class_members.id', ondelete='RESTRICT'), index=True)
    scope: Mapped[str] = mapped_column(String(10))
    entry_ver: Mapped[int] = mapped_column(Integer, default=0, server_default='0')
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ClassGuestRecovery(Base):
    __tablename__ = 'class_guest_recoveries'
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    class_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey('classes.id', ondelete='RESTRICT'), index=True)
    member_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey('class_members.id', ondelete='RESTRICT'), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    issued_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey('users.id', ondelete='RESTRICT'))
    reason: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ClassGuestMerge(Base):
    __tablename__ = 'class_guest_merges'
    __table_args__ = (CheckConstraint('source_member_id <> target_member_id', name='ck_class_guest_merges_distinct'),)
    # 감사 값은 FK 없이 보존한다. source 중복 병합은 유일성으로 차단한다.
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    class_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), index=True)
    source_member_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), unique=True)
    target_member_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), index=True)
    actor_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    reason: Mapped[str] = mapped_column(Text)
    preview_fingerprint: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ClassMemberOperation(Base):
    __tablename__ = 'class_member_operations'
    __table_args__ = (UniqueConstraint('member_id', 'operation_key', name='uq_class_member_operations_member_key'),)
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    member_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey('class_members.id', ondelete='RESTRICT'))
    operation_key: Mapped[str] = mapped_column(String(100))
    request_hash: Mapped[str] = mapped_column(String(64))
    result: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ClassGuestJoinOperation(Base):
    __tablename__ = 'class_guest_join_operations'
    __table_args__ = (UniqueConstraint('class_id', 'operation_key', name='uq_class_guest_join_operations_class_key'),)
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    class_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey('classes.id', ondelete='RESTRICT'))
    operation_key: Mapped[str] = mapped_column(String(100))
    request_hash: Mapped[str] = mapped_column(String(64))
    member_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey('class_members.id', ondelete='RESTRICT'))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ClassMemberConsentEvent(Base):
    __tablename__ = 'class_member_consent_events'
    __table_args__ = (CheckConstraint("choice IN ('report','research','reminder')", name='ck_class_member_consent_events_choice'),)
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    class_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), index=True)
    member_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), index=True)
    choice: Mapped[str] = mapped_column(String(10))
    value: Mapped[bool] = mapped_column(Boolean)
    notice_version: Mapped[str | None] = mapped_column(String(20))
    selected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    origin_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), default=uuid.uuid4)
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    operation_key: Mapped[str] = mapped_column(String(100))


class SessionPresenceLease(Base):
    __tablename__ = 'session_presence_leases'
    __table_args__ = (
        UniqueConstraint('session_id', 'id', name='uq_session_presence_leases_session_socket'),
        ForeignKeyConstraint(['session_id', 'participant_id'],
            ['session_participants.session_id', 'session_participants.id'], name='fk_session_presence_lease_pair', ondelete='RESTRICT'),
        Index('ix_session_presence_leases_participant_expiry', 'participant_id', 'expires_at'),
    )
    # Socket.IO sid는 UUID가 아니므로 충분한 길이의 문자열로 저장한다.
    id: Mapped[str] = mapped_column(String(200), primary_key=True)
    session_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey('sessions.id', ondelete='RESTRICT'), index=True)
    participant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


def _forbid_audit_change(mapper, connection, target) -> None:  # noqa: ARG001
    raise ValueError('클래스 감사 이력은 수정·삭제할 수 없습니다(append-only)')


for _audit_model in (ClassAttendanceEvent, ClassGuestMerge, ClassMemberConsentEvent):
    event.listen(_audit_model, 'before_update', _forbid_audit_change)
    event.listen(_audit_model, 'before_delete', _forbid_audit_change)
