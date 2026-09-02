"""F11 어드민 검토 큐 + 사용자 관리 API"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.user import User
from app.core.redis import get_redis
from app.schemas.org import (
    OrgAdminSummary,
    OrganizationAdminCreate,
    OrganizationAdminResponse,
    OrganizationWithAdminResponse,
    ResendInviteResponse,
)
from app.services import admin_service, org_invite_service, org_service

router = APIRouter(prefix="/admin", tags=["admin"])


def require_platform_admin(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> User:
    try:
        uid = uuid.UUID(current_user["id"])
    except (KeyError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="인증이 필요합니다")
    user = db.query(User).filter(User.id == uid).first()
    if user is None or user.role != "platform_admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="플랫폼 관리자만 접근 가능합니다")
    return user


class ReviewActionRequest(BaseModel):
    action: str
    reason: str | None = None


class BatchReviewItem(BaseModel):
    target_type: str
    target_id: str
    action: str
    reason: str | None = None


class BatchReviewRequest(BaseModel):
    items: list[BatchReviewItem]


class SuspendRequest(BaseModel):
    reason: str


@router.get("/reviews")
def list_reviews(
    document_type: str | None = Query(default=None),
    risk_level: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    size: int = Query(default=20, ge=1, le=100),
    admin: User = Depends(require_platform_admin),  # noqa: ARG001
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    return admin_service.get_review_queue(db, document_type, risk_level, page, size)


@router.get("/reviews/credentials/{credential_id}")
def get_credential_detail(
    credential_id: str,
    admin: User = Depends(require_platform_admin),  # noqa: ARG001
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    try:
        cid = uuid.UUID(credential_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="증빙을 찾을 수 없습니다")
    return admin_service.get_credential_review_detail(cid, db)


@router.get("/reviews/org-documents/{doc_id}")
def get_org_document_detail(
    doc_id: str,
    admin: User = Depends(require_platform_admin),  # noqa: ARG001
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    try:
        did = uuid.UUID(doc_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="문서를 찾을 수 없습니다")
    return admin_service.get_org_document_review_detail(did, db)


@router.post("/reviews/{target_type}/{target_id}/action")
def process_action(
    target_type: str,
    target_id: str,
    req: ReviewActionRequest,
    admin: User = Depends(require_platform_admin),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    try:
        tid = uuid.UUID(target_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="대상을 찾을 수 없습니다")
    return admin_service.process_review(target_type, tid, req.action, req.reason, admin.id, db)


@router.post("/reviews/batch")
def batch_process(
    req: BatchReviewRequest,
    admin: User = Depends(require_platform_admin),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    items = [it.model_dump() for it in req.items]
    return admin_service.batch_process_review(items, admin.id, db)


@router.get("/users")
def list_users(
    role: str | None = Query(default=None),
    q: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    size: int = Query(default=20, ge=1, le=100),
    admin: User = Depends(require_platform_admin),  # noqa: ARG001
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    return admin_service.list_users(db, role, q, page, size)


@router.post("/users/{user_id}/suspend")
def suspend(
    user_id: str,
    req: SuspendRequest,
    admin: User = Depends(require_platform_admin),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    try:
        uid = uuid.UUID(user_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")
    return admin_service.suspend_user(uid, req.reason, admin.id, db)


@router.post("/users/{user_id}/unsuspend")
def unsuspend(
    user_id: str,
    admin: User = Depends(require_platform_admin),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    try:
        uid = uuid.UUID(user_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")
    return admin_service.unsuspend_user(uid, admin.id, db)


# ---------------------------------------------------------------------------
# SDD-015: system_admin 전용 기관 등록 (기관명 → 6자리 기관 코드 발급)
# ---------------------------------------------------------------------------


def _serialize_org(org) -> OrganizationAdminResponse:
    return OrganizationAdminResponse(
        id=str(org.id),
        name=org.name,
        org_code=org.org_code,
        phone=org.phone,
        verified=org.verified,
        created_at=org.created_at.isoformat() if org.created_at else "",
    )


def _serialize_admin(user: User) -> OrgAdminSummary:
    return OrgAdminSummary(
        id=str(user.id), email=user.email, name=user.name, status=user.status
    )


@router.post(
    "/orgs",
    response_model=OrganizationWithAdminResponse,
    status_code=status.HTTP_201_CREATED,
)
async def admin_register_org(
    req: OrganizationAdminCreate,
    _admin: User = Depends(require_platform_admin),
    db: Session = Depends(get_db),
    redis=Depends(get_redis),
):
    """기관 등록 — 6자리 기관 코드 발급 + (선택) 주 담당자 계정 생성 및 초대 발송.

    SDD-016: 담당자 정보를 함께 주면 org_admin 계정을 만들고 비밀번호 설정 링크를
    이메일로 보낸다. 임시 비밀번호는 발급하지 않으며, 담당자는 초대 링크로만 계정을
    활성화할 수 있다. 이메일이 이미 사용 중이면 409로 거부한다.
    """
    if not req.admin_email:
        # 담당자 없이 기관만 등록하는 기존(SDD-015) 동작
        org = org_service.admin_create_organization(req.name, db, phone=req.phone)
        return OrganizationWithAdminResponse(org=_serialize_org(org), admin=None, invite_sent=False)

    org, admin_user = org_service.create_org_with_admin(
        name=req.name,
        admin_name=req.admin_name,
        admin_email=req.admin_email,
        admin_phone=req.admin_phone,
        phone=req.phone,
        address=req.address,
        db=db,
    )
    invite_sent = await org_invite_service.issue_invite(admin_user, org.name, redis)
    return OrganizationWithAdminResponse(
        org=_serialize_org(org),
        admin=_serialize_admin(admin_user),
        invite_sent=invite_sent,
    )


@router.post("/orgs/{org_id}/resend-invite", response_model=ResendInviteResponse)
async def admin_resend_invite(
    org_id: str,
    _admin: User = Depends(require_platform_admin),
    db: Session = Depends(get_db),
    redis=Depends(get_redis),
):
    """주 담당자에게 초대(비밀번호 설정) 링크를 재발송한다.

    이전 토큰은 무효화되지 않지만 각 토큰은 일회용이며 7일 후 만료된다.
    발송 폭탄을 막기 위해 기관당 쿨다운을 둔다.
    """
    org, admin_user = org_service.get_primary_admin(org_id, db)
    await org_invite_service.check_resend_cooldown(str(org.id), redis)
    invite_sent = await org_invite_service.issue_invite(admin_user, org.name, redis)
    await org_invite_service.mark_resent(str(org.id), redis)
    return ResendInviteResponse(admin=_serialize_admin(admin_user), invite_sent=invite_sent)


@router.get("/orgs", response_model=list[OrganizationAdminResponse])
def admin_list_orgs(
    _admin: User = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    """전체 기관 목록 + 발급된 기관 코드."""
    return [_serialize_org(o) for o in org_service.list_organizations(db)]
