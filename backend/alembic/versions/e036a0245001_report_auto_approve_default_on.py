"""리포트 자동 승인 기본값을 켜짐(true)으로 변경.

대표 결정(2026-10-28): 상담사 리포트 '자동 승인' 기본 켜짐. 측정값 없는 명상 회차 제외(SDD-237)는 그대로.
- users.auto_approve_report server_default false → true
- 기존 상담사(role='counselor') 값을 true 로 일괄 갱신 (출시 전이라 기존 상담사도 켜는 것이 의도)
- downgrade: server_default 만 false 로 복원, 데이터는 건드리지 않음
"""
from alembic import op
import sqlalchemy as sa

revision = "e036a0245001"
down_revision = "e036a0243003"
branch_labels = None
depends_on = None

_users = sa.table(
    "users",
    sa.column("role", sa.String),
    sa.column("auto_approve_report", sa.Boolean),
)


def upgrade() -> None:
    op.alter_column("users", "auto_approve_report", server_default=sa.true())
    op.execute(
        _users.update()
        .where(_users.c.role == "counselor")
        .values(auto_approve_report=True)
    )


def downgrade() -> None:
    op.alter_column("users", "auto_approve_report", server_default=sa.false())
