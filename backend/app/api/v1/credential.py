"""F3 자격 증빙 API"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.credential import Credential
from app.models.user import User
from app.schemas.credential import (
    AdminVerifyRequest,
    CredentialListResponse,
    CredentialResponse,
)
from app.services import credential_service

router = APIRouter(prefix="/credentials", tags=["credentials"])


def _uid(current_user: dict) -> uuid.UUID:
    return uuid.UUID(current_user["id"])


def _serialize(cred: Credential) -> CredentialResponse:
    return CredentialResponse(
        id=str(cred.id),
        type=cred.type,
        file_name=cred.file_name,
        status=cred.status,
        expires_at=cred.expires_at.isoformat() if cred.expires_at else None,
        created_at=cred.created_at.isoformat() if cred.created_at else "",
    )


@router.post("/upload", response_model=CredentialResponse, status_code=status.HTTP_201_CREATED)
def upload(
    file: UploadFile = File(...),
    type: str = Form(...),
    expires_at: str | None = Form(None),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """자격 증빙 파일 업로드."""
    user_id = _uid(current_user)
    cred = credential_service.upload_credential(user_id, file, type, expires_at, db)
    return _serialize(cred)


@router.get("", response_model=CredentialListResponse)
def list_my_credentials(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """내 자격 증빙 목록 + 현재 인증 등급 + 부족 안내."""
    user_id = _uid(current_user)
    creds = credential_service.list_credentials(user_id, db)
    user = db.query(User).filter(User.id == user_id).first()
    tier = user.verified_tier if user else "unverified"
    return CredentialListResponse(
        credentials=[_serialize(c) for c in creds],
        verified_tier=tier,
        missing=credential_service.missing_credentials(user_id, db),
    )


@router.delete("/{credential_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete(
    credential_id: str,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """pending 상태 증빙 삭제."""
    try:
        cid = uuid.UUID(credential_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="증빙을 찾을 수 없습니다")
    credential_service.delete_credential(cid, _uid(current_user), db)
    return None


@router.put("/admin/{credential_id}", response_model=CredentialResponse)
def admin_verify(
    credential_id: str,
    req: AdminVerifyRequest,
    db: Session = Depends(get_db),
):
    """관리자 승인/반려 (placeholder — 인증 미적용)."""
    try:
        cid = uuid.UUID(credential_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="증빙을 찾을 수 없습니다")
    cred = credential_service.admin_verify(cid, req.status, req.reason, db)
    return _serialize(cred)
