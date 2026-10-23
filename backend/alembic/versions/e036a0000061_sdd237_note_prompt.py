"""SDD-237 진행 기록 1회 안내 상태 + 전체 끄기.

additive 컬럼 3개만 추가한다(기존 행: 사용자 켜짐 / 회차 NULL=미안내). 데이터 변환 없음.
"""
from alembic import op

revision = "e036a0000061"
down_revision = "e036a0000060"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""SET LOCAL lock_timeout = '5s'""")
    op.execute("""ALTER TABLE users ADD COLUMN IF NOT EXISTS show_session_note_prompt boolean NOT NULL DEFAULT true""")
    op.execute("""ALTER TABLE sessions ADD COLUMN IF NOT EXISTS note_prompt_seen_at timestamptz""")
    op.execute("""ALTER TABLE sessions ADD COLUMN IF NOT EXISTS note_prompt_dismissed_at timestamptz""")


def downgrade():
    op.execute("""ALTER TABLE sessions DROP COLUMN IF EXISTS note_prompt_dismissed_at""")
    op.execute("""ALTER TABLE sessions DROP COLUMN IF EXISTS note_prompt_seen_at""")
    op.execute("""ALTER TABLE users DROP COLUMN IF EXISTS show_session_note_prompt""")
