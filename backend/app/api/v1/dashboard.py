"""SDD-015 — 상담사 / 기관 대시보드 API"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session as DBSession

from app.api.deps import get_current_user, require_roles
from app.core.database import get_db
from app.schemas.dashboard import CounselorDashboardResponse, OrgDashboardResponse
from app.services import dashboard_service

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/counselor", response_model=CounselorDashboardResponse)
def counselor_dashboard(
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    """상담사 대시보드 — 본인이 진행한 클래스 목록 + 기록·참여자 수·상태."""
    return dashboard_service.counselor_dashboard(current_user["id"], db)


@router.get("/org", response_model=OrgDashboardResponse)
def org_dashboard(
    current_user: dict = Depends(require_roles("org_admin", "platform_admin")),
    db: DBSession = Depends(get_db),
):
    """기관 대시보드 — 소속 상담사 + 기관 내 모든 클래스 + 통계 (org_admin 전용)."""
    return dashboard_service.org_dashboard(current_user["id"], db)
