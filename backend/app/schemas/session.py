"""세션 관리 Pydantic 스키마"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

SessionType = Literal["clinical", "hypnosis", "meditation"]
SessionStatus = Literal["scheduled", "in_progress", "paused", "completed", "cancelled"]


class SessionCreateRequest(BaseModel):
    type: SessionType
    scheduled_at: datetime
    duration_min: int = Field(..., ge=1, le=600)
    title: str | None = None
    notes: str | None = None
    max_participants: int = Field(1, ge=1, le=100)
    participant_ids: list[str] = Field(default_factory=list)
    force: bool = False


class SessionUpdateRequest(BaseModel):
    scheduled_at: datetime | None = None
    duration_min: int | None = Field(None, ge=1, le=600)
    title: str | None = None
    notes: str | None = None
    max_participants: int | None = Field(None, ge=1, le=100)
    force: bool = False


class ParticipantInfo(BaseModel):
    user_id: str
    band_connected: bool = False
    consent_audio: bool = False
    consent_eeg: bool = False
    is_waitlisted: bool = False
    waitlist_position: int | None = None

    model_config = {"from_attributes": True}


class SessionResponse(BaseModel):
    id: str
    type: SessionType
    status: SessionStatus
    host_id: str
    scheduled_at: datetime
    duration_min: int
    title: str | None = None
    notes: str | None = None
    max_participants: int
    created_at: datetime
    participants: list[ParticipantInfo] = []
    waitlist_count: int = 0

    model_config = {"from_attributes": True}


class SessionListResponse(BaseModel):
    sessions: list[SessionResponse]
    total: int


class InviteParticipantRequest(BaseModel):
    user_id: str


class MarkerRequest(BaseModel):
    timestamp_sec: float = Field(..., ge=0)
    note: str = Field(..., min_length=1, max_length=500)
