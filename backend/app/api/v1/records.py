"""AI 기록지 조회/편집 API"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session as DBSession

from app.api.deps import get_current_user, get_current_user_optional
from app.core.database import get_db
from app.schemas.record import (
    CheckinRequest,
    CheckinResponse,
    RecordResponse,
    RecordUpdateRequest,
    TranscriptResponse,
)
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


@router.post("/{session_id}/checkin", response_model=CheckinResponse)
def submit_checkin(
    session_id: str,
    payload: CheckinRequest,
    current_user: dict | None = Depends(get_current_user_optional),
    db: DBSession = Depends(get_db),
):
    """SDD-096: 세션 직후 1탭 셀프 체크인 — SAM 2축(각성·정서) 5단계 + 한 줄 소감.

    종료 화면에서 회원/게스트가 바로 남기는 주관 상태를 저장한다(스킵 가능).
    로그인 회원은 본인 참여자로 한정되고, 게스트는 participant_id + participant_token
    소유 증명이 필요하다(member livekit token·손들기와 동일한 인증 분기).
    밴드 미착용(LINK BAND 없이) 세션도 주관 기록이 남도록 레코드를 보장한다.
    """
    return record_service.submit_checkin(
        session_id, payload, current_user["id"] if current_user else None, db
    )


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
