"""SDD-030 호흡수 nullable 컬럼 추가.

Revision ID: 8e30b17c920a
Revises: 4235a5871ac6
"""
from alembic import op
import sqlalchemy as sa

revision = "8e30b17c920a"
down_revision = "4235a5871ac6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """기존 행의 미측정 호흡수는 NULL로 유지한다."""
    op.add_column("eeg_feature_windows", sa.Column("respiratory_rate", sa.Float(), nullable=True))


def downgrade() -> None:
    """이번 변경으로 추가한 호흡수 컬럼만 제거한다."""
    op.drop_column("eeg_feature_windows", "respiratory_rate")
