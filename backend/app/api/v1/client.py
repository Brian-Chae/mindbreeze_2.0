"""내담자 관리 API"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.schemas.client import (
    ClientActivityResponse,
    ClientReportsResponse,
    ContactRevealResponse,
    ClientListResponse,
    ClientProfileResponse,
    InviteRequest,
    InviteResponse,
    InviteInfoResponse,
    MemoRequest,
)
from app.services import client_overview_service, client_service

router = APIRouter(prefix="/clients", tags=["clients"])
invite_router = APIRouter(prefix="/invite", tags=["invite"])


@router.get("", response_model=ClientListResponse)
def list_clients(
    q: str | None = Query(None),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    class_id: str | None = Query(None),
    active_within_days: int | None = Query(None, ge=1, le=365),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    clients, total, class_options = client_service.list_clients(
        current_user["id"], q, page, size, db,
        class_id=class_id, active_within_days=active_within_days,
    )
    return ClientListResponse(
        clients=clients, total=total, page=page, class_options=class_options
    )


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


@router.post("/{client_id}/contact-reveal", response_model=ContactRevealResponse)
def reveal_contact(
    client_id: str,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """연락처·생년월일 원문 열람 — 호출마다 active 연결 재검사 + 감사 로그(원문 미기록)."""
    if current_user.get("role") not in ("counselor", "org_admin"):
        raise HTTPException(status_code=403, detail="접근 권한이 없습니다")
    return ContactRevealResponse(
        **client_overview_service.reveal_contact(db, current_user["id"], client_id)
    )


@router.get("/{client_id}/activity", response_model=ClientActivityResponse)
def get_client_activity(
    client_id: str,
    days: int = Query(30, ge=1, le=365),
    types: str | None = Query(None, description="session,checkin,measurement,ai_checkin (쉼표)"),
    limit: int = Query(20, ge=1, le=50),
    cursor: str | None = Query(None),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.get("role") not in ("counselor", "org_admin"):
        raise HTTPException(status_code=403, detail="접근 권한이 없습니다")
    type_list = [t.strip() for t in types.split(",") if t.strip()] if types else None
    return client_overview_service.get_activity(
        db, current_user["id"], client_id,
        days=days, types=type_list, limit=limit, cursor=cursor,
    )


@router.get("/{client_id}/reports", response_model=ClientReportsResponse)
def get_client_reports(
    client_id: str,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.get("role") not in ("counselor", "org_admin"):
        raise HTTPException(status_code=403, detail="접근 권한이 없습니다")
    return client_overview_service.get_reports(db, current_user["id"], client_id)


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
