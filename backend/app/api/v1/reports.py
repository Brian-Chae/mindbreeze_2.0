"""AI 리포트 API"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session as DBSession

from app.api.deps import get_current_user, require_roles
from app.core.database import get_db
from app.schemas.report import (
    ReportApprovalRequest,
    ReportAutoApproveSetting,
    ReportCreate,
    ReportEmailResendRequest,
    ReportEmailResendResponse,
    ReportListResponse,
    ReportResponse,
    ReportUpdate,
)
from app.services import report_service
from app.services import report_email_service
from app.services.report_pdf_service import pdf_response

router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("/view", response_model=ReportResponse)
def view(token: str, db: DBSession = Depends(get_db)):
    """이메일 report_view 토큰으로 내담자 리포트를 공개 열람한다."""
    return report_email_service.get_report_view_content(token, db)


@router.get("/view/pdf")
def view_pdf(token: str, db: DBSession = Depends(get_db)):
    """기존 report_view 검증을 통과한 메일 수신자에게 PDF를 제공한다."""
    return pdf_response(report_email_service.get_report_view_content(token, db))


@router.get("/auto-approve", response_model=ReportAutoApproveSetting)
def get_auto_approve(
    current_user: dict = Depends(require_roles("counselor")),
    db: DBSession = Depends(get_db),
):
    return report_service.get_auto_approve_setting(current_user["id"], db)


@router.patch("/auto-approve", response_model=ReportAutoApproveSetting)
def update_auto_approve(
    payload: ReportAutoApproveSetting,
    current_user: dict = Depends(require_roles("counselor")),
    db: DBSession = Depends(get_db),
):
    return report_service.update_auto_approve_setting(
        current_user["id"], payload.enabled, db
    )


@router.post("/generate/{session_id}", response_model=ReportResponse)
def generate(
    session_id: str,
    payload: ReportCreate,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    return report_service.generate_report(session_id, current_user["id"], payload.type, db)


@router.get("", response_model=ReportListResponse)
def list_all(
    page: int | None = Query(default=None, ge=1),
    limit: int | None = Query(default=None, ge=1),
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    return report_service.list_reports(current_user["id"], db, page, limit)


@router.get("/{report_id}/pdf")
def download_pdf(
    report_id: str,
    current_user: dict = Depends(require_roles("counselor")),
    db: DBSession = Depends(get_db),
):
    report_service.require_report_host(report_id, current_user["id"], db)
    report = report_service.get_report(report_id, current_user["id"], db)
    if report["status"] != "completed":
        raise HTTPException(409, "승인된 리포트만 PDF로 다운로드할 수 있습니다.")
    return pdf_response(report)


@router.get("/{report_id}", response_model=ReportResponse)
def get_one(
    report_id: str,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    return report_service.get_report(report_id, current_user["id"], db)


@router.put("/{report_id}", response_model=ReportResponse)
def update(
    report_id: str,
    payload: ReportUpdate,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    return report_service.update_report(report_id, current_user["id"], payload, db)


@router.post("/{report_id}/approve", response_model=ReportResponse)
def approve(
    report_id: str,
    payload: ReportApprovalRequest | None = None,  # noqa: ARG001
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    return report_service.approve_report(report_id, current_user["id"], db)


@router.post(
    "/{report_id}/resend-email",
    response_model=ReportEmailResendResponse,
)
def resend_email(
    report_id: str,
    payload: ReportEmailResendRequest,
    current_user: dict = Depends(require_roles("counselor")),
    db: DBSession = Depends(get_db),
):
    report_service.require_report_host(report_id, current_user["id"], db)
    success = report_email_service.resend_report_email(
        report_id,
        str(payload.email),
        db,
    )
    return {"success": success}
