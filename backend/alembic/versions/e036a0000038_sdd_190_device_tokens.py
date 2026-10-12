"""SDD-190: 앱 푸시 디바이스 토큰 테이블

- device_tokens: token UNIQUE(기기당 1행), platform ios|android, 소프트 해지(revoked_at)
- (user_id, revoked_at) 인덱스로 발송 대상 조회 풀스캔 방지

Revision ID: e036a0000038
Revises: e036a0000037
Create Date: 2026-10-08
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers, used by Alembic.
revision: str = "e036a0000038"
down_revision: Union[str, Sequence[str], None] = "e036a0000037"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "device_tokens",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("token", sa.String(length=512), nullable=False),
        # ios | android
        sa.Column("platform", sa.String(length=10), nullable=False),
        sa.Column("app_version", sa.String(length=50), nullable=True),
        sa.Column("device_label", sa.String(length=100), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("token", name="uq_device_tokens_token"),
    )
    op.create_index(
        "ix_device_tokens_user_revoked", "device_tokens", ["user_id", "revoked_at"]
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_device_tokens_user_revoked", table_name="device_tokens")
    op.drop_table("device_tokens")
