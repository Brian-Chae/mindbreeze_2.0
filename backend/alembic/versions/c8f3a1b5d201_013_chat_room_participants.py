"""013_chat_room_participants — 그룹 채팅방 참여자 테이블 추가

Revision ID: c8f3a1b5d201
Revises: b7e2c4d0a1f2
Create Date: 2026-05-22 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c8f3a1b5d201"
down_revision: Union[str, Sequence[str], None] = "b7e2c4d0a1f2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "chat_room_participants",
        sa.Column("room_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column(
            "joined_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["room_id"], ["chat_rooms.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("room_id", "user_id"),
    )


def downgrade() -> None:
    op.drop_table("chat_room_participants")
