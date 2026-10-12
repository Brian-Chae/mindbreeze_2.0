"""진행 큐시트 기능 제거 — sessions.cuesheet drop

Revision ID: e036a0000022
Revises: e036a0000021
Create Date: 2026-10-02 00:00:00.000000

SDD-099: 클래스 진행 큐시트(타임라인 대본) 기능 제거. sessions.cuesheet 컬럼을 삭제한다.
기존 e036a0000020(add)은 마이그레이션 히스토리 보존을 위해 유지하고, drop 만 별도 리비전으로
추가한다(이미 배포된 환경과 미배포 환경 모두 안전).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


# revision identifiers, used by Alembic.
revision: str = 'e036a0000022'
down_revision: Union[str, Sequence[str], None] = 'e036a0000021'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.drop_column('sessions', 'cuesheet')


def downgrade() -> None:
    """Downgrade schema."""
    op.add_column(
        'sessions',
        sa.Column(
            'cuesheet',
            JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )
