"""EEG raw 청크 정리 스윕 태스크 (EEG-RAW-03 / EEG-RET-01).

- EEG-RAW-03: presigned 발급 후 ack 되지 않은 pending/고아 청크를 주기적으로 정리한다.
- EEG-RET-01: 업로드 완료 raw 청크의 보관 기간(EEG_RAW_RETENTION_DAYS)을 적용해 경과분을 정리한다.

beat/ cron 이 주기 호출한다(sweep_stale_eeg_raw_cron.py 참조).
"""

import logging

from sqlalchemy.orm import Session as DBSession

logger = logging.getLogger(__name__)


def run_sweep_eeg_raw(db: DBSession) -> dict:
    """동기 실행 헬퍼 — Celery 비활성 환경/테스트에서 직접 호출."""
    from app.services import eeg_raw_service

    result = eeg_raw_service.sweep_stale_eeg_raw(db)
    logger.info("[eeg_raw_task] 스윕 완료: %s", result)
    return result


try:
    from app.core.celery_app import celery_app

    @celery_app.task(name="tasks.sweep_stale_eeg_raw")
    def sweep_stale_eeg_raw_task() -> dict:
        from app.core.database import SessionLocal

        db = SessionLocal()
        try:
            return run_sweep_eeg_raw(db)
        finally:
            db.close()
except Exception:  # noqa: BLE001
    pass
