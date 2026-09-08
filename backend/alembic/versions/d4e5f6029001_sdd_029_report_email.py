"""SDD-029: 참가자 리포트 이메일 수집 및 발송 상태."""
from alembic import op
import sqlalchemy as sa

revision = "d4e5f6029001"
down_revision = "c1d2e3f40288"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("session_participants", sa.Column("report_email", sa.String(320), nullable=True))
    op.add_column("session_participants", sa.Column("report_email_status", sa.String(20), nullable=True))
    op.add_column("session_participants", sa.Column("report_email_sent_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("session_participants", "report_email_sent_at")
    op.drop_column("session_participants", "report_email_status")
    op.drop_column("session_participants", "report_email")
