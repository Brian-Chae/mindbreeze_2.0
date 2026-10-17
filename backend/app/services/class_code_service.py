"""클래스 입장 코드 — 로그인 없는 공통 4자리 숫자 코드 (SDD-209 B4 / BE-4 · P5).

- 형식: ``[0-9]{4}`` **문자열**(선행 0 보존 — 정수 변환 금지). 10,000 공간.
- 유일성: **활성(입장 가능) 클래스 사이에서만** 중복 없음(DB 부분 유니크 인덱스
  ``uq_sessions_active_access_code``). 종료·취소·숨김 클래스의 값은 보존되지만 재사용될 수 있다.
- 무효화: 종료·취소(·숨김) 클래스는 조회되지 않는다 → 코드는 값만 남고 입장에 쓰이지 않는다.
- 공개 응답 동일화: 없는/틀린/형식 오류/종료/취소/숨김/템플릿 코드는 모두 ``None`` 이다.
  호출측은 반드시 같은 형태의 404 로 응답한다(정보 비노출).
- 코드는 상시 인증 토큰이 아니다 — 입장 시도 제한은 class_code_attempt_service 참고.
"""

from __future__ import annotations

import re
import secrets

from fastapi import HTTPException, status
from sqlalchemy import case
from sqlalchemy.orm import Session as DBSession

from app.models.session import Session

CLASS_CODE_LENGTH = 4
CLASS_CODE_SPACE = 10 ** CLASS_CODE_LENGTH
# 입장 불가(종료) 상태 — 이 상태의 코드는 무효다.
CLOSED_STATUSES = ("completed", "cancelled")

_CODE_RE = re.compile(r"[0-9]{4}")  # ASCII 숫자만(유니코드 숫자·공백 거부)


class ClassCodeExhausted(RuntimeError):
    """활성 클래스가 코드 공간(10,000)을 모두 점유해 발급할 수 없다."""


def is_valid_class_code(code: str | None) -> bool:
    return isinstance(code, str) and _CODE_RE.fullmatch(code) is not None


def normalize_class_code(code: str | None) -> str | None:
    """입력 코드를 비교용으로 정리한다. 앞뒤 공백만 제거하고 형식이 틀리면 ``None``.

    선행 0 은 그대로 유지한다(``"0042"`` 는 ``"0042"``). 정수 변환을 하지 않는다.
    """
    if code is None:
        return None
    stripped = code.strip()
    return stripped if is_valid_class_code(stripped) else None


def _active_codes(db: DBSession) -> set[str]:
    rows = (
        db.query(Session.access_code)
        .filter(
            Session.access_code.is_not(None),
            Session.is_template.is_(False),
            Session.status.notin_(CLOSED_STATUSES),
        )
        .all()
    )
    return {c for (c,) in rows if is_valid_class_code(c)}


def generate_class_code(db: DBSession) -> str:
    """활성 클래스와 겹치지 않는 4자리 코드를 균등 확률로 발급한다.

    공간 소진 시 ``ClassCodeExhausted``. 동시 발급 경합은 부분 유니크 인덱스가 최종 방어하며,
    호출측(create_session)이 IntegrityError 시 재발급한다.
    """
    used = _active_codes(db)
    if len(used) >= CLASS_CODE_SPACE:
        raise ClassCodeExhausted("사용 가능한 클래스 코드가 없습니다")
    # 점유율이 낮을 때는 무작위 시도가 빠르고, 높을 때는 남은 목록에서 고른다(균등 유지).
    if len(used) < CLASS_CODE_SPACE // 2:
        while True:
            candidate = f"{secrets.randbelow(CLASS_CODE_SPACE):0{CLASS_CODE_LENGTH}d}"
            if candidate not in used:
                return candidate
    free = [f"{n:0{CLASS_CODE_LENGTH}d}" for n in range(CLASS_CODE_SPACE)]
    free = [c for c in free if c not in used]
    return secrets.choice(free)


def exhausted_http_error() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="지금은 새 클래스 코드를 만들 수 없어요. 잠시 후 다시 시도해 주세요.",
    )


def find_enterable_session(
    db: DBSession, code: str | None, *, include_closed: bool = False
) -> Session | None:
    """입장 가능한 활성 클래스를 코드로 찾는다. 어떤 이유로든 없으면 ``None``(사유 비구분).

    ``include_closed`` 는 B5b 에서 제거될 by-code 상태/토큰 경로의 임시 허용이다 — 신규 입장 경로에서
    쓰지 않는다.
    """
    normalized = normalize_class_code(code)
    if normalized is None:
        return None
    query = db.query(Session).filter(
        Session.access_code == normalized,
        Session.is_template.is_(False),
    )
    if not include_closed:
        query = query.filter(Session.status.notin_(CLOSED_STATUSES))
    # 종료 클래스를 포함할 때 같은 값을 재사용 중인 활성 클래스가 있으면 활성을 우선한다.
    return query.order_by(case((Session.status.in_(CLOSED_STATUSES), 1), else_=0)).first()
