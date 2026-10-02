"""SDD-101: 종료 파이프라인 발행 Outbox — pipeline_outbox 테이블

Revision ID: e036a0000023
Revises: e036a0000022
Create Date: 2026-10-03 00:00:00.000000

세션 종료 시 STT·요약·영상병합·리포트 발행 의도를 세션 상태 전이와 같은 트랜잭션으로
durable 기록한다. 발행(apply_async) 실패·프로세스 사망 시에도 beat 스윕이 pending 건을
재발행한다. session_id UNIQUE 가 발행 멱등키 역할을 겸한다.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


# revision identifiers, used by Alembic.
revision: str = 'e036a0000023'
down_revision: Union[str, Sequence[str], None] = 'e036a0000022'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'pipeline_outbox',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column('session_id', UUID(as_uuid=True), nullable=False),
        sa.Column('has_recording', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('needs_video_merge', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('needs_report', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='pending'),
        sa.Column('attempts', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('available_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('last_error', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['session_id'], ['sessions.id'], ondelete='CASCADE'),
        sa.UniqueConstraint('session_id', name='uq_pipeline_outbox_session'),
    )
    op.create_index('ix_pipeline_outbox_status_available', 'pipeline_outbox', ['status', 'available_at'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_pipeline_outbox_status_available', table_name='pipeline_outbox')
    op.drop_table('pipeline_outbox')
