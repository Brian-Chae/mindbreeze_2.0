"""SDD-220 채팅 신고·상호 차단 스키마.

기존 테이블은 변경하지 않고 새 테이블 2개(chat_reports, chat_blocks)만 추가한다.
pair 는 (user_low_id < user_high_id) 로 정규화해 unique 로 둔다.
"""
from alembic import op

revision = "e036a0000060"
# 통합 때 감독자가 e036a0000059(ⓒ) 뒤로 변경한다.
down_revision = "e036a0000058"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""SET LOCAL lock_timeout = '5s'""")
    op.execute("""CREATE TABLE chat_reports (
        id uuid PRIMARY KEY,
        reporter_id uuid NOT NULL REFERENCES users(id),
        reported_user_id uuid NOT NULL REFERENCES users(id),
        room_id uuid REFERENCES chat_rooms(id) ON DELETE SET NULL,
        message_id uuid REFERENCES chat_messages(id) ON DELETE SET NULL,
        reason varchar(40),
        message_excerpt text,
        operation_key varchar(100) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_chat_reports_reporter_operation UNIQUE (reporter_id, operation_key)
    )""")
    op.execute("""CREATE INDEX ix_chat_reports_reported_user_id ON chat_reports(reported_user_id)""")

    op.execute("""CREATE TABLE chat_blocks (
        id uuid PRIMARY KEY,
        user_low_id uuid NOT NULL REFERENCES users(id),
        user_high_id uuid NOT NULL REFERENCES users(id),
        blocker_id uuid NOT NULL REFERENCES users(id),
        report_id uuid REFERENCES chat_reports(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_chat_blocks_pair UNIQUE (user_low_id, user_high_id),
        CONSTRAINT ck_chat_blocks_pair_order CHECK (user_low_id < user_high_id)
    )""")
    op.execute("""CREATE INDEX ix_chat_blocks_user_high_id ON chat_blocks(user_high_id)""")


def downgrade():
    op.execute("""DROP TABLE IF EXISTS chat_blocks""")
    op.execute("""DROP TABLE IF EXISTS chat_reports""")
