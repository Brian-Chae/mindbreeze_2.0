"""SDD-048 서사 캐시에 생성 출처와 갱신 시각 추가.

Revision ID: e036a0000004
Revises: e036a0000003
"""
from alembic import op
import sqlalchemy as sa

revision = "e036a0000004"
down_revision = "e036a0000003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "narrative_cache",
        sa.Column("source", sa.String(length=8), server_default="llm", nullable=False),
    )
    op.add_column(
        "narrative_cache",
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("narrative_cache", "updated_at")
    op.drop_column("narrative_cache", "source")
