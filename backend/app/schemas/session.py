"""세션 관리 Pydantic 스키마"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

SessionType = Literal["clinical", "hypnosis", "meditation", "custom"]
SessionStatus = Literal["scheduled", "in_progress", "paused", "completed", "cancelled"]
LocationType = Literal["online", "offline"]
ParticipantMode = Literal["one_on_one", "group"]
LinkbandMode = Literal["none", "required", "optional"]


class SessionCreateRequest(BaseModel):
    type: SessionType
    custom_type_name: str | None = Field(None, max_length=30)
    scheduled_at: datetime
    duration_min: int = Field(..., ge=1, le=600)
    title: str | None = None
    notes: str | None = None
    max_participants: int = Field(1, ge=1, le=100)
    location_type: LocationType = "offline"
    participant_mode: ParticipantMode = "one_on_one"
    linkband_mode: LinkbandMode = "none"
    sfu_enabled: bool = False
    participant_ids: list[str] = Field(default_factory=list)
    force: bool = False

    @model_validator(mode="after")
    def _validate_custom_type(self) -> "SessionCreateRequest":
        # type=custom 일 때 custom_type_name 필수
        if self.type == "custom" and not (self.custom_type_name and self.custom_type_name.strip()):
            raise ValueError("기타 유형 선택 시 유형 이름을 입력해야 합니다")
        return self


class SessionUpdateRequest(BaseModel):
    type: SessionType | None = None
    custom_type_name: str | None = Field(None, max_length=30)
    scheduled_at: datetime | None = None
    duration_min: int | None = Field(None, ge=1, le=600)
    title: str | None = None
    notes: str | None = None
    max_participants: int | None = Field(None, ge=1, le=100)
    location_type: LocationType | None = None
    participant_mode: ParticipantMode | None = None
    linkband_mode: LinkbandMode | None = None
    sfu_enabled: bool | None = None
    force: bool = False


class ParticipantInfo(BaseModel):
    user_id: str
    band_connected: bool = False
    linkband_device_id: str | None = None
    webrtc_peer_id: str | None = None
    consent_audio: bool = False
    consent_eeg: bool = False
    is_waitlisted: bool = False
    waitlist_position: int | None = None

    model_config = {"from_attributes": True}


class SessionResponse(BaseModel):
    id: str
    type: SessionType
    custom_type_name: str | None = None
    status: SessionStatus
    host_id: str
    scheduled_at: datetime
    duration_min: int
    title: str | None = None
    notes: str | None = None
    max_participants: int
    location_type: LocationType
    participant_mode: ParticipantMode
    linkband_mode: LinkbandMode
    webrtc_room_id: str | None = None
    sfu_enabled: bool = False
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
