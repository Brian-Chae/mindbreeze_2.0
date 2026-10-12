"""SDD-095: reports.generation_status — 리포트 생성 진행 상태 컬럼 추가

Revision ID: e036a0000017
Revises: ae97d0a37430
Create Date: 2026-09-29 10:00:00.000000

승인 게이트(status: pending_analysis/pending_review/completed/error)와 독립 축으로,
STT→요약→리포트 생성 파이프라인의 진행 상태를 별도 컬럼에 기록한다.
기존 행은 모두 'pending' 으로 백필된다(진행 정보가 없던 시점의 리포트).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e036a0000017'
down_revision: Union[str, Sequence[str], None] = 'ae97d0a37430'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'reports',
        sa.Column(
            'generation_status',
            sa.String(length=20),
            nullable=False,
            server_default=sa.text("'pending'"),
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('reports', 'generation_status')
