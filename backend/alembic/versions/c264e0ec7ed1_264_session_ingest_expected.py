"""SDD-264: session_ingest_expected 테이블 추가 (가산) — 폰이 보고한 생성 총량.

- 참여자당 1행. feature/raw_eeg/raw_ppg/raw_acc 는 단조 증가 값(서비스가 max 병합), final 은 최종 보고 여부.
- downgrade: 테이블 drop.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "c264e0ec7ed1"
down_revision = "b260c0ffee01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "session_ingest_expected",
        sa.Column("participant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("session_participants.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("feature", sa.Integer(), nullable=False),
        sa.Column("raw_eeg", sa.Integer(), nullable=True),
        sa.Column("raw_ppg", sa.Integer(), nullable=True),
        sa.Column("raw_acc", sa.Integer(), nullable=True),
        sa.Column("final", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("first_reported_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("reported_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_session_ingest_expected_session_id", "session_ingest_expected", ["session_id"])


def downgrade() -> None:
    op.drop_index("ix_session_ingest_expected_session_id", table_name="session_ingest_expected")
    op.drop_table("session_ingest_expected")
