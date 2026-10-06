"""MB2-ORM-IDX-06: notification_outbox (status, channel, available_at) 복합 인덱스

Revision ID: e036a0000033
Revises: e036a0000032
Create Date: 2026-10-06

폴링 워커(outbox_worker.poll_and_deliver_ws / process_email_outbox_cron)가
status='pending' AND channel=? AND available_at <= now 조건으로 조회하는데,
해당 컬럼 조합에 인덱스가 없어 outbox 테이블이 커질수록 풀스캔이 발생한다.
(status, channel, available_at) 복합 인덱스로 인덱스 범위 스캔을 지원한다.
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "e036a0000033"
down_revision: Union[str, Sequence[str], None] = "e036a0000032"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


INDEX_NAME = "ix_notification_outbox_status_channel_available"


def upgrade() -> None:
    """Upgrade schema."""
    op.create_index(
        INDEX_NAME,
        "notification_outbox",
        ["status", "channel", "available_at"],
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(INDEX_NAME, table_name="notification_outbox")
