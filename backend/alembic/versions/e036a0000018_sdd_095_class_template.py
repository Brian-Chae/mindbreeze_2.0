"""SDD-095 클래스 템플릿 — sessions 에 is_template 컬럼 추가

Revision ID: e036a0000018
Revises: ae97d0a37430
Create Date: 2026-09-29 10:00:00.000000

주의: 이 리비전은 ae97d0a37430 직후에 독립적으로 붙는다. 동시에 진행된 다른 작업이
같은 부모(ae97d0a37430)에서 e036a0000017(reports.generation_status)을 만들었으므로
현재 head 가 2개다. 통합 시 둘 중 하나로 정리한다:
    alembic merge -m "merge sdd-095 migrations" e036a0000017 e036a0000018
(양쪽 모두 서로 다른 테이블만 건드려 순서 의존성이 없다.)
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e036a0000018'
down_revision: Union[str, Sequence[str], None] = 'ae97d0a37430'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'sessions',
        sa.Column('is_template', sa.Boolean(), nullable=False, server_default=sa.text('false')),
    )
    # 일반 클래스 목록/템플릿 목록은 (host_id, is_template) 로 좁혀 조회한다.
    op.create_index(
        'ix_sessions_host_is_template',
        'sessions',
        ['host_id', 'is_template'],
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_sessions_host_is_template', table_name='sessions')
    op.drop_column('sessions', 'is_template')
