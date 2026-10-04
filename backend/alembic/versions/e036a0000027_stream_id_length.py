"""Fix: eeg_raw_chunks.stream_id 길이 64→128 — eeg:{session}:{participant}(77자) 422 해소

Revision ID: e036a0000027
Revises: e036a0000026
Create Date: 2026-10-04 00:00:00.000000

프론트 createStreamId 가 `eeg:{session_uuid}:{participant_uuid}` (77자) 를 생성하나
백엔드 스키마(max_length=64)·DB 컬럼(String(64))이 64자로 제한되어
eeg-raw/presign 422 Unprocessable Entity 가 발생했다. 128자로 확장한다.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'e036a0000027'
down_revision: Union[str, Sequence[str], None] = 'e036a0000026'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        'eeg_raw_chunks',
        'stream_id',
        existing_type=sa.String(64),
        type_=sa.String(128),
        existing_nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        'eeg_raw_chunks',
        'stream_id',
        existing_type=sa.String(128),
        type_=sa.String(64),
        existing_nullable=False,
    )
