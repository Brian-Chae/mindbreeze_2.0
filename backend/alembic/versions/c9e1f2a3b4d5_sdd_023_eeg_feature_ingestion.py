"""sdd-023 eeg feature ingestion: 실연동 컬럼 + 참가자별 유니크

Revision ID: c9e1f2a3b4d5
Revises: b2d8f1a4c093
Create Date: 2026-09-07

SDD-023: LINK BAND 실연동 ingestion 지원.
- participant_id 추가(게스트 포함 소유 참가자 식별) + user_id nullable(게스트)
- 밴드파워·부가 지표·신호품질 원천 컬럼 추가(전부 nullable — null 보존)
- 유니크 제약을 (session_id, participant_id, window_index)로 변경(그룹 세션 다참가자 허용)
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


# revision identifiers, used by Alembic.
revision: str = "c9e1f2a3b4d5"
down_revision: Union[str, Sequence[str], None] = "b2d8f1a4c093"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# SDD-023 에서 추가되는 nullable Float feature 컬럼
_NEW_FLOAT_COLUMNS = [
    "device_timestamp_ms",
    "delta_power",
    "theta_power",
    "alpha_power",
    "beta_power",
    "gamma_power",
    "total_power",
    "meditation_level",
    "attention_level",
    "signal_quality",
]


def upgrade() -> None:
    """Upgrade schema."""
    # 게스트 참가자는 user_id 가 없으므로 nullable 로 완화
    op.alter_column("eeg_feature_windows", "user_id", existing_type=UUID(as_uuid=True), nullable=True)

    # 소유 참가자(게스트 포함) 식별 컬럼
    op.add_column(
        "eeg_feature_windows",
        sa.Column("participant_id", UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_eeg_feature_windows_participant_id",
        "eeg_feature_windows",
        "session_participants",
        ["participant_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index(
        "ix_eeg_feature_windows_participant_id", "eeg_feature_windows", ["participant_id"],
    )

    # 밴드파워·부가 지표·신호품질 원천 컬럼 (전부 nullable)
    for col in _NEW_FLOAT_COLUMNS:
        op.add_column("eeg_feature_windows", sa.Column(col, sa.Float(), nullable=True))

    # 유니크 제약: 세션 전역 → 참가자별 (그룹 세션 다참가자 동시 업로드 허용)
    op.drop_constraint("uq_eeg_feature_window", "eeg_feature_windows", type_="unique")
    op.create_unique_constraint(
        "uq_eeg_feature_window",
        "eeg_feature_windows",
        ["session_id", "participant_id", "window_index"],
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint("uq_eeg_feature_window", "eeg_feature_windows", type_="unique")
    op.create_unique_constraint(
        "uq_eeg_feature_window",
        "eeg_feature_windows",
        ["session_id", "window_index"],
    )

    for col in reversed(_NEW_FLOAT_COLUMNS):
        op.drop_column("eeg_feature_windows", col)

    op.drop_index("ix_eeg_feature_windows_participant_id", table_name="eeg_feature_windows")
    op.drop_constraint("fk_eeg_feature_windows_participant_id", "eeg_feature_windows", type_="foreignkey")
    op.drop_column("eeg_feature_windows", "participant_id")

    op.alter_column("eeg_feature_windows", "user_id", existing_type=UUID(as_uuid=True), nullable=False)
