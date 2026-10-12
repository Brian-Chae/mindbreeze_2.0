"""SDD-084 — 세션 영상 녹화 저장 (video_chunks 테이블 + session_records video 컬럼)

Revision ID: e036a0000012
Revises: e036a0000011
Create Date: 2026-09-18

audio_chunks(1c9166897b31)와 동일 패턴: 청크 테이블 + session_records 상태 컬럼.
상담사(host) 본인 영상만 저장한다 — 내담자 영상·음성 저장 금지(온라인 클래스 정책).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e036a0000012'
down_revision: Union[str, Sequence[str], None] = 'e036a0000011'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'video_chunks',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('session_id', sa.UUID(), nullable=False),
        sa.Column('chunk_index', sa.Integer(), nullable=False),
        sa.Column('file_path', sa.String(length=500), nullable=False),
        sa.Column('size_bytes', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['session_id'], ['sessions.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    # 기존 행 보호를 위해 server_default 'idle' 부여
    op.add_column('session_records', sa.Column('video_status', sa.String(length=20), server_default='idle', nullable=False))
    op.add_column('session_records', sa.Column('video_s3_key', sa.String(length=500), nullable=True))
    op.add_column('session_records', sa.Column('video_recording_started_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('session_records', sa.Column('video_recording_ended_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('session_records', 'video_recording_ended_at')
    op.drop_column('session_records', 'video_recording_started_at')
    op.drop_column('session_records', 'video_s3_key')
    op.drop_column('session_records', 'video_status')
    op.drop_table('video_chunks')
