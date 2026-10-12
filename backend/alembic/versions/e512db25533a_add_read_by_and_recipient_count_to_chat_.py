"""add_read_by_and_recipient_count_to_chat_messages

Revision ID: e512db25533a
Revises: 30c1bfbc724f
Create Date: 2026-06-04

Phase 3a: 채팅 읽음/안읽음 백엔드 — chat_messages 테이블에 read_by(ARRAY), recipient_count(INT) 컬럼 추가
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "e512db25533a"
down_revision: Union[str, None] = "30c1bfbc724f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # read_by: 읽은 사용자 UUID 배열 (PostgreSQL ARRAY)
    op.add_column(
        "chat_messages",
        sa.Column(
            "read_by",
            postgresql.ARRAY(sa.String(36)),
            nullable=True,
            server_default=None,
        ),
    )
    # recipient_count: 메시지 발송 시점의 수신자 수
    op.add_column(
        "chat_messages",
        sa.Column(
            "recipient_count",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )


def downgrade() -> None:
    op.drop_column("chat_messages", "recipient_count")
    op.drop_column("chat_messages", "read_by")
