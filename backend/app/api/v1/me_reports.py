"""SDD-327 T12 — 회원 본인 리포트 공유 메일 (보내기·이력)."""
from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session as DBSession

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.user import User
from app.schemas.report_share import (
    ReportShareHistoryItem,
    ReportShareHistoryResponse,
    ReportShareRequest,
)
from app.services import report_share_service as svc

router = APIRouter(prefix="/me/reports", tags=["me-reports"])


class MemberShareRequest(ReportShareRequest):
    """민감정보 확인(acknowledged) 체크는 서버에서도 필수로 강제한다."""

    acknowledged: bool = Field(default=False)


class RejectedItem(BaseModel):
    masked: str
    reason: str


class AcceptedItem(BaseModel):
    masked: str
    event_id: str
    status: str


class MemberShareResponse(BaseModel):
    accepted: list[AcceptedItem]
    rejected: list[RejectedItem]
    accepted_count: int
    attached: bool
    daily_remaining: int | None = None


@router.post("/{report_id}/share-email", response_model=MemberShareResponse, status_code=202)
def share_email(
    report_id: str,
    payload: MemberShareRequest,
    response: Response,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    """본인 리포트를 최대 3개 주소로 공유한다. 큐잉만 하고 202로 응답한다."""
    from fastapi import HTTPException

    report, _session, participant = svc.load_shareable_report(report_id, db)
    svc.assert_member_owns(report, participant, current_user["id"])
    if not payload.acknowledged:
        raise HTTPException(422, "개인 기록 공유에 대한 확인이 필요합니다")
    user = db.query(User).filter(User.id == current_user["id"]).first()
    actor = svc.ShareActor(
        user_id=current_user["id"], kind="member", display_name=svc.resolve_display_name(user)
    )
    result = svc.share_report(
        db, report_id, actor, payload.recipients, payload.attach_pdf, payload.message
    )
    response.headers["Cache-Control"] = "no-store"
    return result


@router.get("/{report_id}/share-history", response_model=ReportShareHistoryResponse)
def share_history(
    report_id: str,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    """본인이 보낸 공유 이력(최근 50건, 주소는 마스킹)."""
    report, _session, participant = svc.load_shareable_report(report_id, db)
    svc.assert_member_owns(report, participant, current_user["id"])
    rows = svc.list_share_history(db, report_id, current_user["id"])
    return ReportShareHistoryResponse(
        items=[ReportShareHistoryItem.model_validate(r) for r in rows]
    )
