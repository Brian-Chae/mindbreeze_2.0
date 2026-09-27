"""add notification read_at

Revision ID: 7c7a43a60247
Revises: 0d47f5ed49b3
Create Date: 2026-09-27 15:37:54.319543

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '7c7a43a60247'
down_revision: Union[str, Sequence[str], None] = '0d47f5ed49b3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('notifications', sa.Column('read_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('notifications', 'read_at')
