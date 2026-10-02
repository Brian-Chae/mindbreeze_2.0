"""종료 파이프라인 아웃박스 재발행 — Celery beat 주기 태스크.

finalize_on_session_end 가 발행(apply_async)에 실패하거나 프로세스가 발행 직전에 죽으면
PipelineOutbox 행이 pending 으로 남는다. 이 태스크가 주기적으로 pending 건을 조회해
체인을 재발행한다(발행 의도의 최종 보장).
"""

import logging
from datetime import datetime, timedelta, timezone

from app.core.celery_app import celery_app
from app.models.pipeline_outbox import PipelineOutbox

logger = logging.getLogger(__name__)

MAX_ATTEMPTS = 5


@celery_app.task(name="tasks.process_pipeline_outbox")
def process_pipeline_outbox(limit: int = 100) -> dict:
    """pending 파이프라인 아웃박스를 조회해 체인을 재발행한다."""
    from app.core.database import SessionLocal
    from app.services.audio_service import publish_pipeline

    db = SessionLocal()
    published = failed = 0
    try:
        now = datetime.now(timezone.utc)
        items = (
            db.query(PipelineOutbox)
            .filter(
                PipelineOutbox.status == "pending",
                PipelineOutbox.available_at <= now,
            )
            .order_by(PipelineOutbox.created_at)
            .limit(limit)
            .all()
        )
        for item in items:
            try:
                publish_pipeline(
                    str(item.session_id),
                    item.has_recording,
                    item.needs_video_merge,
                    item.needs_report,
                )
                item.status = "published"
                item.last_error = None
                published += 1
            except Exception as exc:
                item.attempts += 1
                item.last_error = str(exc)[:500]
                if item.attempts >= MAX_ATTEMPTS:
                    item.status = "failed"
                else:
                    item.status = "pending"
                    item.available_at = now + timedelta(seconds=2 ** item.attempts)
                failed += 1
                logger.error(
                    "[PIPELINE-OUTBOX] publish failed (id=%s, attempt=%s): %s",
                    item.id,
                    item.attempts,
                    exc,
                )
        db.commit()
    finally:
        db.close()
    return {"published": published, "failed": failed}
