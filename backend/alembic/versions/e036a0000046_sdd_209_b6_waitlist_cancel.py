"""SDD-209 B6: 대기 취소 시각 (MG-2 대기 상태)

- session_participants.waitlist_cancelled_at: nullable. 대기 취소(P6)는 행 삭제 없이 시각만 기록한다.

nullable add column(메타데이터 전용), 기존 행 불변(NULL = 현행 동작). 롤백: 코드 revert 로 충분(구 코드는 무시).
다운그레이드는 drop 이므로 데이터 손실 — 운영 롤백에는 사용하지 않는다.

Revision ID: e036a0000046
Revises: e036a0000045
Create Date: 2026-10-17
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e036a0000046"
down_revision: Union[str, Sequence[str], None] = "e036a0000045"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "session_participants",
        sa.Column("waitlist_cancelled_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("session_participants", "waitlist_cancelled_at")
