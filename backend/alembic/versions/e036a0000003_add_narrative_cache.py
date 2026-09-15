"""SDD-047 방향 패턴 기반 리포트 서사 캐시 추가.

Revision ID: e036a0000003
Revises: e036a0000002
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "e036a0000003"
down_revision = "e036a0000002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "narrative_cache",
        sa.Column("signature", sa.String(length=6), nullable=False),
        sa.Column("narrative", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("signature"),
    )


def downgrade() -> None:
    op.drop_table("narrative_cache")
