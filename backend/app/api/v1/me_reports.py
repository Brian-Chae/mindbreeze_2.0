"""SDD-327 T12 — 회원 본인 리포트 공유 메일 (보내기·이력)."""
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session as DBSession

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.record import Report
from app.models.session import SessionParticipant
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


def _load_own_member_report(report_id: str, current_user: dict, db: DBSession) -> tuple[Report, dict]:
    """본인 리포트의 member_report 를 읽는다. 남의 것 403, 리포트·member_report 없음 404."""
    import uuid as _uuid

    try:
        rid = _uuid.UUID(str(report_id))
    except ValueError:
        raise HTTPException(404, "리포트를 찾을 수 없습니다")
    report = db.query(Report).filter(Report.id == rid).first()
    if report is None or report.type != "client" or not report.participant_id:
        raise HTTPException(404, "리포트를 찾을 수 없습니다")
    participant = db.query(SessionParticipant).filter(
        SessionParticipant.id == report.participant_id, SessionParticipant.session_id == report.session_id
    ).first()
    if participant is None:
        raise HTTPException(404, "리포트를 찾을 수 없습니다")
    svc.assert_member_owns(report, participant, current_user["id"])
    # 승인 전·개인정보 만료·리포트 제외 참가자는 열람 불가(공유 열람과 같은 게이트)
    if report.status != "completed" or participant.pii_scrubbed_at is not None or not participant.report_included:
        raise HTTPException(404, "리포트를 찾을 수 없습니다")
    content = report.content if isinstance(report.content, dict) else {}
    member_report = content.get("member_report")
    if not isinstance(member_report, dict):
        raise HTTPException(404, "개인 리포트가 없습니다")
    return report, member_report


@router.get("/{report_id}/member-report")
def get_member_report(
    report_id: str,
    response: Response,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    """SDD-327 T5: 본인 개인 명상 리포트(v11 계약 JSON)."""
    _report, member_report = _load_own_member_report(report_id, current_user, db)
    response.headers["Cache-Control"] = "no-store"
    return member_report


@router.get("/{report_id}/book.pdf")
def get_member_report_book(
    report_id: str,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    """SDD-327 T5: 본인 명상 기록 책 PDF."""
    from app.services.member_report_book import render_member_report_book

    report, member_report = _load_own_member_report(report_id, current_user, db)
    try:
        pdf = render_member_report_book(member_report)
    except Exception:  # noqa: BLE001
        raise HTTPException(500, "책 PDF를 만들지 못했습니다")
    return Response(
        content=pdf, media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="meditation-record-{str(report.id)[:8]}.pdf"',
                 "Cache-Control": "no-store"},
    )
