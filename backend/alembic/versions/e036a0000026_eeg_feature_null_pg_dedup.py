"""SDD-109: EEGFeatureWindow play_group_id NULL 부분 유니크 인덱스 — 동시 저장 중복 차단

Revision ID: e036a0000026
Revises: e036a0000025
Create Date: 2026-10-03 00:00:00.000000

FE가 play_group_id를 미전송하여 실제 모든 feature 윈도우의 play_group_id가 NULL이다.
기존 유니크 제약 (session_id, participant_id, play_group_id, window_index)은
PostgreSQL/SQLite에서 NULL != NULL 로 무효화되어 동시 WS+REST 저장 시 중복 행이 생긴다.
NULL 세그먼트 전용 부분 유니크 인덱스를 추가해 멱등성을 DB 레벨에서 보장한다.
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'e036a0000026'
down_revision: Union[str, Sequence[str], None] = 'e036a0000025'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """기존 NULL 세그먼트 중복을 dedup 하고 부분 유니크 인덱스를 추가한다."""
    # 1) 기존 중복 제거 — 같은 (session, participant, window_index) 중 가장 오래된 행(id 최소)만 남긴다.
    op.execute(
        """
        DELETE FROM eeg_feature_windows a
        USING eeg_feature_windows b
        WHERE a.play_group_id IS NULL
          AND b.play_group_id IS NULL
          AND a.session_id = b.session_id
          AND a.participant_id = b.participant_id
          AND a.window_index = b.window_index
          AND a.id > b.id
        """
    )
    # 2) NULL play_group_id 세그먼트 전용 부분 유니크 인덱스 — 동시 저장 중복을 DB 레벨에서 차단.
    op.execute(
        """
        CREATE UNIQUE INDEX uq_eeg_feature_window_null_pg
        ON eeg_feature_windows (session_id, participant_id, window_index)
        WHERE play_group_id IS NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_eeg_feature_window_null_pg")
