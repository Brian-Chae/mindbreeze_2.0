"""SDD-062 게스트 참가자 성별·생년월일

Revision ID: e036a0000006
Revises: e036a0000005
"""

from alembic import op
import sqlalchemy as sa


revision = "e036a0000006"
down_revision = "e036a0000005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("session_participants", sa.Column("gender", sa.String(length=20), nullable=True))
    op.add_column("session_participants", sa.Column("birth_date", sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column("session_participants", "birth_date")
    op.drop_column("session_participants", "gender")
