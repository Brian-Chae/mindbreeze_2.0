"""SDD-191: 안부 대화(체크인) · 상담사 전용 프로파일 · 조용한 위험 신호

- agent_checkin_enablements: 상담사가 내담자별로 켠 안부 스위치 (counselor_id, client_id) UNIQUE
- agent_checkin_prefs: 내담자의 안부 일시 중지 (client_id UNIQUE)
- agent_checkins: 안부 대화 1회분. closed_at null = 열린 체크인
- agent_profile_items: 상담사 전용 프로파일 항목 (ai_estimate|confirmed|dismissed)
- agent_risk_signals: 위험 신호(watch|high) — 상담사 전용, excerpt 최대 200자 저장

Revision ID: e036a0000039
Revises: e036a0000038
Create Date: 2026-10-08
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

# revision identifiers, used by Alembic.
revision: str = "e036a0000039"
down_revision: Union[str, Sequence[str], None] = "e036a0000038"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "agent_checkin_enablements",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("counselor_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("client_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint(
            "counselor_id", "client_id", name="uq_agent_checkin_enablement_pair"
        ),
    )
    op.create_index(
        "ix_agent_checkin_enablements_counselor_id",
        "agent_checkin_enablements",
        ["counselor_id"],
    )
    op.create_index(
        "ix_agent_checkin_enablements_client",
        "agent_checkin_enablements",
        ["client_id", "enabled"],
    )

    op.create_table(
        "agent_checkin_prefs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("client_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("paused", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("client_id", name="uq_agent_checkin_prefs_client"),
    )

    op.create_table(
        "agent_checkins",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("client_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("counselor_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        # no_response | hard_feeling | after_session | usual_time
        sa.Column("trigger", sa.String(length=20), nullable=False, server_default="no_response"),
        sa.Column(
            "started_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("turn_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("summary", sa.Text(), nullable=True),
        # better | same | watch — 숫자 척도를 쓰지 않는다.
        sa.Column("mood_direction", sa.String(length=10), nullable=True),
    )
    op.create_index("ix_agent_checkins_client_id", "agent_checkins", ["client_id"])
    op.create_index("ix_agent_checkins_counselor_id", "agent_checkins", ["counselor_id"])
    op.create_index(
        "ix_agent_checkins_client_started", "agent_checkins", ["client_id", "started_at"]
    )
    op.create_index("ix_agent_checkins_open", "agent_checkins", ["client_id", "closed_at"])

    op.create_table(
        "agent_profile_items",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("client_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("counselor_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        # sleep | stress | emotion | coping | people_events
        sa.Column("category", sa.String(length=20), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        # ai_estimate | confirmed | dismissed
        sa.Column("status", sa.String(length=20), nullable=False, server_default="ai_estimate"),
        # 근거 메시지 id 목록만 담는다 — 원문 문장은 저장하지 않는다.
        sa.Column("evidence", JSONB(), nullable=False, server_default="[]"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_agent_profile_items_client_id", "agent_profile_items", ["client_id"])
    op.create_index(
        "ix_agent_profile_items_counselor_id", "agent_profile_items", ["counselor_id"]
    )
    op.create_index(
        "ix_agent_profile_items_owner",
        "agent_profile_items",
        ["counselor_id", "client_id", "category"],
    )

    op.create_table(
        "agent_risk_signals",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("client_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("counselor_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column(
            "message_id",
            UUID(as_uuid=True),
            sa.ForeignKey("agent_messages.id", ondelete="SET NULL"),
            nullable=True,
        ),
        # watch | high
        sa.Column("level", sa.String(length=10), nullable=False),
        sa.Column("excerpt", sa.Text(), nullable=False),
        # open | handled
        sa.Column("status", sa.String(length=20), nullable=False, server_default="open"),
        sa.Column("handled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_agent_risk_signals_client_id", "agent_risk_signals", ["client_id"])
    op.create_index("ix_agent_risk_signals_counselor_id", "agent_risk_signals", ["counselor_id"])
    op.create_index(
        "ix_agent_risk_signals_owner_created",
        "agent_risk_signals",
        ["counselor_id", "created_at"],
    )
    op.create_index(
        "ix_agent_risk_signals_client_level",
        "agent_risk_signals",
        ["client_id", "level", "created_at"],
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_agent_risk_signals_client_level", table_name="agent_risk_signals")
    op.drop_index("ix_agent_risk_signals_owner_created", table_name="agent_risk_signals")
    op.drop_index("ix_agent_risk_signals_counselor_id", table_name="agent_risk_signals")
    op.drop_index("ix_agent_risk_signals_client_id", table_name="agent_risk_signals")
    op.drop_table("agent_risk_signals")

    op.drop_index("ix_agent_profile_items_owner", table_name="agent_profile_items")
    op.drop_index("ix_agent_profile_items_counselor_id", table_name="agent_profile_items")
    op.drop_index("ix_agent_profile_items_client_id", table_name="agent_profile_items")
    op.drop_table("agent_profile_items")

    op.drop_index("ix_agent_checkins_open", table_name="agent_checkins")
    op.drop_index("ix_agent_checkins_client_started", table_name="agent_checkins")
    op.drop_index("ix_agent_checkins_counselor_id", table_name="agent_checkins")
    op.drop_index("ix_agent_checkins_client_id", table_name="agent_checkins")
    op.drop_table("agent_checkins")

    op.drop_table("agent_checkin_prefs")

    op.drop_index(
        "ix_agent_checkin_enablements_client", table_name="agent_checkin_enablements"
    )
    op.drop_index(
        "ix_agent_checkin_enablements_counselor_id", table_name="agent_checkin_enablements"
    )
    op.drop_table("agent_checkin_enablements")
