"""SDD-188: AI 에이전트 코어 + 내담자 채널

- agent_conversations: (user_id, channel) 단위 AI 대화방
- agent_messages: 대화 메시지 + CTA(JSONB)
- agent_relay_events: 내담자 → 상담사 중계 이벤트
- agent_delivery_logs: 선발화 중복 발송 차단 (kind, ref_id, offset_min, user_id) UNIQUE
- sessions.location_address: 오프라인 클래스 방문 주소(D8)

Revision ID: e036a0000036
Revises: e036a0000035
Create Date: 2026-10-08
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

# revision identifiers, used by Alembic.
revision: str = "e036a0000036"
down_revision: Union[str, Sequence[str], None] = "e036a0000035"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "agent_conversations",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("channel", sa.String(length=20), nullable=False, server_default="client"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("user_id", "channel", name="uq_agent_conversation_user_channel"),
    )
    op.create_index("ix_agent_conversations_user_id", "agent_conversations", ["user_id"])

    op.create_table(
        "agent_messages",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "conversation_id",
            UUID(as_uuid=True),
            sa.ForeignKey("agent_conversations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("sender", sa.String(length=10), nullable=False),
        sa.Column("kind", sa.String(length=30), nullable=False, server_default="free"),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("cta", JSONB(), nullable=False, server_default="[]"),
        sa.Column("ref_type", sa.String(length=20), nullable=True),
        sa.Column("ref_id", UUID(as_uuid=True), nullable=True),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_agent_messages_conversation_id", "agent_messages", ["conversation_id"])
    op.create_index("ix_agent_messages_created_at", "agent_messages", ["created_at"])
    op.create_index(
        "ix_agent_messages_conversation_created",
        "agent_messages",
        ["conversation_id", "created_at"],
    )

    op.create_table(
        "agent_relay_events",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("kind", sa.String(length=30), nullable=False),
        sa.Column(
            "source_user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False
        ),
        sa.Column(
            "target_user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True
        ),
        sa.Column(
            "session_id",
            UUID(as_uuid=True),
            sa.ForeignKey("sessions.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("payload", JSONB(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_agent_relay_events_source_user_id", "agent_relay_events", ["source_user_id"])
    op.create_index("ix_agent_relay_events_target_user_id", "agent_relay_events", ["target_user_id"])
    op.create_index("ix_agent_relay_events_session_id", "agent_relay_events", ["session_id"])
    op.create_index(
        "ix_agent_relay_events_target_created",
        "agent_relay_events",
        ["target_user_id", "created_at"],
    )

    op.create_table(
        "agent_delivery_logs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("kind", sa.String(length=30), nullable=False),
        sa.Column("ref_id", UUID(as_uuid=True), nullable=False),
        sa.Column("offset_min", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("payload", JSONB(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint(
            "kind", "ref_id", "offset_min", "user_id", name="uq_agent_delivery_log"
        ),
    )
    op.create_index("ix_agent_delivery_logs_user_id", "agent_delivery_logs", ["user_id"])
    op.create_index("ix_agent_delivery_logs_ref", "agent_delivery_logs", ["ref_id", "kind"])

    # D8: 오프라인 클래스 방문 주소 (온라인은 null)
    op.add_column("sessions", sa.Column("location_address", sa.String(length=300), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("sessions", "location_address")

    op.drop_index("ix_agent_delivery_logs_ref", table_name="agent_delivery_logs")
    op.drop_index("ix_agent_delivery_logs_user_id", table_name="agent_delivery_logs")
    op.drop_table("agent_delivery_logs")

    op.drop_index("ix_agent_relay_events_target_created", table_name="agent_relay_events")
    op.drop_index("ix_agent_relay_events_session_id", table_name="agent_relay_events")
    op.drop_index("ix_agent_relay_events_target_user_id", table_name="agent_relay_events")
    op.drop_index("ix_agent_relay_events_source_user_id", table_name="agent_relay_events")
    op.drop_table("agent_relay_events")

    op.drop_index("ix_agent_messages_conversation_created", table_name="agent_messages")
    op.drop_index("ix_agent_messages_created_at", table_name="agent_messages")
    op.drop_index("ix_agent_messages_conversation_id", table_name="agent_messages")
    op.drop_table("agent_messages")

    op.drop_index("ix_agent_conversations_user_id", table_name="agent_conversations")
    op.drop_table("agent_conversations")
