"""SDD-090 — 채팅방 표시 이름 + 마지막 메시지 조회 인덱스

Revision ID: e036a0000014
Revises: e036a0000013
Create Date: 2026-09-25

1. chat_rooms.display_name(String(120), nullable) 추가
   - direct 방의 name 필드는 내담자 ID 저장소이므로 표시 이름은 별도 컬럼에 저장.
   - 기존 행은 NULL 유지(백필 없음) — 서버가 유형별 fallback 제목을 계산.
2. chat_messages(room_id, created_at DESC) 복합 인덱스
   - 방별 최신 메시지 DISTINCT ON 집계와 메시지 목록 최신순 조회 모두 사용.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e036a0000014'
down_revision: Union[str, Sequence[str], None] = 'e036a0000013'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('chat_rooms', sa.Column('display_name', sa.String(length=120), nullable=True))
    op.create_index(
        'ix_chat_messages_room_id_created_at',
        'chat_messages',
        ['room_id', sa.text('created_at DESC')],
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_chat_messages_room_id_created_at', table_name='chat_messages')
    op.drop_column('chat_rooms', 'display_name')
