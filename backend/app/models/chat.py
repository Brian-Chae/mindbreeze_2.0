"""채팅 모델 — ChatRoom, ChatMessage, ChatMessageRead, ChatReport, ChatBlock"""

import uuid
from datetime import datetime

from sqlalchemy import String, DateTime, Text, ForeignKey, Integer, Index, func, UniqueConstraint, CheckConstraint
from sqlalchemy.dialects.postgresql import UUID, ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class ChatRoom(Base):
    __tablename__ = "chat_rooms"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="CASCADE"), unique=True, nullable=True
    )
    room_type: Mapped[str] = mapped_column(String(20), nullable=False, default="session")
    host_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    # SDD-090: 사용자 지정 표시 이름 — direct 방의 name(=내담자 ID 저장소)을 보존하기 위한 별도 컬럼
    display_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    messages = relationship("ChatMessage", back_populates="room", cascade="all, delete-orphan")


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    room_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("chat_rooms.id", ondelete="CASCADE"), nullable=False
    )
    sender_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    type: Mapped[str] = mapped_column(String(20), nullable=False, default="text")  # text/image/file/system
    content: Mapped[str | None] = mapped_column(Text)
    file_url: Mapped[str | None] = mapped_column(String(500))
    event_type: Mapped[str | None] = mapped_column(String(40))  # system 메시지 이벤트 종류
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # ── 읽음 상태 추적 (Phase 3a) ──
    read_by: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True, default=None)
    recipient_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    room = relationship("ChatRoom", back_populates="messages")


class ChatRoomParticipant(Base):
    __tablename__ = "chat_room_participants"

    room_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("chat_rooms.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ChatMessageRead(Base):
    __tablename__ = "chat_message_reads"
    # MB2-ORM-IDX-09: PK 가 (message_id, user_id) 라 user_id 단독 필터를 커버하지 못한다.
    #   user_id 기준 조회·조인용 보조 인덱스로 접근 경로를 인덱스화한다.
    __table_args__ = (Index("ix_chat_message_reads_user_id", "user_id", "message_id"),)

    message_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("chat_messages.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), primary_key=True)
    read_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ChatReport(Base):
    """SDD-220: 채팅 신고 — 신고 즉시 같은 트랜잭션에서 상호 차단(ChatBlock)과 운영 알림 outbox 가 생긴다."""

    __tablename__ = "chat_reports"
    __table_args__ = (
        # 같은 신고자의 같은 operation 재전송은 새 행을 만들지 않는다(멱등).
        UniqueConstraint("reporter_id", "operation_key", name="uq_chat_reports_reporter_operation"),
        Index("ix_chat_reports_reported_user_id", "reported_user_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    reporter_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    reported_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    room_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("chat_rooms.id", ondelete="SET NULL"), nullable=True
    )
    message_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("chat_messages.id", ondelete="SET NULL"), nullable=True
    )
    reason: Mapped[str | None] = mapped_column(String(40), nullable=True)
    # 증거 보존용 메시지 본문 사본(최대 500자). 개인정보 복제본이므로 탈퇴 삭제 대상에 포함한다.
    message_excerpt: Mapped[str | None] = mapped_column(Text, nullable=True)
    operation_key: Mapped[str] = mapped_column(String(100), nullable=False)
    # 처리 상태: submitted(접수) → withdrawn(신고자 철회). 관리자 처리 상태(resolved 등)는 철회 불가.
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="submitted", server_default="submitted")
    withdrawn_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ChatBlock(Base):
    """SDD-220: 상호 차단 — 두 사용자를 (user_low_id < user_high_id) 로 정규화해 pair 당 1행만 둔다."""

    __tablename__ = "chat_blocks"
    __table_args__ = (
        UniqueConstraint("user_low_id", "user_high_id", name="uq_chat_blocks_pair"),
        CheckConstraint("user_low_id < user_high_id", name="ck_chat_blocks_pair_order"),
        Index("ix_chat_blocks_user_high_id", "user_high_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_low_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    user_high_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    # 차단을 일으킨 사람(신고자)과 근거 신고
    blocker_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    report_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("chat_reports.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
