"""SDD-192: 웹 푸시 구독 키 컬럼

- device_tokens.p256dh / auth: platform="web" 구독의 암호화 키(앱 토큰은 NULL)

Revision ID: e036a0000040
Revises: e036a0000039
Create Date: 2026-10-08
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e036a0000040"
down_revision: Union[str, Sequence[str], None] = "e036a0000039"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("device_tokens", sa.Column("p256dh", sa.String(length=255), nullable=True))
    op.add_column("device_tokens", sa.Column("auth", sa.String(length=64), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("device_tokens", "auth")
    op.drop_column("device_tokens", "p256dh")
