"""6자리 접근 코드 공용 발급 서비스 (SDD-015)

상담사 코드 / 기관 코드(org_code) / 클래스 코드(access_code) 가 모두
동일한 형식(대문자+숫자 6자리)을 쓰므로 발급 로직을 한 곳으로 모은다.
"""

from __future__ import annotations

import secrets
import string
from typing import Callable

from sqlalchemy.orm import Session as DBSession

CODE_ALPHABET = string.ascii_uppercase + string.digits
CODE_LENGTH = 6
MAX_CODE_RETRY = 5


def random_code() -> str:
    """6자리 대문자+숫자 코드 1개 생성."""
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))


def generate_unique_code(
    db: DBSession,
    model: type,
    column_name: str,
    *,
    label: str = "코드",
) -> str:
    """지정한 모델·컬럼에서 중복되지 않는 6자리 코드를 발급한다.

    unique 충돌 시 최대 MAX_CODE_RETRY 회 재시도하고, 모두 실패하면 RuntimeError.
    """
    column = getattr(model, column_name)
    for _ in range(MAX_CODE_RETRY):
        code = random_code()
        if db.query(model).filter(column == code).first() is None:
            return code
    raise RuntimeError(f"{label} 발급에 실패했습니다 (충돌)")


def normalize_code(code: str) -> str:
    """사용자 입력 코드를 비교용으로 정규화 — 공백 제거 + 대문자화."""
    return (code or "").strip().upper()
