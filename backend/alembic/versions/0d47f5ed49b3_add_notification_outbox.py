"""add notification_outbox

Revision ID: 0d47f5ed49b3
Revises: e036a0000014
Create Date: 2026-09-27 14:42:30.307667

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '0d47f5ed49b3'
down_revision: Union[str, Sequence[str], None] = 'e036a0000014'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('notification_outbox',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('notification_id', sa.UUID(), nullable=True),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('channel', sa.String(length=10), nullable=False),
    sa.Column('recipient', sa.String(length=500), nullable=True),
    sa.Column('payload', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('attempts', sa.Integer(), nullable=False),
    sa.Column('available_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('last_error', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('sent_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['notification_id'], ['notifications.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('notification_outbox')
