"""report unique partial indexes (SDD-140)

리포트 중복 생성을 DB 레벨에서 차단하는 부분 유일 인덱스.
- (session_id, participant_id, type): 참여자별 client 리포트 및 participant 가 지정된 counselor 리포트.
- (session_id, type) WHERE participant_id IS NULL: 참여자 없는 리포트.

Revision ID: e036a0000029
Revises: e036a0000028
Create Date: 2026-10-05
"""
from alembic import op
from sqlalchemy import text

# revision identifiers, used by Alembic.
revision = "e036a0000029"
down_revision = "e036a0000028"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "uq_report_session_participant_type",
        "reports",
        ["session_id", "participant_id", "type"],
        unique=True,
        postgresql_where=text("participant_id IS NOT NULL"),
        sqlite_where=text("participant_id IS NOT NULL"),
    )
    op.create_index(
        "uq_report_session_type",
        "reports",
        ["session_id", "type"],
        unique=True,
        postgresql_where=text("participant_id IS NULL"),
        sqlite_where=text("participant_id IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_report_session_type", table_name="reports")
    op.drop_index("uq_report_session_participant_type", table_name="reports")
