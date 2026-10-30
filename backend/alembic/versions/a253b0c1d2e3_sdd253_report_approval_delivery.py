"""SDD-253: 리포트 승인 감사 스냅샷 + 발송 상태 (가산 nullable 컬럼).

- 기존 approved_by_user_id / approved_at(SDD-214) 재사용, sent_at 의미 불변.
- 기존 행 backfill 없음: NULL = 기록 없음(승인자 미확인 / 발송 기록 없음).
- downgrade: 추가 컬럼 drop.
"""
from alembic import op
import sqlalchemy as sa

revision = "a253b0c1d2e3"
down_revision = "e036a0245001"
branch_labels = None
depends_on = None

_COLS = [
    ("approved_by_name", sa.String(200)),
    ("approved_by_role", sa.String(20)),
    ("approval_source", sa.String(20)),
    ("delivery_status", sa.String(20)),
    ("delivery_attempted_at", sa.DateTime(timezone=True)),
    ("delivery_attempt_count", sa.Integer()),
    ("delivery_failure_code", sa.String(50)),
]


def upgrade() -> None:
    for name, type_ in _COLS:
        kwargs = {"nullable": True}
        if name == "delivery_attempt_count":
            kwargs["server_default"] = "0"
        op.add_column("reports", sa.Column(name, type_, **kwargs))


def downgrade() -> None:
    for name, _ in reversed(_COLS):
        op.drop_column("reports", name)
