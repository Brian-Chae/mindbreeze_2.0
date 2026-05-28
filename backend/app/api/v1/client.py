"""내담자 관리 API"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.schemas.client import (
    ClientListResponse,
    ClientProfileResponse,
    InviteRequest,
    InviteResponse,
    InviteInfoResponse,
    MemoRequest,
)
from app.services import client_service

router = APIRouter(prefix="/clients", tags=["clients"])
invite_router = APIRouter(prefix="/invite", tags=["invite"])


@router.get("", response_model=ClientListResponse)
def list_clients(
    q: str | None = Query(None),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    clients, total = client_service.list_clients(
        current_user["id"], q, page, size, db
    )
    return ClientListResponse(clients=clients, total=total, page=page)


@router.get("/{client_id}", response_model=ClientProfileResponse)
def get_client_profile(
    client_id: str,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    data = client_service.get_client_profile(
        client_id, current_user["id"], db
    )
    return ClientProfileResponse(**data)


@router.put("/{client_id}/memo")
def update_memo(
    client_id: str,
    req: MemoRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    client_service.update_memo(client_id, current_user["id"], req.memo, db)
    return {"detail": "메모가 저장되었습니다"}


@router.post("/invite", response_model=InviteResponse)
def create_invite(
    req: InviteRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.get("role") != "counselor":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="상담사만 초대할 수 있습니다",
        )
    result = client_service.create_invite(
        current_user["id"], req.email, db
    )
    return InviteResponse(**result)


@invite_router.get("/{token}", response_model=InviteInfoResponse)
def get_invite(token: str, db: Session = Depends(get_db)):
    data = client_service.get_invite(token, db)
    return InviteInfoResponse(**data)
