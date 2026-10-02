"""SDD-101 C4: SessionRecord.video_expected_chunks — 클라이언트 선언 예상 청크 수

Revision ID: e036a0000025
Revises: e036a0000024
Create Date: 2026-10-03 00:00:00.000000

병합 50% 규칙의 정확한 분모로 사용한다(트레일링 누락 청크까지 감지).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'e036a0000025'
down_revision: Union[str, Sequence[str], None] = 'e036a0000024'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("session_records", sa.Column("video_expected_chunks", sa.Integer(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("session_records", "video_expected_chunks")
