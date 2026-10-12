"""sdd-027 p1: raw chunk manifest + eeg_records 확장 + report 상태머신

Revision ID: b3d9e1f04277
Revises: a1c2e3f40261
Create Date: 2026-09-08

SDD-027 P1(60초 롤업·raw S3·리포트 상태머신).
- eeg_records: participant_id/play_group_id/file_count 추가, user_id nullable(게스트 raw)
- eeg_raw_chunks(신규): raw EEG 청크 manifest + presigned/ack 업로드 상태
- reports: status(상태머신) + data_credibility + participant_id 추가, user_id nullable(게스트 리포트)

주의: 60초 롤업(T1)은 EEGFeatureWindow 원천의 온디맨드 파생이므로 스키마 변경이 없다.
표준 PostgreSQL 만 사용한다(TimescaleDB 미사용).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "b3d9e1f04277"
down_revision: Union[str, Sequence[str], None] = "a1c2e3f40261"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # ── eeg_records 확장 ──────────────────────────────────────────
    # 게스트 raw 지원: user_id 를 nullable 로 완화(기존 행은 이미 값 보유)
    op.alter_column("eeg_records", "user_id", existing_type=sa.dialects.postgresql.UUID(), nullable=True)
    op.add_column(
        "eeg_records",
        sa.Column("participant_id", sa.dialects.postgresql.UUID(), nullable=True),
    )
    op.add_column(
        "eeg_records",
        sa.Column("play_group_id", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "eeg_records",
        sa.Column("file_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_index("ix_eeg_records_participant_id", "eeg_records", ["participant_id"])
    op.create_index("ix_eeg_records_play_group_id", "eeg_records", ["play_group_id"])
    op.create_foreign_key(
        "fk_eeg_records_participant_id", "eeg_records", "session_participants",
        ["participant_id"], ["id"], ondelete="CASCADE",
    )

    # ── eeg_raw_chunks 신규 ───────────────────────────────────────
    op.create_table(
        "eeg_raw_chunks",
        sa.Column("id", sa.dialects.postgresql.UUID(), nullable=False),
        sa.Column("session_id", sa.dialects.postgresql.UUID(), nullable=False),
        sa.Column("participant_id", sa.dialects.postgresql.UUID(), nullable=True),
        sa.Column("user_id", sa.dialects.postgresql.UUID(), nullable=True),
        sa.Column("stream_id", sa.String(length=64), nullable=False, server_default="default"),
        sa.Column("chunk_index", sa.Integer(), nullable=False),
        sa.Column("start_ms", sa.Float(), nullable=True),
        sa.Column("end_ms", sa.Float(), nullable=True),
        sa.Column("sample_rate", sa.Integer(), nullable=False, server_default="250"),
        sa.Column("channel_count", sa.Integer(), nullable=False, server_default="2"),
        sa.Column("unit", sa.String(length=20), nullable=False, server_default="uV"),
        sa.Column("schema_version", sa.String(length=20), nullable=False, server_default="1.0"),
        sa.Column("checksum", sa.String(length=128), nullable=True),
        sa.Column("size_bytes", sa.Integer(), nullable=True),
        sa.Column("object_key", sa.String(length=500), nullable=False),
        sa.Column("upload_status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["session_id"], ["sessions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["participant_id"], ["session_participants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "session_id", "participant_id", "stream_id", "chunk_index",
            name="uq_eeg_raw_chunk",
        ),
    )
    op.create_index("ix_eeg_raw_chunks_session_id", "eeg_raw_chunks", ["session_id"])
    op.create_index("ix_eeg_raw_chunks_participant_id", "eeg_raw_chunks", ["participant_id"])

    # ── reports 상태머신 ──────────────────────────────────────────
    # 게스트 리포트 지원: user_id nullable
    op.alter_column("reports", "user_id", existing_type=sa.dialects.postgresql.UUID(), nullable=True)
    op.add_column(
        "reports",
        sa.Column("status", sa.String(length=30), nullable=False, server_default="pending_analysis"),
    )
    op.add_column("reports", sa.Column("data_credibility", sa.String(length=20), nullable=True))
    op.add_column(
        "reports",
        sa.Column("participant_id", sa.dialects.postgresql.UUID(), nullable=True),
    )
    op.create_index("ix_reports_participant_id", "reports", ["participant_id"])
    op.create_foreign_key(
        "fk_reports_participant_id", "reports", "session_participants",
        ["participant_id"], ["id"], ondelete="CASCADE",
    )
    # 기존 리포트는 이미 생성 완료 상태로 간주 — completed 로 백필
    op.execute("UPDATE reports SET status = 'completed' WHERE status = 'pending_analysis'")


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint("fk_reports_participant_id", "reports", type_="foreignkey")
    op.drop_index("ix_reports_participant_id", table_name="reports")
    op.drop_column("reports", "participant_id")
    op.drop_column("reports", "data_credibility")
    op.drop_column("reports", "status")
    op.alter_column("reports", "user_id", existing_type=sa.dialects.postgresql.UUID(), nullable=False)

    op.drop_index("ix_eeg_raw_chunks_participant_id", table_name="eeg_raw_chunks")
    op.drop_index("ix_eeg_raw_chunks_session_id", table_name="eeg_raw_chunks")
    op.drop_table("eeg_raw_chunks")

    op.drop_constraint("fk_eeg_records_participant_id", "eeg_records", type_="foreignkey")
    op.drop_index("ix_eeg_records_play_group_id", table_name="eeg_records")
    op.drop_index("ix_eeg_records_participant_id", table_name="eeg_records")
    op.drop_column("eeg_records", "file_count")
    op.drop_column("eeg_records", "play_group_id")
    op.drop_column("eeg_records", "participant_id")
    op.alter_column("eeg_records", "user_id", existing_type=sa.dialects.postgresql.UUID(), nullable=False)
