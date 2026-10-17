"""SDD-209 B9: 참여자 최초 입장 시각 (MG-2 entered_at)

session_participants.entered_at (nullable) 추가 — 추가형, 기존 행은 NULL(입장 여부 알 수 없음)로 둔다.
백필하지 않는다. 다운그레이드 = drop column(데이터 손실이므로 운영 롤백에는 사용하지 않는다).

Revision ID: e036a0000051
Revises: e036a0000050
Create Date: 2026-10-17
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e036a0000051"
down_revision: Union[str, Sequence[str], None] = "e036a0000050"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("session_participants", sa.Column("entered_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("session_participants", "entered_at")
