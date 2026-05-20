"""AI 기록지 조회·편집 서비스"""

from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session as DBSession

from app.models.session import Session, SessionParticipant
from app.models.record import SessionRecord


def _to_uuid(value: str) -> UUID:
    try:
        return UUID(str(value))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="잘못된 ID 형식입니다")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _get_session_for_user(session_id: str, user_id: str, db: DBSession) -> Session:
    sid = _to_uuid(session_id)
    s = db.query(Session).filter(Session.id == sid).first()
    if not s:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")
    uid = _to_uuid(user_id)
    if s.host_id == uid:
        return s
    participant = (
        db.query(SessionParticipant)
        .filter(SessionParticipant.session_id == sid, SessionParticipant.user_id == uid)
        .first()
    )
    if participant:
        return s
    raise HTTPException(status_code=403, detail="접근 권한이 없습니다")


def _get_session_as_host(session_id: str, host_id: str, db: DBSession) -> Session:
    sid = _to_uuid(session_id)
    s = db.query(Session).filter(Session.id == sid).first()
    if not s:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")
    if s.host_id != _to_uuid(host_id):
        raise HTTPException(status_code=403, detail="host 상담사만 가능합니다")
    return s


def _serialize(record: SessionRecord, session_id: UUID) -> dict:
    if record is None:
        return {
            "session_id": str(session_id),
            "status": "idle",
            "transcript": None,
            "ai_summary": {},
            "counselor_notes": None,
            "markers": [],
            "is_edited": False,
            "edit_history": [],
        }
    return {
        "session_id": str(session_id),
        "status": record.status or "idle",
        "transcript": record.transcript,
        "ai_summary": record.ai_summary or {},
        "counselor_notes": record.counselor_notes,
        "markers": list(record.markers or []),
        "is_edited": bool(record.is_edited),
        "edit_history": list(record.edit_history or []),
    }


def get_record(session_id: str, user_id: str, db: DBSession) -> dict:
    s = _get_session_for_user(session_id, user_id, db)
    record = db.query(SessionRecord).filter(SessionRecord.session_id == s.id).first()
    return _serialize(record, s.id)


def get_transcript(session_id: str, user_id: str, db: DBSession) -> dict:
    s = _get_session_for_user(session_id, user_id, db)
    record = db.query(SessionRecord).filter(SessionRecord.session_id == s.id).first()
    summary = (record.ai_summary or {}) if record else {}
    segments = summary.get("segments", []) if isinstance(summary, dict) else []
    return {
        "session_id": str(s.id),
        "status": (record.status if record else "idle") or "idle",
        "segments": segments,
        "raw_text": record.transcript if record else None,
    }


def update_record(session_id: str, host_id: str, payload, db: DBSession) -> dict:
    s = _get_session_as_host(session_id, host_id, db)
    record = db.query(SessionRecord).filter(SessionRecord.session_id == s.id).first()
    if not record:
        record = SessionRecord(session_id=s.id, status="idle", markers=[], edit_history=[], ai_summary={})
        db.add(record)
        db.flush()

    changes: dict = {}
    if payload.counselor_notes is not None:
        changes["counselor_notes"] = {"before": record.counselor_notes, "after": payload.counselor_notes}
        record.counselor_notes = payload.counselor_notes
    if payload.ai_summary is not None:
        changes["ai_summary"] = {"before": record.ai_summary, "after": payload.ai_summary}
        record.ai_summary = payload.ai_summary

    if changes:
        history = list(record.edit_history or [])
        history.append({"edited_at": _now().isoformat(), "editor_id": str(host_id), "changes": changes})
        record.edit_history = history
        record.is_edited = True

    db.commit()
    db.refresh(record)
    return _serialize(record, s.id)
