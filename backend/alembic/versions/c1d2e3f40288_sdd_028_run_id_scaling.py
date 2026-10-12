"""sdd-028 p2: 경량 run_id + 조회 최적화용 복합 인덱스

Revision ID: c1d2e3f40288
Revises: b3d9e1f04277
Create Date: 2026-09-08

SDD-028 P2(반복 실행 run_id + 규모 확장 준비).
- sessions.run_id 추가(경량 SessionRun) — 기본값 = session_id(기존 행 백필). 조회·집계 그룹핑 키.
- eeg_feature_windows: (session_id, participant_id, window_index) 복합 인덱스 — batch key 범위 조회.
- eeg_raw_chunks: (session_id, participant_id, chunk_index) 복합 인덱스 — batch key 범위 조회.

주의: run_id 는 조회·집계 그룹핑 키로만 활용하므로 EEG/리포트 대규모 재마이그레이션이 없다.
표준 PostgreSQL 만 사용한다(TimescaleDB 미사용).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "c1d2e3f40288"
down_revision: Union[str, Sequence[str], None] = "b3d9e1f04277"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # ── sessions.run_id (경량 SessionRun) ─────────────────────────
    # nullable 로 추가 후 기존 행을 run_id = id 로 백필한다(대규모 데이터 마이그레이션 없음).
    op.add_column(
        "sessions",
        sa.Column("run_id", sa.dialects.postgresql.UUID(), nullable=True),
    )
    op.execute("UPDATE sessions SET run_id = id WHERE run_id IS NULL")
    op.create_index("ix_sessions_run_id", "sessions", ["run_id"])

    # ── batch key 복합 인덱스 ─────────────────────────────────────
    op.create_index(
        "ix_eeg_feature_window_batch_key",
        "eeg_feature_windows",
        ["session_id", "participant_id", "window_index"],
    )
    op.create_index(
        "ix_eeg_raw_chunk_batch_key",
        "eeg_raw_chunks",
        ["session_id", "participant_id", "chunk_index"],
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_eeg_raw_chunk_batch_key", table_name="eeg_raw_chunks")
    op.drop_index("ix_eeg_feature_window_batch_key", table_name="eeg_feature_windows")
    op.drop_index("ix_sessions_run_id", table_name="sessions")
    op.drop_column("sessions", "run_id")
