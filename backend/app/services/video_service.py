"""SDD-084 — 세션 영상 청크 수신 서비스 (audio_service 패턴 복제)

상담사(host) 본인 카메라 영상만 저장한다. 온라인 클래스에서도 내담자 영상·음성은
저장하지 않는다(데이터 프라이버시 정책). STT 등 후처리 파이프라인은 없다.
"""

import logging
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session as DBSession

from app.models.session import Session
from app.models.record import SessionRecord, VideoChunk
from app.services import storage_service

logger = logging.getLogger(__name__)

# S3 자격증명 미설정 환경(로컬/테스트) 폴백 저장 위치 — audio(CHUNK_STORAGE_DIR)와 동일 방식
VIDEO_CHUNK_DIR = Path(os.environ.get("VIDEO_CHUNK_DIR", "/tmp/mindbreeze_video"))


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


def start_recording(session_id: str, host_id: str, consent_video: bool, db: DBSession) -> dict:
    if not consent_video:
        raise HTTPException(status_code=400, detail="영상 녹화 동의가 필요합니다")

    s = _get_host_session(session_id, host_id, db)
    if s.status not in ("scheduled", "in_progress", "paused"):
        raise HTTPException(status_code=400, detail="종료된 세션은 녹화할 수 없습니다")

    record = _get_or_create_record(s.id, db)
    record.video_status = "recording"
    record.video_recording_started_at = _now()
    db.commit()
    db.refresh(record)
    return {
        "session_id": str(s.id),
        "status": record.video_status,
        "started_at": record.video_recording_started_at,
    }


def save_chunk(session_id: str, host_id: str, chunk_index: int, content: bytes, db: DBSession) -> dict:
    s = _get_host_session(session_id, host_id, db)
    record = _get_or_create_record(s.id, db)
    if record.video_status != "recording":
        raise HTTPException(status_code=400, detail="영상 녹화가 시작되지 않았습니다")

    # S3 우선 저장(file_path = object key). 자격증명 미설정 시 로컬 폴백(audio와 동일 방식).
    object_key = f"video/{s.id}/{chunk_index}_{uuid.uuid4().hex}.webm"
    if storage_service.upload_bytes(object_key, content, content_type="video/webm"):
        file_path = object_key
    else:
        VIDEO_CHUNK_DIR.mkdir(parents=True, exist_ok=True)
        local_path = VIDEO_CHUNK_DIR / f"{s.id}_{chunk_index}_{uuid.uuid4().hex}.webm"
        local_path.write_bytes(content)
        file_path = str(local_path)

    chunk = VideoChunk(
        session_id=s.id,
        chunk_index=chunk_index,
        file_path=file_path,
        size_bytes=len(content),
    )
    db.add(chunk)
    db.commit()

    total = db.query(VideoChunk).filter(VideoChunk.session_id == s.id).count()
    return {
        "chunk_index": chunk_index,
        "received_bytes": len(content),
        "total_chunks": total,
    }


def stop_recording(session_id: str, host_id: str, db: DBSession) -> dict:
    s = _get_host_session(session_id, host_id, db)
    record = _get_or_create_record(s.id, db)
    # 멱등 종료 — 녹화 중일 때만 상태를 전이한다(중복 stop/미시작 stop 허용)
    if record.video_status == "recording":
        record.video_status = "completed"
        record.video_recording_ended_at = _now()
        db.commit()
        db.refresh(record)

    total = db.query(VideoChunk).filter(VideoChunk.session_id == s.id).count()
    return {
        "session_id": str(s.id),
        "status": record.video_status,
        "total_chunks": total,
        "ended_at": record.video_recording_ended_at,
    }


def finalize_on_session_end(session_id: UUID, db: DBSession) -> None:
    """세션 /end 시 자동 호출. 영상 녹화 중이면 종료 처리."""
    record = db.query(SessionRecord).filter(SessionRecord.session_id == session_id).first()
    if not record or record.video_status != "recording":
        return
    record.video_status = "completed"
    record.video_recording_ended_at = _now()
    db.commit()
