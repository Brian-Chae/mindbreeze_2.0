"""상담 관계 읽기 API (SDD-214). 쓰기 API 는 Phase 6."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session as DBSession

from app.api.deps import get_current_user
from app.core.database import get_db
from app.schemas.class_parent import CounselingDetail, CounselingListResponse
from app.services import class_read_service

router = APIRouter(prefix="/counseling", tags=["counseling"])


@router.get("", response_model=CounselingListResponse)
def list_counseling(
    status: str | None = Query(default=None, max_length=10),
    page: int | None = Query(default=None, ge=1),
    limit: int | None = Query(default=None, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    relationships, total = class_read_service.list_counseling(current_user["id"], db, status=status, page=page, limit=limit)
    return CounselingListResponse(relationships=relationships, total=total)


@router.get("/{relationship_id}", response_model=CounselingDetail)
def get_counseling(
    relationship_id: str,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    return class_read_service.get_counseling_detail(relationship_id, current_user["id"], db)
