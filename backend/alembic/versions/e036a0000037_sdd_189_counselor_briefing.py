"""SDD-189: AI 에이전트 상담사 채널 — 아침 일정 브리핑 · 저녁 상담 정리

- agent_counselor_settings: 상담사별 브리핑 시각·사용 여부 (user_id UNIQUE)
- agent_briefing_logs: (user_id, kind, briefing_date) UNIQUE 로 1일 1회 멱등 보장
- agent_relay_events.handled_at: 상담사가 처리 완료 표시한 시각(nullable)

Revision ID: e036a0000037
Revises: e036a0000036
Create Date: 2026-10-08
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers, used by Alembic.
revision: str = "e036a0000037"
down_revision: Union[str, Sequence[str], None] = "e036a0000036"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "agent_counselor_settings",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column(
            "morning_enabled", sa.Boolean(), nullable=False, server_default=sa.true()
        ),
        sa.Column("morning_time", sa.String(length=5), nullable=False, server_default="08:00"),
        sa.Column(
            "evening_enabled", sa.Boolean(), nullable=False, server_default=sa.true()
        ),
        sa.Column("evening_time", sa.String(length=5), nullable=False, server_default="21:00"),
        sa.Column(
            "skip_no_session_days", sa.Boolean(), nullable=False, server_default=sa.true()
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("user_id", name="uq_agent_counselor_settings_user"),
    )

    op.create_table(
        "agent_briefing_logs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        # morning | evening
        sa.Column("kind", sa.String(length=20), nullable=False),
        # 브리핑 기준일(KST) — 날짜 경계는 한국 시간으로 끊는다.
        sa.Column("briefing_date", sa.Date(), nullable=False),
        sa.Column("message_id", UUID(as_uuid=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint(
            "user_id", "kind", "briefing_date", name="uq_agent_briefing_log"
        ),
    )
    op.create_index("ix_agent_briefing_logs_user_id", "agent_briefing_logs", ["user_id"])

    # 상담사가 중계 이벤트를 처리 완료로 표시한 시각. null = 미처리(목록 상단 노출).
    op.add_column(
        "agent_relay_events",
        sa.Column("handled_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("agent_relay_events", "handled_at")

    op.drop_index("ix_agent_briefing_logs_user_id", table_name="agent_briefing_logs")
    op.drop_table("agent_briefing_logs")

    op.drop_table("agent_counselor_settings")
