"""멤버 명령 계약. 공개 guest ID를 인증 주체로 받지 않는다."""
from typing import Literal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field


class MemberCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")
    operation_key: str = Field(min_length=1, max_length=100)
    expected_revision: int = Field(ge=0)
    reason: str | None = Field(default=None, min_length=1, max_length=1000)


class MemberTransitionCommand(MemberCommand):
    action: Literal["leave", "cancel_waitlist", "rejoin", "remove", "restore", "promote"]


class MemberWaitlistCommand(MemberCommand):
    code: str = Field(min_length=4, max_length=4)


class AttendanceCommand(MemberCommand):
    expected_participation_version: int = Field(ge=0)
    action: Literal['excuse', 'undo_excuse', 'correct_attended', 'correct_absent', 'correct_excused']


class MakeupAssignmentCommand(MemberCommand):
    member_id: UUID
    source_session_id: UUID
    target_session_id: UUID


class AttendanceParticipantResponse(BaseModel):
    """기존 출석 DTO의 문자열 ID·시간 표현을 그대로 유지한다."""
    id: str
    session_id: str
    member_id: str | None
    canonical_member_id: str | None
    attendance_status: str | None
    attendance_kind: str | None
    entered_at: str | None
    makeup_for_session_id: str | None
    makeup_assignment_id: str | None


class AttendanceResponse(BaseModel):
    class_id: str
    revision: int
    participant: AttendanceParticipantResponse
    participation_version: int


class ParticipationParticipantResponse(BaseModel):
    participant_id: str
    member_id: str | None
    canonical_member_id: str | None
    attendance_status: str | None
    entered_at: str | None
    checkin_state: Literal['completed', 'not_completed', 'unknown']
    checkin_at: str | None
    presence_state: Literal['connected', 'disconnected', 'unknown']
    presence_expires_at: str | None


class ParticipationResponse(BaseModel):
    session_id: str
    participation_version: int
    generated_at: str
    presence_ttl_seconds: int
    participants: list[ParticipationParticipantResponse]
