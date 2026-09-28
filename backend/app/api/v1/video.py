"""SDD-084 — 세션 영상 녹화/청크 업로드 API (audio.py 패턴 복제)"""

import os
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session as DBSession

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.record import SessionRecord
from app.models.session import Session
from app.schemas.record import (
    ChunkUploadResponse,
    VideoStartRequest,
    VideoStartResponse,
    VideoStopResponse,
)
from app.services import video_service

router = APIRouter(prefix="/sessions", tags=["video"])


@router.post("/{session_id}/video/start", response_model=VideoStartResponse)
def start_video(
    session_id: str,
    payload: VideoStartRequest,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    return video_service.start_recording(session_id, current_user["id"], payload.consent_video, db)


@router.post("/{session_id}/video/chunk", response_model=ChunkUploadResponse)
async def upload_video_chunk(
    session_id: str,
    chunk_index: int = Form(...),
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    content = await file.read()
    return video_service.save_chunk(session_id, current_user["id"], chunk_index, content, db)


@router.post("/{session_id}/video/stop", response_model=VideoStopResponse)
def stop_video(
    session_id: str,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    return video_service.stop_recording(session_id, current_user["id"], db)


@router.get("/{session_id}/video/url")
def get_video_url(
    session_id: str,
    request: Request,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    """리포트 영상 리플레이용 재생 URL 발급 (호스트 상담사만).

    S3 object key → presigned GET URL, 로컬 폴백 파일 → stream endpoint 절대 URL.
    """
    sid = UUID(session_id)
    session = db.query(Session).filter(Session.id == sid).first()
    if not session:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")
    if session.host_id != UUID(current_user["id"]) and current_user.get("role") != "platform_admin":
        raise HTTPException(status_code=403, detail="호스트 상담사만 영상을 조회할 수 있습니다")

    record = db.query(SessionRecord).filter(SessionRecord.session_id == sid).first()
    if not record or not record.video_s3_key:
        return {"url": None}
    key = record.video_s3_key
    if key.startswith("video/"):
        return {"url": video_service.get_presigned_video_url(sid, db)}
    # 로컬 폴백 경로 → 스트리밍 endpoint 절대 URL
    base = str(request.base_url).rstrip("/")
    return {"url": f"{base}api/v1/sessions/{session_id}/video/stream"}


@router.get("/{session_id}/video/stream")
def stream_video(
    session_id: str,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    """로컬 폴백 저장된 병합 영상을 스트리밍한다 (dev/자격증명 미설정 환경)."""
    sid = UUID(session_id)
    session = db.query(Session).filter(Session.id == sid).first()
    if not session:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")
    if session.host_id != UUID(current_user["id"]) and current_user.get("role") != "platform_admin":
        raise HTTPException(status_code=403, detail="호스트 상담사만 영상을 조회할 수 있습니다")

    record = db.query(SessionRecord).filter(SessionRecord.session_id == sid).first()
    key = record.video_s3_key if record else None
    if not key or key.startswith("video/") or not os.path.exists(key):
        raise HTTPException(status_code=404, detail="영상 파일이 없습니다")
    return FileResponse(key, media_type="video/webm")
