"""SDD-036 HRV·움직임 nullable 컬럼 추가

Revision ID: 4235a5871ac6
Revises: d4e5f6029001
Create Date: 2026-09-08 22:32:58.291349

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# Alembic 리비전 식별자.
revision: str = '4235a5871ac6'
down_revision: Union[str, Sequence[str], None] = 'd4e5f6029001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """HRV·움직임 컬럼을 추가한다. 기존 행은 NULL을 유지한다."""
    # Alembic 자동 생성 결과 — 7개 컬럼 변경만 검토 완료.
    op.add_column('eeg_feature_windows', sa.Column('sdnn', sa.Float(), nullable=True))
    op.add_column('eeg_feature_windows', sa.Column('rmssd', sa.Float(), nullable=True))
    op.add_column('eeg_feature_windows', sa.Column('lf_power', sa.Float(), nullable=True))
    op.add_column('eeg_feature_windows', sa.Column('hf_power', sa.Float(), nullable=True))
    op.add_column('eeg_feature_windows', sa.Column('lf_hf_ratio', sa.Float(), nullable=True))
    op.add_column('eeg_feature_windows', sa.Column('heart_rate', sa.Float(), nullable=True))
    op.add_column('eeg_feature_windows', sa.Column('motion', sa.Float(), nullable=True))


def downgrade() -> None:
    """이번 리비전에서 추가한 컬럼만 제거한다."""
    # Alembic 자동 생성 결과 — 7개 컬럼 변경만 검토 완료.
    op.drop_column('eeg_feature_windows', 'motion')
    op.drop_column('eeg_feature_windows', 'heart_rate')
    op.drop_column('eeg_feature_windows', 'lf_hf_ratio')
    op.drop_column('eeg_feature_windows', 'hf_power')
    op.drop_column('eeg_feature_windows', 'lf_power')
    op.drop_column('eeg_feature_windows', 'rmssd')
    op.drop_column('eeg_feature_windows', 'sdnn')
