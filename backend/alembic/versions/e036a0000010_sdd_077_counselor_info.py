"""SDD-077 상담사 정보 관리 — 주소 필드 + 낙관적 잠금 버전

Revision ID: e036a0000010
Revises: e036a0000009
Create Date: 2026-09-17
"""
import sqlalchemy as sa
from alembic import op

revision = 'e036a0000010'
down_revision = 'e036a0000009'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('counselor_profiles', sa.Column('postal_code', sa.String(length=20), nullable=True))
    op.add_column('counselor_profiles', sa.Column('address_line1', sa.String(length=300), nullable=True))
    op.add_column('counselor_profiles', sa.Column('address_line2', sa.String(length=200), nullable=True))
    op.add_column('counselor_profiles', sa.Column('version', sa.Integer(), nullable=False, server_default='1'))


def downgrade() -> None:
    op.drop_column('counselor_profiles', 'version')
    op.drop_column('counselor_profiles', 'address_line2')
    op.drop_column('counselor_profiles', 'address_line1')
    op.drop_column('counselor_profiles', 'postal_code')
