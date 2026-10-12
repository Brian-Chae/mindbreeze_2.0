"""normalize user emails to lowercase (MB2-AUTH-02)

이메일을 대소문자 무관하게 동일 계정으로 취급하기 위해 기존 users.email 을
lower(trim(email)) 로 정규화한다. 애플리케이션은 저장 시 .strip().lower() 로
정규화하고 조회를 func.lower(User.email) 로 통일하므로, 이 마이그레이션은
기존 데이터 백필만 담당한다.

unique 제약 주의:
  users.email 에는 (대소문자 구분) unique 인덱스가 걸려 있다. 정규화로 서로 다른
  두 행이 같은 값이 되면 UPDATE 가 제약을 위반한다. 이를 사전에 감지해, 충돌이
  하나라도 있으면 부분 갱신으로 데이터가 어중간해지지 않도록 즉시 중단(RuntimeError)
  하고 운영자가 수동 정리한 뒤 재실행하게 한다.

Revision ID: e036a0000030
Revises: e036a0000029
Create Date: 2026-10-06
"""

from alembic import context, op
from sqlalchemy import text

# revision identifiers, used by Alembic.
revision = "e036a0000030"
down_revision = "e036a0000029"
branch_labels = None
depends_on = None

_NORMALIZE_UPDATE = (
    "UPDATE users SET email = lower(trim(email)) WHERE email <> lower(trim(email))"
)


def upgrade() -> None:
    # --sql 오프라인 렌더링에서는 결과 조회(SELECT)가 불가하므로 UPDATE 만 출력한다.
    if context.is_offline_mode():
        op.execute(_NORMALIZE_UPDATE)
        return

    conn = op.get_bind()

    # 1) 정규화 충돌 사전 탐지 — lower(trim(email)) 기준 중복이 있으면 중단.
    duplicates = conn.execute(
        text(
            """
            SELECT lower(trim(email)) AS normalized, count(*) AS cnt
            FROM users
            GROUP BY lower(trim(email))
            HAVING count(*) > 1
            """
        )
    ).fetchall()
    if duplicates:
        detail = ", ".join(f"{row[0]}({row[1]}건)" for row in duplicates)
        raise RuntimeError(
            "이메일 정규화 충돌: 대소문자/공백만 다른 중복 계정이 있어 정규화할 수 없습니다. "
            f"수동 정리 후 재실행하세요 → {detail}"
        )

    # 2) 충돌이 없으므로 안전하게 일괄 정규화.
    conn.execute(text(_NORMALIZE_UPDATE))


def downgrade() -> None:
    # 원본 대소문자·공백 표기는 보존되지 않아 복원할 수 없다(데이터 손실은 없음).
    pass
