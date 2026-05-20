"""오디오 청크 수신 및 STT 트리거 서비스"""

import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session as DBSession

from app.models.session import Session, SessionParticipant
from app.models.record import SessionRecord, AudioChunk

CHUNK_STORAGE_DIR = Path(os.environ.get("AUDIO_CHUNK_DIR", "/tmp/mindbreeze_audio"))


def _to_uuid(value: str) -> UUID:
    try:
        return UUID(str(value))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="잘못된 ID 형식입니다")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _get_host_session(session_id: str, host_id: str, db: DBSession) -> Session:
    sid = _to_uuid(session_id)
    s = db.query(Session).filter(Session.id == sid).first()
    if not s:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")
    if s.host_id != _to_uuid(host_id):
        raise HTTPException(status_code=403, detail="host 상담사만 가능합니다")
    return s


def _get_or_create_record(session_id: UUID, db: DBSession) -> SessionRecord:
    record = db.query(SessionRecord).filter(SessionRecord.session_id == session_id).first()
    if not record:
        record = SessionRecord(session_id=session_id, status="idle", markers=[], edit_history=[], ai_summary={})
        db.add(record)
        db.flush()
    return record


def start_recording(session_id: str, host_id: str, consent_audio: bool, db: DBSession) -> dict:
    if not consent_audio:
        raise HTTPException(status_code=400, detail="음성 녹음 동의가 필요합니다")

    s = _get_host_session(session_id, host_id, db)
    if s.status not in ("scheduled", "in_progress", "paused"):
        raise HTTPException(status_code=400, detail="종료된 세션은 녹음할 수 없습니다")

    record = _get_or_create_record(s.id, db)
    record.status = "recording"
    record.recording_started_at = _now()
    db.commit()
    db.refresh(record)
    return {
        "session_id": str(s.id),
        "status": record.status,
        "started_at": record.recording_started_at,
    }


def save_chunk(session_id: str, host_id: str, chunk_index: int, content: bytes, db: DBSession) -> dict:
    s = _get_host_session(session_id, host_id, db)
    record = _get_or_create_record(s.id, db)
    if record.status not in ("recording", "processing"):
        raise HTTPException(status_code=400, detail="녹음이 시작되지 않았습니다")

    CHUNK_STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    file_path = CHUNK_STORAGE_DIR / f"{s.id}_{chunk_index}_{uuid.uuid4().hex}.bin"
    file_path.write_bytes(content)

    chunk = AudioChunk(
        session_id=s.id,
        chunk_index=chunk_index,
        file_path=str(file_path),
        size_bytes=len(content),
    )
    db.add(chunk)
    db.commit()

    total = db.query(AudioChunk).filter(AudioChunk.session_id == s.id).count()
    return {
        "chunk_index": chunk_index,
        "received_bytes": len(content),
        "total_chunks": total,
    }


def stop_recording(session_id: str, host_id: str, db: DBSession) -> dict:
    s = _get_host_session(session_id, host_id, db)
    record = _get_or_create_record(s.id, db)
    record.status = "processing"
    record.recording_ended_at = _now()
    db.commit()

    total = db.query(AudioChunk).filter(AudioChunk.session_id == s.id).count()

    # MVP1: STT/요약 태스크를 동기 실행 (Celery 비활성 환경 + 테스트 호환)
    from app.tasks.stt_task import run_stt_inline
    from app.tasks.summary_task import run_summary_inline

    run_stt_inline(str(s.id), db)
    run_summary_inline(str(s.id), db)

    db.refresh(record)
    return {
        "session_id": str(s.id),
        "status": record.status,
        "total_chunks": total,
        "ended_at": record.recording_ended_at,
    }


def finalize_on_session_end(session_id: UUID, db: DBSession) -> None:
    """세션 /end 시 자동 호출. 녹음 중이면 종료 처리."""
    record = db.query(SessionRecord).filter(SessionRecord.session_id == session_id).first()
    if not record or record.status != "recording":
        return
    record.status = "processing"
    record.recording_ended_at = _now()
    db.commit()
    from app.tasks.stt_task import run_stt_inline
    from app.tasks.summary_task import run_summary_inline

    run_stt_inline(str(session_id), db)
    run_summary_inline(str(session_id), db)
