"""알림 Pydantic 스키마"""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class NotificationResponse(BaseModel):
    id: str
    type: str
    title: str
    body: str | None = None
    is_read: bool = False
    extra: dict[str, Any] | None = None
    created_at: datetime | None = None


class NotificationListResponse(BaseModel):
    notifications: list[NotificationResponse]
    total: int
    unread: int


class UnreadCountResponse(BaseModel):
    unread: int


class NotificationPreferencesResponse(BaseModel):
    email: dict[str, bool]
    in_app: dict[str, bool]


class NotificationPreferencesRequest(BaseModel):
    email: dict[str, bool] = Field(default_factory=dict)
    in_app: dict[str, bool] = Field(default_factory=dict)
