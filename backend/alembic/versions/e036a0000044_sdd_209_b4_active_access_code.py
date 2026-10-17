"""SDD-209 B4: 클래스 코드 — 전역 unique 인덱스 → 활성 클래스 한정 부분 unique 인덱스

- sessions.legacy_access_code: 재발급 시 이전 6자리 값 보존(nullable, 입장 불가).
- ix_sessions_access_code: 전역 unique 인덱스(제약 아님)를 일반 인덱스로 교체.
- uq_sessions_active_access_code: 활성(입장 가능) 클래스에서만 유일한 부분 unique 인덱스.
  제외 조건 = 코드 없음 / 템플릿 / 숨김 / 종료·취소. 종료·취소 코드 값은 행에 보존된다.

안전 규칙(plan §3.4 MG-1):
- 부분 unique 인덱스를 **먼저** 만들고(기존 값은 전역 unique 였으므로 활성 간 중복이 있을 수 없다)
  그 다음 전역 unique 를 일반 인덱스로 바꾼다. 인덱스 교체는 짧은 락 구간이다.
- **롤백은 코드 revert 로만** 한다(스키마 유지). 구 코드는 6자리를 생성하고 부분 인덱스와 호환된다.
  downgrade 는 4자리 재사용으로 중복이 생겼을 수 있어 전역 unique 복원이 실패할 수 있다 — 그 경우
  명시적으로 중단한다(데이터 변경 없음).
- 이 마이그레이션은 데이터를 바꾸지 않는다. 활성 클래스 4자리 재발급은 별도 멱등 스크립트(DS-1).

Revision ID: e036a0000044
Revises: e036a0000043
Create Date: 2026-10-17
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import context, op

revision: str = "e036a0000044"
down_revision: Union[str, Sequence[str], None] = "e036a0000043"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_ACTIVE_PREDICATE = (
    "access_code IS NOT NULL AND is_template = false AND hidden_at IS NULL "
    "AND status NOT IN ('completed', 'cancelled')"
)


def upgrade() -> None:
    op.add_column("sessions", sa.Column("legacy_access_code", sa.String(length=6), nullable=True))

    if not context.is_offline_mode():  # --sql 생성 모드에서는 사전 검사를 건너뛴다
        duplicated = op.get_bind().execute(
            sa.text(
                "SELECT access_code FROM sessions WHERE " + _ACTIVE_PREDICATE +
                " GROUP BY access_code HAVING COUNT(*) > 1 LIMIT 1"
            )
        ).first()
        if duplicated is not None:
            raise RuntimeError("활성 클래스 코드 중복이 있어 부분 unique 인덱스를 만들 수 없습니다")

    op.create_index(
        "uq_sessions_active_access_code",
        "sessions",
        ["access_code"],
        unique=True,
        postgresql_where=sa.text(_ACTIVE_PREDICATE),
    )
    op.drop_index("ix_sessions_access_code", table_name="sessions")
    op.create_index("ix_sessions_access_code", "sessions", ["access_code"], unique=False)


def downgrade() -> None:
    if not context.is_offline_mode():
        duplicated = op.get_bind().execute(
            sa.text(
                "SELECT access_code FROM sessions WHERE access_code IS NOT NULL "
                "GROUP BY access_code HAVING COUNT(*) > 1 LIMIT 1"
            )
        ).first()
        if duplicated is not None:
            raise RuntimeError(
                "코드 값이 재사용되어 전역 unique 인덱스를 복원할 수 없습니다 — 롤백은 코드 revert 로 수행하세요"
            )
    op.drop_index("ix_sessions_access_code", table_name="sessions")
    op.create_index("ix_sessions_access_code", "sessions", ["access_code"], unique=True)
    op.drop_index("uq_sessions_active_access_code", table_name="sessions")
    op.drop_column("sessions", "legacy_access_code")
