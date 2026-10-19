"""SDD-214: 클래스·상담 읽기 API 응답 스키마.

EEG·녹음·전사·리포트 본문과 상담사 메모는 어떤 응답에도 담지 않는다(진행 상태 값만).
"""

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

Area = Literal["meditation", "counseling"]


class UserBrief(BaseModel):
    id: str
    name: str | None = None


class ClassMemberCandidate(BaseModel):
    id: str
    name: str | None = None
    masked_email: str


class ClassMemberCandidatesResponse(BaseModel):
    members: list[ClassMemberCandidate]
    has_more: bool


class NextSession(BaseModel):
    id: str
    seq: int | None = None
    scheduled_at: datetime | None = None
    status: str
    host: UserBrief | None


class Progress(BaseModel):
    completed: int
    total: int


class ClassSummary(BaseModel):
    membership: dict | None = None
    attendance_summary: dict[str, int] | None = None
    capabilities: dict[str, bool] = Field(default_factory=dict)
    id: str
    title: str | None = None
    status: str
    schedule_mode: str
    planned_session_count: int | None = None
    area: Area = "meditation"
    progress: Progress
    session_count: int
    next_session: NextSession | None = None
    has_open_session: bool


class ClassInstructorInfo(BaseModel):
    user_id: str
    name: str | None = None
    role: str
    status: str


class ClassHostView(BaseModel):
    """호스트(강사) 시점에서만 채워진다."""

    access_code: str | None = None
    instructors: list[ClassInstructorInfo]


class ClassDetail(ClassSummary):
    revision: int = 0
    capabilities: dict[str, bool] = {}
    draft_schedule: dict | None = None
    recurrence_rule: dict | None = None
    assignment_rule: dict | None = None
    ends_on: date | None = None
    location_type: str
    location_address: str | None = None
    linkband_mode: str
    record_audio: bool
    record_video: bool = False
    chat_enabled: bool = False
    reminder_offsets: list[int] = Field(default_factory=list)
    capacity: int
    participant_mode: str
    default_duration_min: int
    host_view: ClassHostView | None = None


class ClassListResponse(BaseModel):
    classes: list[ClassSummary]
    total: int


class ClassSessionItem(BaseModel):
    participation_version: int | None = None
    participation_scope: Literal["before_join", "eligible", "outside_membership"] | None = None
    attendance: dict | None = None
    makeup: dict | None = None
    approved_report_ids: list[str] = Field(default_factory=list)
    capabilities: dict[str, bool] = Field(default_factory=dict)
    id: str
    seq: int | None = None
    scheduled_at: datetime | None = None
    status: str
    session_kind: str
    host: UserBrief | None
    host_state: str | None = None
    state_version: int = 0
    duration_min: int = 60
    location_type: str = "online"
    location_address: str | None = None
    assignment_override: bool = False


class ClassSessionsResponse(BaseModel):
    sessions: list[ClassSessionItem]
    total: int


class SessionBrief(BaseModel):
    id: str
    seq: int | None = None
    scheduled_at: datetime | None = None
    status: str


class CounselingSummary(BaseModel):
    id: str
    status: str
    area: Area = "counseling"
    counselor: UserBrief
    client_display: str | None = None
    modality_default: str | None = None
    session_count: int
    next_session: SessionBrief | None = None
    latest_session: SessionBrief | None = None


class CounselingSessionItem(BaseModel):
    id: str
    seq: int | None = None
    scheduled_at: datetime | None = None
    status: str
    type: str
    record_status: str | None = None
    report_status: str | None = None


class CounselingDetail(CounselingSummary):
    sessions: list[CounselingSessionItem]


class CounselingListResponse(BaseModel):
    relationships: list[CounselingSummary]
    total: int
