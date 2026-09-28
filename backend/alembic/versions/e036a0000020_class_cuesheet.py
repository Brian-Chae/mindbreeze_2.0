"""진행 큐시트(타임라인 대본) — sessions.cuesheet 추가

Revision ID: e036a0000020
Revises: e036a0000100
Create Date: 2026-09-29 14:00:00.000000

상담사가 명상/상담 흐름(도입 호흡 → 바디스캔 → 마무리 등)을 단계별 라벨·목표시간(분)·메모로
미리 적어 두는 대본을 저장한다. 회원 화면에는 노출하지 않고 상담사 플레이어의 단계 진행
표시(현재 단계 하이라이트·남은 시간)에만 쓴다.
구조: [{"label": "도입 호흡", "duration_min": 5, "note": "4-7-8 호흡"}, ...]
미작성 클래스(기존 행 포함)는 빈 배열 — NULL 을 만들지 않는다.

주의: 이 리비전은 e036a0000100(SDD-097 리마인더) 뒤에 붙는다. 두 작업 모두 e036a0000019
에서 갈라졌으나 서로 다른 테이블/컬럼만 건드리므로 순서 의존성이 없어 선형 체인으로 합친다
(head 1개 유지).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


# revision identifiers, used by Alembic.
revision: str = 'e036a0000020'
down_revision: Union[str, Sequence[str], None] = 'e036a0000100'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'sessions',
        sa.Column(
            'cuesheet',
            JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('sessions', 'cuesheet')
