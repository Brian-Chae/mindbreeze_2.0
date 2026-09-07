"""sdd-022 eeg feature windows: 1초 단위 EEG feature 시계열 테이블

Revision ID: b2d8f1a4c093
Revises: a1c7e9f30b21
Create Date: 2026-09-07

SDD-022: 하루밴드 EEG 리포트 엔진(eeg_metrics)이 소비하는 윈도우 단위 원천 feature 를
저장한다. 7지표 산출 원천 컬럼은 전부 nullable — 산출 불가는 NULL 로 두고 0 치환 금지.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


# revision identifiers, used by Alembic.
revision: str = "b2d8f1a4c093"
down_revision: Union[str, Sequence[str], None] = "a1c7e9f30b21"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "eeg_feature_windows",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("session_id", UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", UUID(as_uuid=True), nullable=False),
        sa.Column("window_index", sa.Integer(), nullable=False),
        sa.Column("quality", sa.String(length=10), nullable=False, server_default="valid"),
        sa.Column("focus_index", sa.Float(), nullable=True),
        sa.Column("cognitive_load", sa.Float(), nullable=True),
        sa.Column("relaxation_index", sa.Float(), nullable=True),
        sa.Column("stress_index", sa.Float(), nullable=True),
        sa.Column("emotional_stability", sa.Float(), nullable=True),
        sa.Column("total_neural_activity", sa.Float(), nullable=True),
        sa.Column("faa", sa.Float(), nullable=True),
        sa.Column("hemispheric_balance", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["session_id"], ["sessions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.UniqueConstraint("session_id", "window_index", name="uq_eeg_feature_window"),
    )
    op.create_index(
        "ix_eeg_feature_windows_session_id", "eeg_feature_windows", ["session_id"],
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_eeg_feature_windows_session_id", table_name="eeg_feature_windows")
    op.drop_table("eeg_feature_windows")
