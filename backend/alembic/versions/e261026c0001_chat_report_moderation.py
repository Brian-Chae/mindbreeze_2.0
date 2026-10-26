"""[MB261026][FIX] 채팅 신고 운영 처리·게시 필터(D4) — 처리 추적 컬럼 + 금칙어 테이블 (가역)

- chat_reports: acknowledged_at / decided_at / handled_by / resolution_note + (status, created_at) 인덱스
- chat_filter_terms: 운영자가 관리하는 금칙어(단어는 넣지 않는다 — 관리자 화면·시드 스크립트로 등록)
"""
from alembic import op

revision = "e261026c0001"
down_revision = "e246a0301001"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""SET LOCAL lock_timeout = '5s'""")
    op.execute("""ALTER TABLE chat_reports ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz""")
    op.execute("""ALTER TABLE chat_reports ADD COLUMN IF NOT EXISTS decided_at timestamptz""")
    op.execute(
        """ALTER TABLE chat_reports ADD COLUMN IF NOT EXISTS handled_by uuid
           REFERENCES users(id) ON DELETE SET NULL"""
    )
    op.execute("""ALTER TABLE chat_reports ADD COLUMN IF NOT EXISTS resolution_note text""")
    op.execute(
        """CREATE INDEX IF NOT EXISTS ix_chat_reports_status_created_at
           ON chat_reports (status, created_at)"""
    )
    op.execute(
        """CREATE TABLE IF NOT EXISTS chat_filter_terms (
               id uuid PRIMARY KEY,
               term varchar(100) NOT NULL,
               normalized_term varchar(100) NOT NULL,
               created_by uuid REFERENCES users(id) ON DELETE SET NULL,
               created_at timestamptz NOT NULL DEFAULT now(),
               CONSTRAINT chat_filter_terms_normalized_term_key UNIQUE (normalized_term)
           )"""
    )


def downgrade():
    op.execute("""DROP TABLE IF EXISTS chat_filter_terms""")
    op.execute("""DROP INDEX IF EXISTS ix_chat_reports_status_created_at""")
    op.execute("""ALTER TABLE chat_reports DROP COLUMN IF EXISTS resolution_note""")
    op.execute("""ALTER TABLE chat_reports DROP COLUMN IF EXISTS handled_by""")
    op.execute("""ALTER TABLE chat_reports DROP COLUMN IF EXISTS decided_at""")
    op.execute("""ALTER TABLE chat_reports DROP COLUMN IF EXISTS acknowledged_at""")
