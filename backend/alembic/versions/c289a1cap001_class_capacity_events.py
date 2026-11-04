"""SDD-289: class_capacity_events 테이블 추가 (가산) — 정원 늘리기 감사 기록.

- downgrade: 테이블 drop (감사 기록만 사라지며 이미 늘어난 정원은 그대로).
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "c289a1cap001"
down_revision = "c264e0ec7ed1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "class_capacity_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("class_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("classes.id"), nullable=False),
        sa.Column("actor_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("old_capacity", sa.Integer(), nullable=False),
        sa.Column("new_capacity", sa.Integer(), nullable=False),
        sa.Column("promoted_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("operation_key", sa.String(100), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_class_capacity_events_class_id", "class_capacity_events", ["class_id"])


def downgrade() -> None:
    op.drop_index("ix_class_capacity_events_class_id", table_name="class_capacity_events")
    op.drop_table("class_capacity_events")
