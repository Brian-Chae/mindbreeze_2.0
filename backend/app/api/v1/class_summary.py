"""SDD-237 명상 클래스 회차 요약·상담사 클래스 리포트 API.

경로 접두는 /sessions. 요약·리포트 조회는 읽기 전용이다.
"""

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session as DBSession

from app.api.deps import get_current_user
from app.core.database import get_db
from app.schemas.class_report import (
    ClassReportResponse, ClassSummaryResponse, NarrativeEditRequest, NarrativeEditResponse,
    NotePromptClaimResponse, NotePromptDismissResponse,
)
from app.services import class_summary_service as svc

router = APIRouter(prefix="/sessions", tags=["class-summary"])


@router.get("/{session_id}/class-summary", response_model=ClassSummaryResponse)
def get_class_summary(
    session_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
) -> dict:
    """명상 클래스 회차 요약(S0·S1·S2·S6). 읽기 전용."""
    return svc.build_summary(db, session_id, current_user["id"])


@router.get("/{session_id}/class-report", response_model=ClassReportResponse)
def get_class_report(
    session_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
) -> dict:
    """상담사용 클래스 리포트(R1~R5). 읽기 전용."""
    return svc.build_class_report(db, session_id, current_user["id"])


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


@router.patch("/{session_id}/class-report/narrative", response_model=NarrativeEditResponse)
def edit_class_report_narrative(
    session_id: UUID,
    payload: NarrativeEditRequest,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
) -> dict:
    """서사 문장 1개를 수정하거나 AI/규칙 초안으로 되돌린다. 수치·그래프·상태 문구는 수정할 수 없다."""
    return svc.edit_narrative(
        db, session_id, current_user["id"], field=payload.field, text=payload.text, revert=payload.revert,
        base_edited_at=payload.base_edited_at, check_base="base_edited_at" in payload.model_fields_set)
