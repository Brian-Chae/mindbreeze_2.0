"""MB2-ORM-IDX-05/07, MB2-ORM-UNQ-11: 인덱스·부분 유니크 제약 추가

- notifications.user_id 인덱스 (알림 목록·미읽음 카운트·전체 읽음 조회 풀스캔 제거)
- reports.user_id 인덱스 (내담자 리포트 목록 필터/조인 풀스캔 제거)
- org_join_requests (user_id, org_id) WHERE status='pending' 부분 유니크
  (동시 소속 신청 경합으로 중복 pending 신청이 생성되는 것을 DB 레벨에서 차단)

Revision ID: e036a0000034
Revises: e036a0000033
Create Date: 2026-10-06
"""
from typing import Sequence, Union

from alembic import op
from sqlalchemy import text


# revision identifiers, used by Alembic.
revision: str = "e036a0000034"
down_revision: Union[str, Sequence[str], None] = "e036a0000033"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_index("ix_notifications_user_id", "notifications", ["user_id"])
    op.create_index("ix_reports_user_id", "reports", ["user_id"])
    op.create_index(
        "uq_org_join_request_pending",
        "org_join_requests",
        ["user_id", "org_id"],
        unique=True,
        postgresql_where=text("status = 'pending'"),
        sqlite_where=text("status = 'pending'"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("uq_org_join_request_pending", table_name="org_join_requests")
    op.drop_index("ix_reports_user_id", table_name="reports")
    op.drop_index("ix_notifications_user_id", table_name="notifications")
