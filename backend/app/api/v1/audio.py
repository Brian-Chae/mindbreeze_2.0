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
from app.services import audio_service, upload_service

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
    # VB-10: 음수 chunk_index 허용 → ge=0 으로 차단.
    chunk_index: int = Form(..., ge=0),
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    # STG-01: 전체 메모리 읽기 + 무제한 크기 대신 스트리밍 조각 읽기로 상한을 강제한다.
    content = await upload_service.read_upload_bounded(
        file, max_bytes=upload_service.MAX_AUDIO_CHUNK_BYTES
    )
    return audio_service.save_chunk(session_id, current_user["id"], chunk_index, content, db)


@router.post("/{session_id}/audio/stop", response_model=AudioStopResponse)
def stop_audio(
    session_id: str,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    return audio_service.stop_recording(session_id, current_user["id"], db)
