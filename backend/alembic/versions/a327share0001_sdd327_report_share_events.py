"""SDD-327 report_share_events: 리포트 공유 메일 발송 이력(가산형)

Revision ID: a327share0001
Revises: e326a1band001
Create Date: 2026-11-13 12:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "a327share0001"
down_revision: Union[str, Sequence[str], None] = "e326a1band001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "report_share_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("report_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("reports.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sender_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("sender_role", sa.String(20), nullable=False),
        # 주소 원문은 저장하지 않는다 — 마스킹 표기 + 해시만.
        sa.Column("recipient_masked", sa.String(255), nullable=False),
        sa.Column("recipient_hash", sa.String(64), nullable=False),
        sa.Column("jti", sa.String(64), nullable=True),
        sa.Column("attached", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("status", sa.String(20), nullable=False, server_default="queued"),
        sa.Column("error_code", sa.String(50), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("status IN ('queued','sent','failed')", name="ck_report_share_events_status"),
    )
    op.create_index("ix_report_share_events_report_created", "report_share_events", ["report_id", sa.text("created_at DESC")])
    op.create_index("ix_report_share_events_sender_created", "report_share_events", ["sender_user_id", "created_at"])
    op.create_index("ix_report_share_events_jti", "report_share_events", ["jti"])


def downgrade() -> None:
    op.drop_index("ix_report_share_events_jti", table_name="report_share_events")
    op.drop_index("ix_report_share_events_sender_created", table_name="report_share_events")
    op.drop_index("ix_report_share_events_report_created", table_name="report_share_events")
    op.drop_table("report_share_events")
