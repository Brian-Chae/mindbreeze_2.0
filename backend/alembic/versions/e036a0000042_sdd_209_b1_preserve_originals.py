"""SDD-209 B1: 원본 보존 전환 — 숨김/제거 시각 + 원본 삭제 감사

- sessions.hidden_at: 일반 클래스 삭제 = 숨김(보존 전환). 행·원본 유지.
- session_participants.removed_at: 호스트의 참여자 제거 = 제거 시각 기록(CASCADE 원본 소실 방지).
- original_deletion_audits: 플랫폼 관리자 기간 전 원본 삭제 감사(FK 없음 — 부모 삭제에 휩쓸리지 않음).

모두 추가형(nullable 컬럼·신규 테이블). FK ondelete 변경 없음(plan §3.4 MG-3·MG-4).
롤백: 코드 revert 만으로 구 코드가 동작한다(신규 컬럼은 구 코드가 무시). 다운그레이드는
컬럼/테이블을 drop 하므로 데이터 손실 — 운영 롤백에는 사용하지 않는다.

Revision ID: e036a0000042
Revises: e036a0000041
Create Date: 2026-10-17
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = "e036a0000042"
down_revision: Union[str, Sequence[str], None] = "e036a0000041"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("sessions", sa.Column("hidden_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "session_participants", sa.Column("removed_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.create_table(
        "original_deletion_audits",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("actor_id", UUID(as_uuid=True), nullable=False),
        sa.Column("target_type", sa.String(length=20), nullable=False),
        sa.Column("target_id", UUID(as_uuid=True), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("scopes", JSONB(), nullable=False, server_default="[]"),
        sa.Column("result", JSONB(), nullable=False, server_default="{}"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index(
        "ix_original_deletion_audits_actor_id", "original_deletion_audits", ["actor_id"]
    )
    op.create_index(
        "ix_original_deletion_audits_target_id", "original_deletion_audits", ["target_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_original_deletion_audits_target_id", table_name="original_deletion_audits")
    op.drop_index("ix_original_deletion_audits_actor_id", table_name="original_deletion_audits")
    op.drop_table("original_deletion_audits")
    op.drop_column("session_participants", "removed_at")
    op.drop_column("sessions", "hidden_at")
