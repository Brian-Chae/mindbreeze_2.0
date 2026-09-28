"""add chat_enabled to sessions

Revision ID: ae97d0a37430
Revises: e036a0000016
Create Date: 2026-09-28 23:54:12.773819

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'ae97d0a37430'
down_revision: Union[str, Sequence[str], None] = 'e036a0000016'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """클래스(세션) 실시간 채팅 사용 여부 — 상담사가 켜고 끈다.

    기본값 false: 기존 세션은 채팅이 꺼진 상태로 시작하며, 상담사가 명시적으로 켠다.
    """
    op.add_column(
        'sessions',
        sa.Column('chat_enabled', sa.Boolean(), nullable=False, server_default=sa.text('false')),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('sessions', 'chat_enabled')
