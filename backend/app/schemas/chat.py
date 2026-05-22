"""채팅 스키마"""

from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field


MessageType = Literal["text", "image", "file", "system"]
RoomType = Literal["direct", "session", "group"]


class RoomCreateRequest(BaseModel):
    client_id: str | None = None
    room_type: RoomType = "direct"
    participant_ids: list[str] | None = None
    name: str | None = None


class MessageCreateRequest(BaseModel):
    content: str = Field(..., min_length=1, max_length=4000)
    type: MessageType = "text"
    file_url: str | None = None


class MessageResponse(BaseModel):
    id: str
    room_id: str
    sender_id: str | None
    type: str
    content: str | None
    file_url: str | None
    event_type: str | None
    created_at: datetime


class MessageListResponse(BaseModel):
    messages: list[MessageResponse]
    next_cursor: str | None = None


class RoomResponse(BaseModel):
    id: str
    session_id: str | None = None
    room_type: str = "session"
    host_id: str | None = None
    name: str | None = None
    peer_id: str | None = None
    created_at: datetime
    unread_count: int = 0


class RoomListResponse(BaseModel):
    rooms: list[RoomResponse]
