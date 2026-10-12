"""가입 신청 API (SDD-073) — 공개 접수 + 플랫폼 관리자 검토"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.v1.admin import require_platform_admin
from app.core.database import get_db
from app.core.redis import get_redis
from app.models.user import User
from app.schemas.signup_application import (
    ApplicationActionResponse,
    ApplicationCreatedResponse,
    ApplicationDetail,
    ApplicationListResponse,
    ApplicationRejectRequest,
    IndividualCounselorApplicationCreate,
    OrganizationApplicationCreate,
)
from app.services import signup_application_service as svc

router = APIRouter(prefix="/signup-applications", tags=["signup-applications"])
admin_router = APIRouter(prefix="/admin/signup-applications", tags=["admin"])


def _require_privacy_consent(agreed: bool) -> None:
    if not agreed:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="개인정보 수집·이용에 동의해야 신청할 수 있습니다",
        )


@router.post(
    "/organization",
    response_model=ApplicationCreatedResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_organization_application(
    req: OrganizationApplicationCreate,
    db: Session = Depends(get_db),
    redis=Depends(get_redis),
):
    """기관 가입 상담 신청 — 접수만 하며 계정·기관을 생성하지 않는다."""
    _require_privacy_consent(req.consents.privacy)
    await svc.check_submit_cooldown(req.email, svc.TYPE_ORGANIZATION, redis)
    app_row = svc.create_organization_application(
        organization_name=req.organization_name,
        contact_name=req.contact_name,
        email=req.email,
        phone=req.phone,
        inquiry=req.inquiry,
        db=db,
    )
    svc.enqueue_notice(app_row, db)
    return ApplicationCreatedResponse(application_id=str(app_row.id), status=app_row.status)


@router.post(
    "/individual-counselor",
    response_model=ApplicationCreatedResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_individual_counselor_application(
    req: IndividualCounselorApplicationCreate,
    db: Session = Depends(get_db),
    redis=Depends(get_redis),
):
    """개인 상담사 신청 — 개인 기관 + pending 상담사 계정 + 프로필 즉시 생성."""
    _require_privacy_consent(req.consents.privacy)
    await svc.check_submit_cooldown(req.email, svc.TYPE_INDIVIDUAL_COUNSELOR, redis)
    app_row = svc.create_individual_counselor_application(
        name=req.name,
        email=req.email,
        email_verify_token=req.email_verify_token,
        phone=req.phone,
        display_name=req.display_name,
        specialties=req.specialties,
        inquiry=req.inquiry,
        db=db,
    )
    svc.enqueue_notice(app_row, db)
    return ApplicationCreatedResponse(application_id=str(app_row.id), status=app_row.status)


# ---------------------------------------------------------------------------
# 플랫폼 관리자 검토
# ---------------------------------------------------------------------------


@admin_router.get("", response_model=ApplicationListResponse)
def list_applications(
    application_type: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    page: int = Query(default=1, ge=1),
    size: int = Query(default=20, ge=1, le=100),
    _admin: User = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    return svc.list_applications(
        db, application_type=application_type, status_filter=status_filter, page=page, size=size
    )


@admin_router.get("/{application_id}", response_model=ApplicationDetail)
def get_application(
    application_id: str,
    _admin: User = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    return svc.get_application_detail(application_id, db)


@admin_router.post("/{application_id}/approve", response_model=ApplicationActionResponse)
async def approve_application(
    application_id: str,
    admin: User = Depends(require_platform_admin),
    db: Session = Depends(get_db),
    redis=Depends(get_redis),
):
    """승인 — 개인 상담사는 바로 active 전환 + 비밀번호 설정 초대 메일 발송."""
    app_row, invite_sent = await svc.approve_application(application_id, admin.id, redis, db)
    return ApplicationActionResponse(
        application=ApplicationDetail(**svc.serialize_application(app_row, detail=True)),
        invite_sent=invite_sent,
    )


@admin_router.post("/{application_id}/reject", response_model=ApplicationActionResponse)
def reject_application(
    application_id: str,
    req: ApplicationRejectRequest,
    admin: User = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    app_row = svc.reject_application(application_id, admin.id, req.reason, db)
    return ApplicationActionResponse(
        application=ApplicationDetail(**svc.serialize_application(app_row, detail=True)),
        invite_sent=False,
    )


@admin_router.post("/{application_id}/resend-notice", response_model=ApplicationActionResponse)
def resend_notice(
    application_id: str,
    _admin: User = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    """운영 알림 재발송 — 큐 적재·발송 실패 복구."""
    app_row = svc.resend_notice(application_id, db)
    return ApplicationActionResponse(
        application=ApplicationDetail(**svc.serialize_application(app_row, detail=True)),
        invite_sent=False,
    )
