"""SDD-209 B12: 기본 DB 삭제 스위프 (MG-6)

추가형만 — 기존 행은 변경하지 않는다.
- session_participants.pii_scrubbed_at (nullable): 비회원 개인정보 스크럽 시각
- research_consents.hold_alerted_at (nullable): 삭제 보류 임계 초과 알림 시각(중복 방지)
- retention_sweep_runs: 스위프 실행 이력(FK 없음)

설정값(RETENTION_*)·활성화 플래그는 코드/.env 이며 마이그레이션이 필요 없다. 스위프는 기본 비활성으로 배포한다.
다운그레이드 = drop(데이터 손실이므로 운영 롤백에는 사용하지 않는다).

Revision ID: e036a0000049
Revises: e036a0000048
Create Date: 2026-10-17
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "e036a0000049"
down_revision: Union[str, Sequence[str], None] = "e036a0000048"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("session_participants", sa.Column("pii_scrubbed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("research_consents", sa.Column("hold_alerted_at", sa.DateTime(timezone=True), nullable=True))
    op.create_table(
        "retention_sweep_runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("mode", sa.String(10), nullable=False),
        sa.Column("trigger", sa.String(10), nullable=False, server_default="manual"),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("status", sa.String(10), nullable=False, server_default="running"),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("report", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("error", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("retention_sweep_runs")
    op.drop_column("research_consents", "hold_alerted_at")
    op.drop_column("session_participants", "pii_scrubbed_at")
