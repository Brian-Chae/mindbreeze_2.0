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
