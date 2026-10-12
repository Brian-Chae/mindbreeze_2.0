"""SDD-036 정규화 기준 데이터와 단일 활성 제약 추가.

Revision ID: e036a0000001
Revises: 8e30b17c920a
"""

from alembic import op
import sqlalchemy as sa

revision = "e036a0000001"
down_revision = "8e30b17c920a"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "normalization_baselines",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("device_id", sa.String(), nullable=True),
        sa.Column("pipeline_version", sa.String(), nullable=True),
        sa.Column("gender", sa.String(), nullable=True),
        sa.Column("birth_date", sa.String(), nullable=True),
        sa.Column("closed", sa.JSON(), nullable=False),
        sa.Column("open", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    op.create_index(
        "uq_normalization_baselines_active",
        "normalization_baselines",
        ["is_active"],
        unique=True,
        postgresql_where=sa.text("is_active = true"),
        sqlite_where=sa.text("is_active = 1"),
    )


def downgrade() -> None:
    op.drop_index("uq_normalization_baselines_active", table_name="normalization_baselines")
    op.drop_table("normalization_baselines")
