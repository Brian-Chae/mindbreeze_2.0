"""SDD-260: eeg_feature_windows 에 late / ingest_path 컬럼 추가 (가산, 기본값 있음).

- late: 세션 종료 후 도착해 저장된 창이면 true (저장은 항상 하고 표식만 남김).
- ingest_path: 'rest'(features/batch 정본 경로) | 'legacy'(기존 소켓/v1 경로로 저장된 행).
  기존 행은 server_default 'legacy' 로 채워진다. REST 배치가 'rest' 를 명시한다.
- downgrade: 두 컬럼 drop.
"""
from alembic import op
import sqlalchemy as sa

revision = "b260c0ffee01"
down_revision = "a253b0c1d2e3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("eeg_feature_windows", sa.Column("late", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.add_column("eeg_feature_windows", sa.Column("ingest_path", sa.String(8), nullable=False, server_default="legacy"))


def downgrade() -> None:
    op.drop_column("eeg_feature_windows", "ingest_path")
    op.drop_column("eeg_feature_windows", "late")
