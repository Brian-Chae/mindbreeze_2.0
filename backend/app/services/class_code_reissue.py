"""활성 클래스 4자리 코드 재발급 (SDD-209 B4 / DS-1).

마이그레이션과 분리된 **멱등** 데이터 스크립트의 본체다. 배포 직후 입장 가능(활성) 상태이면서
아직 4자리가 아닌(과거 6자리) 코드를 가진 클래스에 새 4자리를 발급한다.

- 이전 값은 ``legacy_access_code`` 에 보존한다(이미 값이 있으면 덮어쓰지 않음).
- 종료·취소·숨김·템플릿 클래스와 코드가 없는 클래스는 건드리지 않는다(LG1 — 과거 값 보존).
- 이미 4자리인 활성 클래스는 건너뛴다 → 재실행해도 결과가 같다(멱등).
- ``dry_run=True`` 는 아무것도 쓰지 않고 건수만 돌려준다. 출력·로그에 코드 값을 싣지 않는다.
- 코드 공간 소진으로 하나라도 발급할 수 없으면 전체를 롤백하고 오류를 낸다.
"""

from __future__ import annotations

import logging

from sqlalchemy.orm import Session as DBSession

from app.models.session import Session
from app.services import class_code_service

logger = logging.getLogger(__name__)


def reissue_active_class_codes(db: DBSession, *, dry_run: bool = True) -> dict:
    active = (
        db.query(Session)
        .filter(
            Session.access_code.is_not(None),
            Session.is_template.is_(False),
            Session.status.notin_(class_code_service.CLOSED_STATUSES),
        )
        .order_by(Session.created_at)
        .all()
    )
    already_ok = [s for s in active if class_code_service.is_valid_class_code(s.access_code)]
    targets = [s for s in active if not class_code_service.is_valid_class_code(s.access_code)]

    summary = {
        "dry_run": dry_run,
        "active_total": len(active),
        "already_4digit": len(already_ok),
        "to_reissue": len(targets),
        "reissued": 0,
    }
    if dry_run or not targets:
        return summary

    used = {s.access_code for s in already_ok}
    free_capacity = class_code_service.CLASS_CODE_SPACE - len(used)
    if len(targets) > free_capacity:
        raise class_code_service.ClassCodeExhausted("재발급할 4자리 코드 공간이 부족합니다")
    try:
        for s in targets:
            while True:
                candidate = class_code_service.generate_class_code(db)
                if candidate not in used:
                    break
            if not s.legacy_access_code:
                s.legacy_access_code = s.access_code
            s.access_code = candidate
            used.add(candidate)
            db.flush()
        db.commit()
    except Exception:
        db.rollback()
        raise
    summary["reissued"] = len(targets)
    logger.info("[class-code-reissue] 활성 클래스 4자리 재발급: %s", summary)
    return summary
