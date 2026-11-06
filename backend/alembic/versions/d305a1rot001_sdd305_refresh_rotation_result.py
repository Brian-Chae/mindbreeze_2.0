"""SDD-305: refresh_tokens.rotation_result 추가 (가산) — 회전 중복 요청 멱등화용 암호문.

- 값은 Fernet 암호문(회전 직후 유예 시간 안에서만 사용). NULL 허용이라 기존 행에 영향 없음.
- downgrade: 컬럼 drop (이미 발급된 토큰은 그대로 유효).
"""
from alembic import op
import sqlalchemy as sa

revision = "d305a1rot001"
down_revision = "c289a1cap001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("refresh_tokens", sa.Column("rotation_result", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("refresh_tokens", "rotation_result")
