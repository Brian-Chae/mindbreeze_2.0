"""012_chat_direct_rooms — ChatRoom에 room_type, host_id, name 추가 + session_id nullable

Revision ID: b7e2c4d0a1f2
Revises: f56a0b1c2d3e
Create Date: 2026-05-22 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b7e2c4d0a1f2"
down_revision: Union[str, Sequence[str], None] = "f56a0b1c2d3e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "chat_rooms",
        sa.Column("room_type", sa.String(length=20), nullable=False, server_default="session"),
    )
    op.add_column(
        "chat_rooms",
        sa.Column("host_id", sa.UUID(), nullable=True),
    )
    op.add_column(
        "chat_rooms",
        sa.Column("name", sa.String(length=120), nullable=True),
    )
    op.create_foreign_key(
        "fk_chat_rooms_host_id",
        "chat_rooms",
        "users",
        ["host_id"],
        ["id"],
    )
    op.alter_column("chat_rooms", "session_id", nullable=True)


def downgrade() -> None:
    op.alter_column("chat_rooms", "session_id", nullable=False)
    op.drop_constraint("fk_chat_rooms_host_id", "chat_rooms", type_="foreignkey")
    op.drop_column("chat_rooms", "name")
    op.drop_column("chat_rooms", "host_id")
    op.drop_column("chat_rooms", "room_type")
