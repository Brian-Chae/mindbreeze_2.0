"""AI 기록지 조회/편집 API"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session as DBSession

from app.api.deps import get_current_user
from app.core.database import get_db
from app.schemas.record import RecordResponse, RecordUpdateRequest, TranscriptResponse
from app.schemas.report import ReportStatusResponse
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


@router.get("/{session_id}/report-status", response_model=ReportStatusResponse)
def get_report_status(
    session_id: str,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    """SDD-095: 리포트 생성 진행 상태 조회.

    세션 종료 후 STT→요약→리포트 생성이 수 분 걸리므로, 종료 화면(대기 화면)이
    최초 1회 조회 + 주기적 폴링으로 스텝퍼를 복원한다. 접근 권한은 세션 호스트/
    참여자로 제한한다(리포트 열람 권한과 동일 규칙).
    """
    return record_service.get_report_status(session_id, current_user["id"], db)
