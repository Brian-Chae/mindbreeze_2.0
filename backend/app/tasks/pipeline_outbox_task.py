"""종료 파이프라인 아웃박스 발행·재드라이브 — Celery beat 주기 태스크.

1) pending 재발행: finalize_on_session_end 가 발행(apply_async)에 실패하거나 프로세스가 발행
   직전에 죽으면 PipelineOutbox 행이 pending 으로 남는다. 이 태스크가 pending 건을 조회해
   체인을 재발행한다(발행 의도의 최종 보장).

2) published 재드라이브(CEL-CHAIN-02): 발행은 성공해 status='published' 가 됐지만 체인 중간
   태스크가 크래시해 최종 산출물(리포트)이 없는 경우, 그대로 두면 유실된다. 재드라이브 지연
   (available_at)이 지난 published 건 중 체인이 미완료인 것을 다시 발행한다.
"""

import logging
from datetime import datetime, timedelta, timezone

from app.core.celery_app import celery_app
from app.models.pipeline_outbox import PipelineOutbox

logger = logging.getLogger(__name__)

MAX_ATTEMPTS = 5


def _pipeline_chain_incomplete(item: PipelineOutbox, db) -> bool:
    """CEL-CHAIN-02: published 인데 체인 종료 산출물(리포트)이 없으면 미완료로 본다.

    needs_report 가 참이면 리포트 생성이 체인의 종료 단계다. 리포트 행이 하나라도 있으면
    체인이 끝까지 수행된 것으로 본다(생성 실패도 error 상태 행을 남기므로 무한 재드라이브 방지).
    """
    if not item.needs_report:
        return False
    from app.models.record import Report

    return (
        db.query(Report).filter(Report.session_id == item.session_id).count() == 0
    )


def _publish_chain(item: PipelineOutbox, db) -> None:
    """아웃박스 플래그로 체인을 (재)발행한다."""
    from app.services.audio_service import publish_pipeline

    publish_pipeline(
        str(item.session_id),
        item.has_recording,
        item.needs_video_merge,
        item.needs_report,
    )


@celery_app.task(name="tasks.process_pipeline_outbox")
def process_pipeline_outbox(limit: int = 100) -> dict:
    """pending 파이프라인 아웃박스를 발행하고, published 미완료 건을 재드라이브한다."""
    from app.core.database import SessionLocal
    from app.services.audio_service import PIPELINE_REDRIVE_DELAY_SECONDS

    db = SessionLocal()
    published = failed = redriven = 0
    try:
        now = datetime.now(timezone.utc)

        # ── 1) pending — 발행 실패·프로세스 사망으로 남은 건 재발행 ──
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
                _publish_chain(item, db)
                item.status = "published"
                item.last_error = None
                # 재드라이브 판정 시각을 밀어 정상 체인 수행 중 중복 발행을 막는다.
                item.available_at = now + timedelta(seconds=PIPELINE_REDRIVE_DELAY_SECONDS)
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

        # ── 2) published — 체인 미완료 건 재드라이브(CEL-CHAIN-02) ──
        stale = (
            db.query(PipelineOutbox)
            .filter(
                PipelineOutbox.status == "published",
                PipelineOutbox.available_at <= now,
            )
            .order_by(PipelineOutbox.created_at)
            .limit(limit)
            .all()
        )
        for item in stale:
            if not _pipeline_chain_incomplete(item, db):
                continue
            item.attempts += 1
            try:
                _publish_chain(item, db)
                item.last_error = None
                redriven += 1
                logger.info(
                    "[PIPELINE-OUTBOX] 체인 미완료 재드라이브 (id=%s, attempt=%s)",
                    item.id,
                    item.attempts,
                )
            except Exception as exc:
                item.last_error = str(exc)[:500]
                failed += 1
                logger.error(
                    "[PIPELINE-OUTBOX] re-drive failed (id=%s, attempt=%s): %s",
                    item.id,
                    item.attempts,
                    exc,
                )
            if item.attempts >= MAX_ATTEMPTS:
                # 재드라이브 한도 초과 — 무한 재발행을 멈춘다(운영자 개입 필요).
                item.status = "failed"
            else:
                item.available_at = now + timedelta(seconds=PIPELINE_REDRIVE_DELAY_SECONDS)

        db.commit()
    finally:
        db.close()
    return {"published": published, "failed": failed, "redriven": redriven}
