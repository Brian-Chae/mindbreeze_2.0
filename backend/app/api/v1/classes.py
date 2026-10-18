"""클래스(명상 프로그램) 읽기 API (SDD-214). 쓰기 API 는 Phase 3."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session as DBSession

from app.api.deps import get_current_user
from app.core.database import get_db
from app.schemas.class_parent import ClassDetail, ClassListResponse, ClassSessionsResponse
from app.services import class_read_service

router = APIRouter(prefix="/classes", tags=["classes"])


@router.get("", response_model=ClassListResponse)
def list_classes(
    status: str | None = Query(default=None, max_length=12),
    page: int | None = Query(default=None, ge=1),
    limit: int | None = Query(default=None, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    classes, total = class_read_service.list_classes(current_user["id"], db, status=status, page=page, limit=limit)
    return ClassListResponse(classes=classes, total=total)


@router.get("/{class_id}", response_model=ClassDetail)
def get_class(
    class_id: str,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    return class_read_service.get_class_detail(class_id, current_user["id"], db)


@router.get("/{class_id}/sessions", response_model=ClassSessionsResponse)
def list_class_sessions(
    class_id: str,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    sessions, total = class_read_service.list_class_sessions(class_id, current_user["id"], db)
    return ClassSessionsResponse(sessions=sessions, total=total)
