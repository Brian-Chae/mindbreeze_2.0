"""SDD-198: 루시 장기기억 구조화 — 사실·선호·관계·감정 트렌드

- agent_memory_items: 내담자별 구조화 기억 (client_id, category, key) UNIQUE
  category: fact | preference | relation | emotion_trend

Revision ID: e036a0000041
Revises: e036a0000040
Create Date: 2026-10-10
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

# revision identifiers, used by Alembic.
revision: str = "e036a0000041"
down_revision: Union[str, Sequence[str], None] = "e036a0000040"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "agent_memory_items",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("client_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        # fact | preference | relation | emotion_trend
        sa.Column("category", sa.String(length=20), nullable=False),
        # 주제명 — 예: "자녀", "직업", "선호 대화 방식"
        sa.Column("key", sa.String(length=80), nullable=False),
        # 내용 — 예: "이서(딸), 이준(아들)"
        sa.Column("value", sa.Text(), nullable=False),
        # 근거 메시지 id 목록만 담는다 — 원문 문장은 저장하지 않는다.
        sa.Column("evidence", JSONB(), nullable=False, server_default="[]"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint(
            "client_id", "category", "key", name="uq_agent_memory_item_key"
        ),
    )
    op.create_index("ix_agent_memory_items_client", "agent_memory_items", ["client_id"])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_agent_memory_items_client", table_name="agent_memory_items")
    op.drop_table("agent_memory_items")
