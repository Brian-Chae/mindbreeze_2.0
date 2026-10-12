"""audio/video 청크 보관·고아 정리 스윕 태스크 (STG-03).

- 생성 후 보관 기간(MEDIA_RETENTION_DAYS)을 넘긴 audio/video 청크를 행·실제 미디어와 함께
  정리한다(EEG raw 는 eeg_raw_task 가 담당).
- 부모 세션이 사라진 고아 청크도 방어적으로 정리한다.

beat/ cron 이 주기 호출한다(sweep_stale_media_cron.py 참조).
"""

import logging

from sqlalchemy.orm import Session as DBSession

logger = logging.getLogger(__name__)


def run_sweep_stale_media(db: DBSession) -> dict:
    """동기 실행 헬퍼 — Celery 비활성 환경/테스트에서 직접 호출."""
    from app.services import media_cleanup_service

    result = media_cleanup_service.sweep_stale_media(db)
    logger.info("[media_cleanup_task] 스윕 완료: %s", result)
    return result


try:
    from app.core.celery_app import celery_app

    @celery_app.task(name="tasks.sweep_stale_media")
    def sweep_stale_media_task() -> dict:
        from app.core.database import SessionLocal

        db = SessionLocal()
        try:
            return run_sweep_stale_media(db)
        finally:
            db.close()
except Exception:  # noqa: BLE001
    # MB-ERR-001: 등록 예외를 삼키면 보관 스윕이 미등록된 채 조용히 유실된다.
    logger.exception("[media_cleanup_task] Celery 태스크 등록 실패 — 태스크 미등록 가능")
