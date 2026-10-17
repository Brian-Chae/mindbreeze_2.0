"""SDD-209 B5a: 입장 자격 폐기용 버전

- session_participants.entry_ver: NOT NULL, 서버 기본값 0. 입장 자격(JWT)의 ver 와 일치해야 유효.
  올리면 이전 자격이 모두 무효(로그아웃·폐기).

상수 기본값 add column(메타데이터 전용), 기존 행 불변. 롤백: 코드 revert 로 충분(구 코드는 무시).
다운그레이드는 drop 이므로 데이터 손실 — 운영 롤백에는 사용하지 않는다.

Revision ID: e036a0000045
Revises: e036a0000044
Create Date: 2026-10-17
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e036a0000045"
down_revision: Union[str, Sequence[str], None] = "e036a0000044"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "session_participants",
        sa.Column("entry_ver", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("session_participants", "entry_ver")
