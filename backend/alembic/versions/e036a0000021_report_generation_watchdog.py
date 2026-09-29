"""리포트 생성 워치독 — reports.generation_started_at / generation_error 추가

Revision ID: e036a0000021
Revises: e036a0000020
Create Date: 2026-09-29 15:00:00.000000

리포트 생성 파이프라인이 Celery 워커에서 중단(SIGKILL·크래시·브로커 장애)되면
generation_status 가 'processing'에 영구히 남는다. beat 스윕(sweep_stale_reports)이
generation_started_at 경과로 먹통을 감지하고, generation_error 로 중단 사유를 기록한다.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e036a0000021'
down_revision: Union[str, Sequence[str], None] = 'e036a0000020'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'reports',
        sa.Column('generation_started_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        'reports',
        sa.Column('generation_error', sa.String(50), nullable=True),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('reports', 'generation_error')
    op.drop_column('reports', 'generation_started_at')
