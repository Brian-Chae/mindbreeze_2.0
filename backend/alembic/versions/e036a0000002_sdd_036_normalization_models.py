"""SDD-036 표준 분포 모델과 단일 활성 제약 추가.

Revision ID: e036a0000002
Revises: e036a0000001
"""

from alembic import op
import sqlalchemy as sa

revision = "e036a0000002"
down_revision = "e036a0000001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "normalization_models",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("n_samples", sa.Integer(), nullable=False),
        sa.Column("params", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    op.create_index(
        "uq_normalization_models_active",
        "normalization_models",
        ["is_active"],
        unique=True,
        postgresql_where=sa.text("is_active = true"),
        sqlite_where=sa.text("is_active = 1"),
    )


def downgrade() -> None:
    op.drop_index("uq_normalization_models_active", table_name="normalization_models")
    op.drop_table("normalization_models")
