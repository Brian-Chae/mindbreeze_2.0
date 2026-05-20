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
from app.services import admin_service

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
