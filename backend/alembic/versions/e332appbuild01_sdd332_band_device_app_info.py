"""SDD-332 session_band_devices: 앱 빌드·OS·기기 모델 컬럼 추가(가산형, nullable)

Revision ID: e332appbuild01
Revises: a327share0001
Create Date: 2026-11-23 12:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "e332appbuild01"
down_revision: Union[str, Sequence[str], None] = "a327share0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_COLS = (("app_version", 32), ("app_build", 16), ("os_name", 16), ("os_version", 32), ("device_model", 64))


def upgrade() -> None:
    for name, n in _COLS:
        op.add_column("session_band_devices", sa.Column(name, sa.String(n), nullable=True))


def downgrade() -> None:
    for name, _ in reversed(_COLS):
        op.drop_column("session_band_devices", name)
