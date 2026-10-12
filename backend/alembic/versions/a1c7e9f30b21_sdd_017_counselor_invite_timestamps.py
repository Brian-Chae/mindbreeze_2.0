"""sdd-017 counselor invite: users.invited_at / invite_expires_at

Revision ID: a1c7e9f30b21
Revises: 74861dbf7604
Create Date: 2026-09-02

SDD-017: 상담사 초대(pending) 계정의 초대 시각·만료 시각을 users 테이블에 추가한다.
초대 관리 목록에서 pending/active/만료 상태 뱃지 노출에 사용한다. 둘 다 nullable —
초대로 생성되지 않은 기존 계정은 NULL 이다.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1c7e9f30b21'
down_revision: Union[str, Sequence[str], None] = '74861dbf7604'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "users",
        sa.Column("invited_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column("invite_expires_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("users", "invite_expires_at")
    op.drop_column("users", "invited_at")
