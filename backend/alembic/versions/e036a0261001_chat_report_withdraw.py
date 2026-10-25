"""채팅 신고 철회 — chat_reports.status / withdrawn_at 추가 (가역)"""
from alembic import op

revision = "e036a0261001"
down_revision = "e036a0243003"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""SET LOCAL lock_timeout = '5s'""")
    op.execute("""ALTER TABLE chat_reports ADD COLUMN IF NOT EXISTS status varchar(20) NOT NULL DEFAULT 'submitted'""")
    op.execute("""ALTER TABLE chat_reports ADD COLUMN IF NOT EXISTS withdrawn_at timestamptz""")


def downgrade():
    op.execute("""ALTER TABLE chat_reports DROP COLUMN IF EXISTS withdrawn_at""")
    op.execute("""ALTER TABLE chat_reports DROP COLUMN IF EXISTS status""")
