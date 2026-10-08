"""SDD-188: AI 에이전트 양방향 채널 모델.

채널 분리가 이 모델의 핵심 전제다. AgentConversation 은 (사용자, 채널) 단위 대화방이며
내담자 채널(`client`)과 상담사 채널(`counselor`)은 서로의 메시지를 볼 수 없다.
내담자→상담사로 넘길 정보는 메시지를 직접 공유하지 않고 AgentRelayEvent(중계 이벤트)로만
옮긴다(상담사 열람 화면은 SDD-189).

AgentDeliveryLog 는 "같은 알림을 두 번 보내지 않는다"를 DB 유니크 제약으로 보장한다.
예약 노티 스윕(매 1분)과 리포트 승인 훅이 같은 대상을 재실행해도 1건만 남는다.
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class AgentConversation(Base):
    """사용자별 AI 대화방 — (user_id, channel) 당 1개."""

    __tablename__ = "agent_conversations"
    __table_args__ = (
        UniqueConstraint("user_id", "channel", name="uq_agent_conversation_user_channel"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    # "client" = 내담자:AI 채널, "counselor" = 상담사:AI 채널(SDD-189)
    channel: Mapped[str] = mapped_column(String(20), nullable=False, default="client")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), onupdate=func.now())

    messages = relationship(
        "AgentMessage", back_populates="conversation", cascade="all, delete-orphan"
    )


class AgentMessage(Base):
    """대화방의 한 메시지. cta 는 메시지에 붙은 행동 버튼 목록(JSONB)이다."""

    __tablename__ = "agent_messages"
    __table_args__ = (
        Index("ix_agent_messages_conversation_created", "conversation_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("agent_conversations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # agent | user | system
    sender: Mapped[str] = mapped_column(String(10), nullable=False)
    # reminder_3h | reminder_1h | schedule_changed | report_ready | report_chat
    # | feedback_thanks | free
    kind: Mapped[str] = mapped_column(String(30), nullable=False, default="free")
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # AgentCta 목록. 빈 목록이면 버튼 없는 일반 메시지다.
    cta: Mapped[list] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
    # 메시지가 가리키는 대상 — session | report | None
    ref_type: Mapped[str | None] = mapped_column(String(20))
    ref_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    # 내담자가 읽은 시각. null 이면 미읽음(미읽음 배지 집계 대상).
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )

    conversation = relationship("AgentConversation", back_populates="messages")


class AgentRelayEvent(Base):
    """내담자 채널 → 상담사에게 넘기는 중계 이벤트.

    대화 원문을 상담사 채널에 직접 노출하지 않고, 목적이 정해진 이벤트로만 옮긴다.
    단 사후 피드백(kind="feedback")의 자유 서술은 D10 결정에 따라 요약·순화하지 않고
    payload["texts"] 에 원문 그대로 쌓는다.
    """

    __tablename__ = "agent_relay_events"
    __table_args__ = (
        Index("ix_agent_relay_events_target_created", "target_user_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # feedback | schedule_change_request | ack
    kind: Mapped[str] = mapped_column(String(30), nullable=False)
    source_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    # 전달 대상 상담사. 세션 host 를 넣는다(없으면 null).
    target_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True
    )
    session_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=True, index=True
    )
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    # pending(미열람) → read(상담사 열람, SDD-189)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class AgentDeliveryLog(Base):
    """에이전트 선발화(먼저 거는 메시지) 발송 로그 — 중복 발송 차단용.

    (kind, ref_id, offset_min, user_id) 유니크. 예약 노티는 offset_min 에 시점(180/60)을,
    리포트 알림은 0 을, 일정 정정 안내는 "새 예약 시각의 분 단위 epoch"를 넣어
    같은 변경에 대한 정정이 1회만 나가도록 한다.
    payload 에는 발송 당시의 사실(예: announced_at)을 남겨 일정 변경 감지에 쓴다.
    """

    __tablename__ = "agent_delivery_logs"
    __table_args__ = (
        UniqueConstraint(
            "kind", "ref_id", "offset_min", "user_id", name="uq_agent_delivery_log"
        ),
        Index("ix_agent_delivery_logs_ref", "ref_id", "kind"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    kind: Mapped[str] = mapped_column(String(30), nullable=False)
    # 대상 엔티티 id (세션 또는 리포트)
    ref_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    offset_min: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    payload: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
