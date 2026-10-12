"""sdd-026 live session p0 hardening: 상태 버전 + 배터리 + play_group_id

Revision ID: a1c2e3f40261
Revises: c9e1f2a3b4d5
Create Date: 2026-09-08

SDD-026: 라이브 세션 P0 안전망(권한·상태 계약·품질 정합).
- sessions.state_version: 상태전이마다 +1, join snapshot / session_state_changed 이벤트 버전
- session_participants.band_battery: 밴드 배터리(%) 최신값(null 보존)
- eeg_feature_windows.play_group_id: 실행 세그먼트 식별자(pause/resume window_index 충돌 방지)
  + 유니크 제약을 (session_id, participant_id, play_group_id, window_index)로 확장
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "a1c2e3f40261"
down_revision: Union[str, Sequence[str], None] = "c9e1f2a3b4d5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # 상태 계약 버전 (기존 행은 0 으로 백필)
    op.add_column(
        "sessions",
        sa.Column("state_version", sa.Integer(), nullable=False, server_default="0"),
    )

    # 밴드 배터리(%) 최신값 — null 보존
    op.add_column(
        "session_participants",
        sa.Column("band_battery", sa.Integer(), nullable=True),
    )

    # 실행 세그먼트 식별자 + 인덱스
    op.add_column(
        "eeg_feature_windows",
        sa.Column("play_group_id", sa.String(length=64), nullable=True),
    )
    op.create_index(
        "ix_eeg_feature_windows_play_group_id", "eeg_feature_windows", ["play_group_id"],
    )

    # 유니크 제약: 참가자별 초 인덱스 → 참가자·실행세그먼트별 초 인덱스
    op.drop_constraint("uq_eeg_feature_window", "eeg_feature_windows", type_="unique")
    op.create_unique_constraint(
        "uq_eeg_feature_window",
        "eeg_feature_windows",
        ["session_id", "participant_id", "play_group_id", "window_index"],
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint("uq_eeg_feature_window", "eeg_feature_windows", type_="unique")
    op.create_unique_constraint(
        "uq_eeg_feature_window",
        "eeg_feature_windows",
        ["session_id", "participant_id", "window_index"],
    )
    op.drop_index("ix_eeg_feature_windows_play_group_id", table_name="eeg_feature_windows")
    op.drop_column("eeg_feature_windows", "play_group_id")

    op.drop_column("session_participants", "band_battery")
    op.drop_column("sessions", "state_version")
