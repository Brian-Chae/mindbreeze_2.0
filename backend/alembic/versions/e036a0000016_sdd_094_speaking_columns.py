"""SDD-094 발언권 관리 — session_participants 에 raise_hand/speaking 컬럼 추가

Revision ID: e036a0000016
Revises: e036a0000015
Create Date: 2026-09-28 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e036a0000016'
down_revision: Union[str, Sequence[str], None] = 'e036a0000015'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'session_participants',
        sa.Column('raise_hand', sa.Boolean(), nullable=False, server_default=sa.text('false')),
    )
    op.add_column(
        'session_participants',
        sa.Column('speaking', sa.Boolean(), nullable=False, server_default=sa.text('false')),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('session_participants', 'speaking')
    op.drop_column('session_participants', 'raise_hand')
