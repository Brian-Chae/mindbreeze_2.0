"""EEG-QRY-01: eeg_feature_windows (session_id, participant_id, created_at) 복합 인덱스

Revision ID: e036a0000032
Revises: e036a0000031
Create Date: 2026-10-06

최신 윈도우 조회(latest_feature_window)·시간순 조회(feature_windows_chronological)는 created_at
정렬을 사용하지만 (session_id, participant_id, created_at) 인덱스가 없어 참가자 윈도우를 전부
로딩한 뒤 정렬했다. 복합 인덱스로 인덱스 범위 스캔 + LIMIT 1 을 지원한다.
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "e036a0000032"
down_revision: Union[str, Sequence[str], None] = "e036a0000031"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


INDEX_NAME = "ix_eeg_feature_window_participant_created"


def upgrade() -> None:
    """Upgrade schema."""
    op.create_index(
        INDEX_NAME,
        "eeg_feature_windows",
        ["session_id", "participant_id", "created_at"],
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(INDEX_NAME, table_name="eeg_feature_windows")
