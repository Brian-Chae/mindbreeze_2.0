"""010 notification preferences: user.notification_preferences JSONB

Revision ID: e7d2a01b9f10
Revises: d5a18f29c100
Create Date: 2026-05-21 10:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "e7d2a01b9f10"
down_revision: Union[str, Sequence[str], None] = "d5a18f29c100"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("notification_preferences", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "notification_preferences")
