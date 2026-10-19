"""SDD-216 편성 계약. 초안의 미정 강사는 허용하되 공개 시 별도 검증한다."""

from datetime import date, datetime, time as ClockTime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class StrictInput(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RecurrenceRule(StrictInput):
    start_now: bool = False
    version: Literal[1] = 1
    start_date: date
    weekdays: list[int] = Field(min_length=1, max_length=7)
    time: ClockTime = ClockTime(19)
    interval_weeks: int = Field(default=1, ge=1, le=52)
    skip_dates: list[date] = Field(default_factory=list, max_length=366)

    @field_validator("weekdays")
    @classmethod
    def valid_days(cls, days):
        if any(day < 1 or day > 7 for day in days) or len(set(days)) != len(days):
            raise ValueError("요일은 월=1~일=7, 중복 없이 지정하세요")
        return sorted(days)

    @field_validator("time")
    @classmethod
    def valid_time(cls, value):
        if (
            value.tzinfo
            or value < ClockTime(7)
            or value > ClockTime(22)
            or value.minute % 5
            or value.second
            or value.microsecond
        ):
            raise ValueError("시작 시각은 07:00~22:00의 5분 단위입니다")
        return value


class AssignmentRule(StrictInput):
    version: Literal[1] = 1
    mode: Literal["all_one", "rotate", "by_weekday", "per_session"] = "all_one"
    host_ids: list[UUID | None] = Field(default_factory=list, max_length=52)
    weekday_hosts: dict[int, UUID | None] = Field(default_factory=dict)


class ScheduleRow(StrictInput):
    client_key: str = Field(min_length=1, max_length=100)
    session_id: UUID | None = None
    seq: int = Field(ge=1)
    scheduled_at: datetime
    duration_min: int = Field(default=60, ge=5, le=480, multiple_of=5)
    location_type: Literal["online", "offline"] = "online"
    location_address: str | None = Field(default=None, max_length=300)
    host_id: UUID | None = None
    session_kind: Literal["regular", "makeup"] = "regular"
    assignment_override: bool = False
    expected_state_version: int | None = Field(default=None, ge=0)

    @field_validator("scheduled_at")
    @classmethod
    def aware_datetime(cls, value):
        if value.tzinfo is None:
            raise ValueError("시간대가 있는 시각이 필요합니다")
        from zoneinfo import ZoneInfo

        RecurrenceRule.valid_time(value.astimezone(ZoneInfo("Asia/Seoul")).time())
        return value

    @model_validator(mode="after")
    def valid_location(self):
        if (
            self.location_type == "offline"
            and not (self.location_address or "").strip()
        ):
            raise ValueError("오프라인 주소가 필요합니다")
        return self


class InstructorInput(StrictInput):
    user_id: UUID
    role: Literal["lead", "assistant"] = "assistant"


class ScheduleInput(StrictInput):
    title: str = Field(min_length=1, max_length=200)
    location_type: Literal["online", "offline"] = "online"
    location_address: str | None = Field(default=None, max_length=300)
    capacity: int = Field(default=10, ge=2, le=100)
    linkband_mode: Literal["none", "optional"] = "optional"
    record_audio: bool = True
    record_video: bool = False
    chat_enabled: bool = False
    schedule_mode: Literal["fixed", "rolling"] = "fixed"
    planned_session_count: int = Field(default=8, ge=1, le=52)
    duration_min: int = Field(default=60, ge=5, le=480, multiple_of=5)
    recurrence_rule: RecurrenceRule
    assignment_rule: AssignmentRule = Field(default_factory=AssignmentRule)
    instructors: list[InstructorInput] = Field(default_factory=list, max_length=100)
    rows: list[ScheduleRow] = Field(default_factory=list, max_length=52)
    reminder_offsets: list[int] = Field(default_factory=lambda: [1440], max_length=5)
    ends_on: date | None = None
    member_ids: list[UUID] = Field(default_factory=list, max_length=100)

    @field_validator("title")
    @classmethod
    def clean_title(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("클래스 이름을 입력하세요")
        return value

    @model_validator(mode="after")
    def valid_settings(self):
        if self.recurrence_rule.start_now:
            if (
                self.schedule_mode != "fixed"
                or self.planned_session_count != 1
                or self.assignment_rule.mode != "all_one"
                or len(self.assignment_rule.host_ids) != 1
                or self.assignment_rule.host_ids[0] is None
                or self.assignment_rule.weekday_hosts
                or self.rows
                or self.ends_on is not None
            ):
                raise ValueError("바로 지금은 진행자 한 명의 단일 회차만 가능합니다")
        elif self.planned_session_count < 2:
            raise ValueError("일반 편성은 최소 2회입니다")
        if self.location_type == "online" and self.capacity > 50:
            raise ValueError("온라인 정원은 최대 50명입니다")
        if self.location_type == "offline" and (
            not self.location_address
            or not self.location_address.strip()
            or self.record_video
        ):
            raise ValueError("오프라인 주소가 필요하며 영상 녹화는 사용할 수 없습니다")
        if self.ends_on and self.ends_on < self.recurrence_rule.start_date:
            raise ValueError("종료일은 시작일 이후여야 합니다")
        if any(x <= 0 or x > 10080 for x in self.reminder_offsets):
            raise ValueError("리마인더는 시작 전 1~10080분입니다")
        if len({i.user_id for i in self.instructors}) != len(self.instructors):
            raise ValueError("강사를 중복 지정할 수 없습니다")
        return self


class WriteCommand(StrictInput):
    operation_key: str = Field(min_length=1, max_length=100)
    expected_revision: int | None = Field(default=None, ge=0)
    confirmed_conflict_fingerprint: str | None = None
    force: bool = False
    reason: str | None = Field(default=None, max_length=1000)


class CreateClassCommand(WriteCommand):
    schedule: ScheduleInput
    status: Literal["draft", "active"] = "active"


class ConflictItem(StrictInput):
    candidate_key: str
    kind: Literal["host", "place", "member"]
    starts_at: datetime
    ends_at: datetime
    other_session_id: UUID | None = None
    other_candidate_key: str | None = None
    parent_title: str | None = None
    seq: int | None = None
    visible: bool = False


class BulkCommand(WriteCommand):
    action: Literal["shift_week", "replace", "cancel"]
    session_ids: list[UUID] = Field(min_length=1, max_length=100)
    expected_state_versions: dict[UUID, int]
    rows: list[ScheduleRow] = Field(default_factory=list, max_length=100)


class DuplicateCommand(WriteCommand):
    start_date: date
    invite_members: bool = False


class AddSessionCommand(WriteCommand):
    row: ScheduleRow
    makeup_for_session_id: UUID | None = None
    member_ids: list[UUID] = Field(default_factory=list, max_length=100)


class TransitionCommand(WriteCommand):
    action: Literal["complete", "cancel", "archive", "restore", "hide"]


class InstructorCommand(WriteCommand):
    user_id: UUID
    role: Literal["lead", "assistant", "guest"] = "assistant"
    scope_session_id: UUID | None = None


class MembersCommand(WriteCommand):
    reactivate: bool = False
    user_ids: list[UUID] = Field(min_length=1, max_length=100)


class HostRequestCommand(WriteCommand):
    candidate_host_id: UUID
    request_kind: Literal["change", "transfer"] = "change"
    expected_state_version: int = Field(ge=0)


class ResolveHostCommand(WriteCommand):
    action: Literal["approve", "accept", "reject", "cancel"]


class UpdateClassCommand(WriteCommand):
    schedule: ScheduleInput


class InstructorRoleCommand(WriteCommand):
    role: Literal["lead", "assistant", "guest"]
    scope_session_id: UUID | None = None


class EmailInvitesCommand(WriteCommand):
    emails: list[str] = Field(min_length=1, max_length=100)


class ClassCodeInput(StrictInput):
    code: str = Field(max_length=20)


class HostCorrectionCommand(WriteCommand):
    expected_state_version: int = Field(ge=0)
    mode: Literal["correct", "note"]
    candidate_host_id: UUID | None = None
    displayed_host_name: str | None = Field(default=None, max_length=100)


class TransitionConfirmation(StrictInput):
    force: bool = False
    confirmed_conflict_fingerprint: str | None = None
