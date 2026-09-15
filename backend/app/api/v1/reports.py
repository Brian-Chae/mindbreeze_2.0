"""AI 리포트 API"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session as DBSession

from app.api.deps import get_current_user, require_roles
from app.core.database import get_db
from app.schemas.report import (
    ReportApprovalRequest,
    ReportAutoApproveSetting,
    ReportCreate,
    ReportListResponse,
    ReportResponse,
    ReportUpdate,
)
from app.services import report_service

router = APIRouter(prefix="/reports", tags=["reports"])


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
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    return report_service.list_reports(current_user["id"], db)


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
