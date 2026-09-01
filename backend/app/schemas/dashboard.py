"""SDD-015 — 상담사 / 기관 대시보드 Pydantic 스키마"""

from datetime import datetime

from pydantic import BaseModel


class ClassSummary(BaseModel):
    """대시보드에 표시되는 클래스 1건 요약."""

    id: str
    title: str | None = None
    type: str
    custom_type_name: str | None = None
    status: str
    access_code: str | None = None
    participant_mode: str
    participant_count: int = 0
    guest_count: int = 0
    scheduled_at: datetime | None = None
    started_at: datetime | None = None
    ended_at: datetime | None = None
    created_at: datetime | None = None
    # AI 기록(SessionRecord) 유무 및 상태
    has_record: bool = False
    record_status: str | None = None
    has_summary: bool = False
    report_count: int = 0


class CounselorDashboardResponse(BaseModel):
    counselor_id: str
    counselor_name: str | None = None
    org_id: str | None = None
    org_name: str | None = None
    total_classes: int = 0
    in_progress_classes: int = 0
    completed_classes: int = 0
    total_participants: int = 0
    classes: list[ClassSummary] = []


class OrgCounselorStat(BaseModel):
    """기관 대시보드의 상담사별 실적."""

    id: str
    name: str
    email: str
    class_count: int = 0
    participant_count: int = 0
    completed_count: int = 0


class OrgDashboardResponse(BaseModel):
    org_id: str
    org_name: str
    org_code: str | None = None
    total_counselors: int = 0
    total_classes: int = 0
    total_participants: int = 0
    completed_classes: int = 0
    in_progress_classes: int = 0
    counselors: list[OrgCounselorStat] = []
    classes: list[ClassSummary] = []
