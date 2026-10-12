"""SDD-100: open 상태 방치 세션 자동 취소 Celery 태스크.

- sweep_stale_open_sessions_task: beat 가 주기 호출해 방치된 open 세션을 cancel 처리한다.

취소 로직은 app.services.session_service.sweep_stale_open_sessions 가 담당하고,
여기서는 DB 세션 수명과 태스크 등록만 책임진다(테스트에서 직접 호출 가능).
"""

import logging

from app.core.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="tasks.sweep_stale_open_sessions")
def sweep_stale_open_sessions_task() -> dict:
    """방치된 open 세션 스윕 — 취소 처리된 세션 수를 반환한다."""
    from app.core.database import SessionLocal
    from app.services import session_service

    with SessionLocal() as db:
        cancelled = session_service.sweep_stale_open_sessions(db)

    if cancelled:
        logger.info("[STALE-OPEN-SESSION] cancelled=%d", len(cancelled))

    return {"cancelled": len(cancelled)}
