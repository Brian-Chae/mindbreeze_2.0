"""remove paused session status (SDD-125)

세션 상태 'paused'(일시정지) 기능 제거에 따른 데이터 마이그레이션.
기존 paused 세션을 in_progress(진행 중)로 통합한다.

Revision ID: e036a0000028
Revises: e036a0000027
Create Date: 2026-10-05
"""
from alembic import op

# revision identifiers, used by Alembic.
revision = "e036a0000028"
down_revision = "e036a0000027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("UPDATE sessions SET status='in_progress' WHERE status='paused'")


def downgrade() -> None:
    # 비가역: 일시정지 상태를 되돌릴 원본 정보(어느 in_progress가 paused였는지)가 없다.
    pass
