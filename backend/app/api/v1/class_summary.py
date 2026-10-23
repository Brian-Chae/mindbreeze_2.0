"""SDD-237 명상 클래스 회차 요약·상담사 클래스 리포트 API.

경로 접두는 /sessions. 요약·리포트 조회는 읽기 전용이다.
"""

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session as DBSession

from app.api.deps import get_current_user
from app.core.database import get_db
from app.schemas.class_report import NotePromptClaimResponse, NotePromptDismissResponse
from app.services import class_summary_service as svc

router = APIRouter(prefix="/sessions", tags=["class-summary"])


@router.post("/{session_id}/note-prompt/claim", response_model=NotePromptClaimResponse)
def claim_note_prompt(
    session_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
) -> dict:
    """진행 기록 안내 노출권을 원자적으로 얻는다. 실패·불명이면 FE 는 카드를 보이지 않는다."""
    return {"show": svc.claim_note_prompt(db, session_id, current_user["id"])}


@router.post("/{session_id}/note-prompt/dismiss", response_model=NotePromptDismissResponse)
def dismiss_note_prompt(
    session_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
) -> dict:
    return {"dismissed_at": svc.dismiss_note_prompt(db, session_id, current_user["id"])}
