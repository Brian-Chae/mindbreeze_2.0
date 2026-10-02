"""SDD-101 C1: audio/video 청크 멱등 — (session_id, chunk_index) UNIQUE 제약

Revision ID: e036a0000024
Revises: e036a0000023
Create Date: 2026-10-03 00:00:00.000000

네트워크 재시도로 인한 동일 청크 중복 업로드를 막기 위해 (session_id, chunk_index) UNIQUE 를
추가한다. 기존 중복 행은 최초 삽입(ctid 최소) 행만 남기고 격리한다.
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'e036a0000024'
down_revision: Union[str, Sequence[str], None] = 'e036a0000023'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # 기존 중복 격리 — (session_id, chunk_index) 중복 시 최초 행(ctid 최소)만 남긴다.
    op.execute(
        "DELETE FROM video_chunks a USING video_chunks b "
        "WHERE a.session_id = b.session_id AND a.chunk_index = b.chunk_index "
        "AND a.ctid > b.ctid"
    )
    op.execute(
        "DELETE FROM audio_chunks a USING audio_chunks b "
        "WHERE a.session_id = b.session_id AND a.chunk_index = b.chunk_index "
        "AND a.ctid > b.ctid"
    )
    op.create_unique_constraint(
        "uq_video_chunk_session_idx", "video_chunks", ["session_id", "chunk_index"]
    )
    op.create_unique_constraint(
        "uq_audio_chunk_session_idx", "audio_chunks", ["session_id", "chunk_index"]
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint("uq_video_chunk_session_idx", "video_chunks", type_="unique")
    op.drop_constraint("uq_audio_chunk_session_idx", "audio_chunks", type_="unique")
