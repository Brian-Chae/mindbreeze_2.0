"""SDD-209 B14: 비회원 이메일 초대 (MG-7 일부)

신규 테이블 ``session_email_invites``(추가형). 기존 테이블·행은 변경하지 않는다.
세션 FK 는 CASCADE(플랫폼 관리자 하드 삭제 시 함께 삭제) — 일반 삭제는 숨김이라 영향 없음.
다운그레이드 = drop(데이터 손실이므로 운영 롤백에는 사용하지 않는다).

Revision ID: e036a0000048
Revises: e036a0000047
Create Date: 2026-10-17
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "e036a0000048"
down_revision: Union[str, Sequence[str], None] = "e036a0000047"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "session_email_invites",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "session_id", postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("email", sa.String(320), nullable=True),
        sa.Column("email_norm", sa.String(320), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="queued"),
        sa.Column("last_error", sa.String(100), nullable=True),
        sa.Column("request_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("queued_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("requested_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("pii_scrubbed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("session_id", "email_norm", name="uq_session_email_invite"),
    )
    op.create_index("ix_session_email_invites_session_id", "session_email_invites", ["session_id"])


def downgrade() -> None:
    op.drop_index("ix_session_email_invites_session_id", table_name="session_email_invites")
    op.drop_table("session_email_invites")
