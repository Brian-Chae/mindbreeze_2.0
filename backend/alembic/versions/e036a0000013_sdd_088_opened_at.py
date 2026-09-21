"""SDD-088 — 클래스 오픈(대기실) 시각 opened_at 컬럼 추가

Revision ID: e036a0000013
Revises: e036a0000012
Create Date: 2026-09-21

open 상태 값 자체는 String(20) + CHECK 제약 없음이라 DB 변경이 필요 없다.
opened_at(nullable)만 추가 — 기존 행은 NULL 유지, 무중단.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e036a0000013'
down_revision: Union[str, Sequence[str], None] = 'e036a0000012'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('sessions', sa.Column('opened_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('sessions', 'opened_at')
