"""SDD-096: session_records.subjective_state — 세션 직후 1탭 셀프 체크인(주관 상태)

Revision ID: e036a0000019
Revises: 0e240d60b539
Create Date: 2026-09-29 12:00:00.000000

LINK BAND 미착용자도 세션마다 주관 기록이 남도록, 종료 화면의 SAM 2축
(각성·정서) 5단계 + 한 줄 소감을 SessionRecord 에 JSONB 로 적재한다.
구조: {"participants": {"<participant_id>": {"before": ..., "after": ..., "updated_at": ...}}}
미입력(스킵)이면 NULL — 빈 dict 로 치환하지 않는다.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


# revision identifiers, used by Alembic.
revision: str = 'e036a0000019'
down_revision: Union[str, Sequence[str], None] = '0e240d60b539'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'session_records',
        sa.Column('subjective_state', JSONB(), nullable=True),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('session_records', 'subjective_state')
