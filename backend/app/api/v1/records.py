"""AI 기록지 조회/편집 API"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session as DBSession

from app.api.deps import get_current_user
from app.core.database import get_db
from app.schemas.record import RecordResponse, RecordUpdateRequest, TranscriptResponse
from app.services import record_service

router = APIRouter(prefix="/sessions", tags=["records"])


@router.get("/{session_id}/record", response_model=RecordResponse)
def get_record(
    session_id: str,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    return record_service.get_record(session_id, current_user["id"], db)


@router.put("/{session_id}/record", response_model=RecordResponse)
def update_record(
    session_id: str,
    payload: RecordUpdateRequest,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    return record_service.update_record(session_id, current_user["id"], payload, db)


@router.get("/{session_id}/transcript", response_model=TranscriptResponse)
def get_transcript(
    session_id: str,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    return record_service.get_transcript(session_id, current_user["id"], db)
