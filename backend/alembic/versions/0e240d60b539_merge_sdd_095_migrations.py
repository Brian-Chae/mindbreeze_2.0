"""merge sdd-095 migrations — 두 개의 독립 SDD-095 리비전을 하나의 head 로 합친다.

Revision ID: 0e240d60b539
Revises: e036a0000017, e036a0000018
Create Date: 2026-09-29 00:22:54.367872

같은 부모(ae97d0a37430)에서 갈라진 두 리비전을 병합한다:
  · e036a0000017 — reports.generation_status (리포트 생성 진행 상태)
  · e036a0000018 — sessions.is_template (클래스 템플릿)
서로 다른 테이블만 건드려 적용 순서 의존성이 없으므로 merge 로 정리한다.
(스키마 변경 없음 — 빈 마이그레이션)
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0e240d60b539'
down_revision: Union[str, Sequence[str], None] = ('e036a0000017', 'e036a0000018')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
