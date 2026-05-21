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


class NotificationChannelPreferences(BaseModel):
    session_booked: bool = True
    session_cancelled: bool = True
    chat_message: bool = True
    report_ready: bool = True
    verification_result: bool = True


class NotificationPreferencesResponse(BaseModel):
    email: NotificationChannelPreferences
    in_app: NotificationChannelPreferences


class NotificationPreferencesRequest(BaseModel):
    email: NotificationChannelPreferences = Field(default_factory=NotificationChannelPreferences)
    in_app: NotificationChannelPreferences = Field(default_factory=NotificationChannelPreferences)
