"""SDD-088 후속 — 세션 영상 청크 병합 Celery 태스크.

세션 종료 시 영상 청크 병합(다운로드 → 병합 → S3 업로드)을 비동기로 실행해
`/end` 응답 지연을 제거한다. audio_service 가 리포트 체인의 선행 태스크로
삽입하므로 generate_reports_for_session 보다 먼저 실행돼 video_s3_key 가
리포트 생성 전에 준비된다.
"""

import logging
from uuid import UUID

from sqlalchemy.orm import Session as DBSession

logger = logging.getLogger(__name__)


def run_video_merge_inline(session_id: str, db: DBSession) -> None:
    """동기 실행 헬퍼 — Celery 비활성 환경/테스트에서 직접 호출."""
    from app.models.record import SessionRecord
    from app.services import video_service

    sid = UUID(session_id)
    try:
        key = video_service.merge_video_chunks(sid, db)
    except Exception:  # noqa: BLE001
        logger.exception("[video_task] 영상 병합 실패: %s", session_id)
        return
    if key:
        record = db.query(SessionRecord).filter(SessionRecord.session_id == sid).first()
        if record and not record.video_s3_key:
            record.video_s3_key = key
            db.commit()
    logger.info("[video_task] 영상 병합 완료: %s -> %s", session_id, key)


try:
    from app.core.celery_app import celery_app

    @celery_app.task(name="tasks.merge_video_chunks", soft_time_limit=600, time_limit=900)
    def merge_video_chunks_task(session_id: str) -> None:
        from app.core.database import SessionLocal

        db = SessionLocal()
        try:
            run_video_merge_inline(session_id, db)
        finally:
            db.close()
except Exception:  # noqa: BLE001
    pass
