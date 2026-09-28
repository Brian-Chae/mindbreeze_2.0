"""SDD-084 — 세션 영상 녹화/청크 업로드 API (audio.py 패턴 복제)"""

from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session as DBSession

from app.api.deps import get_current_user
from app.core.database import get_db
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
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    """리포트 영상 리플레이용 presigned GET URL 발급 (호스트 상담사만)."""
    sid = UUID(session_id)
    session = db.query(Session).filter(Session.id == sid).first()
    if not session:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")
    if session.host_id != UUID(current_user["id"]) and current_user.get("role") != "platform_admin":
        raise HTTPException(status_code=403, detail="호스트 상담사만 영상을 조회할 수 있습니다")
    url = video_service.get_presigned_video_url(sid, db)
    return {"url": url}
