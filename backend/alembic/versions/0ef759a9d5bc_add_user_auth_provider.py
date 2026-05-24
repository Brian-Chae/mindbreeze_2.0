"""add_user_auth_provider

Revision ID: 0ef759a9d5bc
Revises: c8f3a1b5d201
Create Date: 2026-05-24 22:29:45.195564

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0ef759a9d5bc'
down_revision: Union[str, Sequence[str], None] = 'c8f3a1b5d201'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('users', sa.Column('auth_provider', sa.String(20), nullable=False, server_default='email'))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('users', 'auth_provider')
