"""add qualifications and careers tables

Revision ID: d74027f66e1c
Revises: 0ef759a9d5bc
Create Date: 2026-05-27 13:36:07.462653

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd74027f66e1c'
down_revision: Union[str, Sequence[str], None] = '0ef759a9d5bc'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('qualifications',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('issuer', sa.String(length=200), nullable=True),
    sa.Column('issued_at', sa.Date(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_qualifications_user_id'), 'qualifications', ['user_id'], unique=False)
    op.create_table('careers',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('organization', sa.String(length=200), nullable=False),
    sa.Column('role', sa.String(length=200), nullable=True),
    sa.Column('started_at', sa.Date(), nullable=True),
    sa.Column('ended_at', sa.Date(), nullable=True),
    sa.Column('is_current', sa.Boolean(), default=False, nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_careers_user_id'), 'careers', ['user_id'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_careers_user_id'), table_name='careers')
    op.drop_table('careers')
    op.drop_index(op.f('ix_qualifications_user_id'), table_name='qualifications')
    op.drop_table('qualifications')
