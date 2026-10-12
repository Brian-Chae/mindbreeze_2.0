"""SDD-097: 클래스 예약 사전 안내(리마인더)

Revision ID: e036a0000100
Revises: e036a0000019
Create Date: 2026-09-29 12:30:00.000000

클래스 생성 후 참여코드·준비물·시작시간을 상담사가 수동으로 공지해야 했던 문제를
해결하기 위해, 예약 클래스에 리마인더 시점 목록(reminder_offsets, 시작 N분 전)을
저장하고 발송 로그(session_reminder_logs)로 중복 발송을 막는다.

- sessions.reminder_offsets: JSONB 정수 분 목록(예: [1440, 60]). 기존 행은 '[]'(리마인더 끔).
- session_reminder_logs: (session_id, offset_min, user_id, channel) UNIQUE — 시점별 1회 발송 보장.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID


# revision identifiers, used by Alembic.
revision: str = 'e036a0000100'
down_revision: Union[str, Sequence[str], None] = 'e036a0000019'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'sessions',
        sa.Column('reminder_offsets', JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
    )
    op.create_table(
        'session_reminder_logs',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column('session_id', UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', UUID(as_uuid=True), nullable=True),
        sa.Column('offset_min', sa.Integer(), nullable=False),
        sa.Column('channel', sa.String(length=10), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='sent'),
        sa.Column('sent_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['session_id'], ['sessions.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id']),
        sa.UniqueConstraint(
            'session_id', 'offset_min', 'user_id', 'channel',
            name='uq_session_reminder_delivery',
        ),
    )
    op.create_index('ix_session_reminder_logs_session_id', 'session_reminder_logs', ['session_id'])
    op.create_index('ix_session_reminder_logs_user_id', 'session_reminder_logs', ['user_id'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_session_reminder_logs_user_id', table_name='session_reminder_logs')
    op.drop_index('ix_session_reminder_logs_session_id', table_name='session_reminder_logs')
    op.drop_table('session_reminder_logs')
    op.drop_column('sessions', 'reminder_offsets')
