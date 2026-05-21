"""알림 API"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session as DBSession

from app.api.deps import get_current_user
from app.core.database import get_db
from app.schemas.notification import (
    NotificationListResponse,
    NotificationPreferencesRequest,
    NotificationPreferencesResponse,
    UnreadCountResponse,
)
from app.services import notification_service

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("/preferences", response_model=NotificationPreferencesResponse)
def get_preferences(
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    return notification_service.get_preferences(current_user["id"], db)


@router.put("/preferences", response_model=NotificationPreferencesResponse)
def update_preferences(
    payload: NotificationPreferencesRequest,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    return notification_service.update_preferences(
        current_user["id"],
        payload.email.model_dump(),
        payload.in_app.model_dump(),
        db,
    )


@router.get("/unread-count", response_model=UnreadCountResponse)
def get_unread_count(
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    return {"unread": notification_service.unread_count(current_user["id"], db)}


@router.get("", response_model=NotificationListResponse)
def list_notifications(
    only_unread: bool = Query(False),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    return notification_service.list_notifications(
        current_user["id"], db, only_unread=only_unread, limit=limit, offset=offset
    )


@router.put("/read-all")
def mark_all_read(
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    count = notification_service.mark_all_read(current_user["id"], db)
    return {"marked": count}


@router.put("/{notification_id}/read")
def mark_read(
    notification_id: str,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    notification_service.mark_read(notification_id, current_user["id"], db)
    return {"ok": True}
