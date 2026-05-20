"""AI 리포트 생성 Celery 태스크 — MVP1 스텁"""

import logging
from uuid import UUID

from sqlalchemy.orm import Session as DBSession

from app.models.session import Session
from app.models.record import SessionRecord, Report, EEGRecord

logger = logging.getLogger(__name__)


def _counselor_content(session: Session, record: SessionRecord | None, eeg: list[EEGRecord]) -> dict:
    summary = (record.ai_summary or {}) if record else {}
    return {
        "title": session.title or f"{session.type} 세션 리포트",
        "session_type": session.type,
        "scheduled_at": session.scheduled_at.isoformat() if session.scheduled_at else None,
        "headline": summary.get("headline", "AI 리포트 (자동 생성)"),
        "sections": summary.get("sections", {}),
        "markers": list(record.markers or []) if record else [],
        "counselor_notes": (record.counselor_notes if record else None),
        "eeg": (
            {
                "available": True,
                "samples": [
                    {
                        "record_id": str(e.id),
                        "duration_sec": e.duration_sec or 0,
                        "analysis": e.analysis_result or {},
                    }
                    for e in eeg
                ],
            }
            if eeg
            else {"available": False}
        ),
        "score": 78,
        "approved": False,
    }


def _client_content(session: Session, record: SessionRecord | None, eeg: list[EEGRecord]) -> dict:
    summary = (record.ai_summary or {}) if record else {}
    sections = summary.get("sections", {}) or {}
    insights = [
        {"title": k, "body": v if isinstance(v, str) else str(v)}
        for k, v in list(sections.items())[:3]
    ]
    return {
        "title": session.title or "내 마음 리포트",
        "session_type": session.type,
        "scheduled_at": session.scheduled_at.isoformat() if session.scheduled_at else None,
        "headline": "오늘의 인사이트",
        "greeting": "오늘 세션을 함께해주셔서 감사합니다.",
        "insights": insights,
        "eeg": (
            {
                "available": True,
                "highlight": "이완 상태가 안정적으로 유지되었습니다.",
            }
            if eeg
            else {"available": False}
        ),
        "score": 82,
        "approved": False,
    }


def generate_report_inline(report_id: str, db: DBSession) -> Report | None:
    rid = UUID(report_id)
    report = db.query(Report).filter(Report.id == rid).first()
    if not report:
        logger.warning("[report_task] report not found: %s", report_id)
        return None
    session = db.query(Session).filter(Session.id == report.session_id).first()
    if not session:
        return report

    record = db.query(SessionRecord).filter(SessionRecord.session_id == session.id).first()
    eeg = db.query(EEGRecord).filter(EEGRecord.session_id == session.id).all()

    try:
        if report.type == "client":
            content = _client_content(session, record, eeg)
        else:
            content = _counselor_content(session, record, eeg)
    except Exception as exc:  # noqa: BLE001
        logger.exception("[report_task] generate failed: %s", exc)
        content = {"headline": "리포트 생성 실패", "error": str(exc), "fallback": True}

    report.content = content
    db.commit()
    db.refresh(report)
    return report


try:
    from celery import shared_task

    @shared_task(name="tasks.report")
    def report_task(report_id: str) -> None:
        from app.core.database import SessionLocal

        db = SessionLocal()
        try:
            generate_report_inline(report_id, db)
        finally:
            db.close()
except Exception:  # noqa: BLE001
    pass
