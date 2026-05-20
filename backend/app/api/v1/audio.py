"""오디오 녹음/청크 업로드 API"""

from fastapi import APIRouter, Depends, File, Form, UploadFile, status
from sqlalchemy.orm import Session as DBSession

from app.api.deps import get_current_user
from app.core.database import get_db
from app.schemas.record import (
    AudioStartRequest,
    AudioStartResponse,
    AudioStopResponse,
    ChunkUploadResponse,
)
from app.services import audio_service

router = APIRouter(prefix="/sessions", tags=["audio"])


@router.post("/{session_id}/audio/start", response_model=AudioStartResponse)
def start_audio(
    session_id: str,
    payload: AudioStartRequest,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    return audio_service.start_recording(session_id, current_user["id"], payload.consent_audio, db)


@router.post("/{session_id}/audio/chunk", response_model=ChunkUploadResponse)
async def upload_chunk(
    session_id: str,
    chunk_index: int = Form(...),
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    content = await file.read()
    return audio_service.save_chunk(session_id, current_user["id"], chunk_index, content, db)


@router.post("/{session_id}/audio/stop", response_model=AudioStopResponse)
def stop_audio(
    session_id: str,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    return audio_service.stop_recording(session_id, current_user["id"], db)
