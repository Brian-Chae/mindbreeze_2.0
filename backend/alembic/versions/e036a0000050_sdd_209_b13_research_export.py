"""SDD-209 B13: 연구 DB 내보내기 (MG-7)

신규 테이블 2종(추가형) — research_export_batches / research_export_items.
research_withdrawal_requests 는 B11(e036a0000047)에서 이미 만들었으므로 여기서 만들지 않는다(중복 생성 금지).
세션/참여자/동의 FK 없음. 다운그레이드 = drop(데이터 손실이므로 운영 롤백에는 사용하지 않는다).

Revision ID: e036a0000050
Revises: e036a0000049
Create Date: 2026-10-17
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "e036a0000050"
down_revision: Union[str, Sequence[str], None] = "e036a0000049"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "research_export_batches",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("status", sa.String(15), nullable=False, server_default="building"),
        sa.Column("key_version", sa.Integer(), nullable=True),
        sa.Column("prefix", sa.String(200), nullable=True),
        sa.Column("manifest_sha256", sa.String(64), nullable=True),
        sa.Column("total_bytes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("file_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("attempt", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("alerted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("acked_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_research_export_batches_session_id", "research_export_batches", ["session_id"])
    op.create_table(
        "research_export_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("batch_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("consent_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("research_subject_id", sa.String(64), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("content_sha256", sa.String(64), nullable=False),
        sa.Column("rows", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("batch_id", "consent_id", name="uq_research_export_item"),
    )
    op.create_index("ix_research_export_items_batch_id", "research_export_items", ["batch_id"])
    op.create_index("ix_research_export_items_consent_id", "research_export_items", ["consent_id"])
    op.create_index("ix_research_export_items_research_subject_id", "research_export_items", ["research_subject_id"])


def downgrade() -> None:
    op.drop_table("research_export_items")
    op.drop_index("ix_research_export_batches_session_id", table_name="research_export_batches")
    op.drop_table("research_export_batches")
