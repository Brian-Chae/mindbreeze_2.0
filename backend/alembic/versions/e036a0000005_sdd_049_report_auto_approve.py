"""SDD-049 리포트 자동 승인 설정

Revision ID: e036a0000005
Revises: e036a0000004
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e036a0000005"
down_revision: Union[str, None] = "e036a0000004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "auto_approve_report",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "auto_approve_report")
