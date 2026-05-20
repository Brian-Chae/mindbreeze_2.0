"""AI 요약 (Claude) Celery 태스크 — MVP1 스텁"""

import logging
import os
from uuid import UUID

from sqlalchemy.orm import Session as DBSession

from app.models.session import Session
from app.models.record import SessionRecord

logger = logging.getLogger(__name__)

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY")

TEMPLATE_BY_TYPE = {
    "clinical": ["주호소", "관찰", "개입", "다음 단계"],
    "hypnosis": ["유도 단계", "관찰", "후처리", "권고"],
    "meditation": ["수업 흐름", "참여자 반응", "권고"],
}


def _call_claude_summary(session_type: str, transcript: str | None) -> dict:
    """실제 Claude API 호출 자리. MVP1에서는 템플릿 기반 더미 요약."""
    logger.info("[summary_task] Claude stub invoked: type=%s", session_type)
    sections = TEMPLATE_BY_TYPE.get(session_type, ["요약", "관찰", "권고"])
    return {
        "headline": "AI 자동 생성 요약 (스텁)",
        "sections": {sec: f"{sec} 내용 자동 생성됨" for sec in sections},
        "transcript_present": bool(transcript),
    }


def run_summary_inline(session_id: str, db: DBSession) -> None:
    sid = UUID(session_id)
    record = db.query(SessionRecord).filter(SessionRecord.session_id == sid).first()
    session = db.query(Session).filter(Session.id == sid).first()
    if not record or not session:
        logger.warning("[summary_task] not found: %s", session_id)
        return

    try:
        result = _call_claude_summary(session.type, record.transcript)
    except Exception as exc:  # noqa: BLE001
        logger.exception("[summary_task] Claude failed: %s", exc)
        result = {"headline": "요약 실패", "sections": {}, "error": str(exc)}

    summary = dict(record.ai_summary or {})
    summary.update(result)
    record.ai_summary = summary
    record.status = "completed"
    db.commit()


try:
    from celery import shared_task

    @shared_task(name="tasks.summary")
    def summary_task(session_id: str) -> None:
        from app.core.database import SessionLocal

        db = SessionLocal()
        try:
            run_summary_inline(session_id, db)
        finally:
            db.close()
except Exception:  # noqa: BLE001
    pass
