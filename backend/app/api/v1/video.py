"""SDD-084 — 세션 영상 녹화/청크 업로드 API (audio.py 패턴 복제)"""

from fastapi import APIRouter, Depends, File, Form, UploadFile
from sqlalchemy.orm import Session as DBSession

from app.api.deps import get_current_user
from app.core.database import get_db
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
