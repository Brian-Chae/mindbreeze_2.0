"""세션 영상/음성 녹화 여부 컬럼 추가 (record_audio/record_video)

Revision ID: e036a0000015
Revises: 7c7a43a60247
Create Date: 2026-09-28 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e036a0000015'
down_revision: Union[str, Sequence[str], None] = '7c7a43a60247'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('sessions', sa.Column('record_audio', sa.Boolean(), nullable=False, server_default=sa.text('true')))
    op.add_column('sessions', sa.Column('record_video', sa.Boolean(), nullable=False, server_default=sa.text('true')))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('sessions', 'record_video')
    op.drop_column('sessions', 'record_audio')
