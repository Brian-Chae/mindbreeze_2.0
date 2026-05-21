"""011 session waitlist: session_participants에 is_waitlisted, waitlist_position 추가

Revision ID: f56a0b1c2d3e
Revises: e7d2a01b9f10
Create Date: 2026-05-22 10:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f56a0b1c2d3e"
down_revision: Union[str, Sequence[str], None] = "e7d2a01b9f10"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "session_participants",
        sa.Column("is_waitlisted", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "session_participants",
        sa.Column("waitlist_position", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("session_participants", "waitlist_position")
    op.drop_column("session_participants", "is_waitlisted")
