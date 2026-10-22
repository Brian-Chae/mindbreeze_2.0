"""내담자 관리 스키마"""

from pydantic import BaseModel, EmailStr, Field


class ClientClassRef(BaseModel):
    id: str
    title: str


class ClientSummary(BaseModel):
    id: str
    name: str
    email: str
    concerns: list[str] = []
    last_session_at: str | None = None
    # SDD-230: 가산 필드 — 연락처는 서버 마스킹 값만 내려간다.
    gender: str | None = None
    age: int | None = None
    phone_masked: str | None = None
    classes: list[ClientClassRef] = []
    last_activity_at: str | None = None
    last_activity_source: str | None = None

    model_config = {"from_attributes": True}


class ClientListResponse(BaseModel):
    clients: list[ClientSummary]
    total: int
    page: int
    class_options: list[ClientClassRef] = []


class ClientProfileResponse(BaseModel):
    id: str
    name: str
    email: str
    phone: str | None = None
    gender: str | None = None
    birth_date: str | None = None
    concerns: list[str] = []
    interests: list[str] = []
    bio: str | None = None
    profile_image_url: str | None = None
    memo: str | None = None
    # SDD-230: phone/birth_date 는 기본 응답에서 항상 null — 원문은 contact-reveal 로만 열람한다.
    phone_masked: str | None = None
    age: int | None = None

    model_config = {"from_attributes": True}


class ContactRevealResponse(BaseModel):
    phone: str | None = None
    birth_date: str | None = None


class ClientActivityItem(BaseModel):
    id: str
    type: str
    occurred_at: str
    title: str
    class_title: str | None = None
    session_id: str | None = None
    note: str | None = None


class ClientActivityResponse(BaseModel):
    items: list[ClientActivityItem]
    next_cursor: str | None = None
    ai_included: bool = False


class ClientReportItem(BaseModel):
    id: str
    session_id: str
    title: str
    type: str
    type_label: str
    status: str
    status_label: str
    occurred_at: str | None = None
    created_at: str | None = None


class ClientChangeMetric(BaseModel):
    key: str
    label: str
    delta: float | None = None
    direction: str | None = None


class ClientChangeItem(BaseModel):
    report_id: str
    title: str
    occurred_at: str | None = None
    state: str
    summary: str
    metrics: list[ClientChangeMetric] = []


class ClientReportsResponse(BaseModel):
    reports: list[ClientReportItem]
    changes: list[ClientChangeItem]


class MemoRequest(BaseModel):
    memo: str = ""


class InviteRequest(BaseModel):
    email: EmailStr


class InviteResponse(BaseModel):
    invite_token: str
    invite_url: str
    message: str = ""


class InviteInfoResponse(BaseModel):
    counselor_name: str
    counselor_code: str | None = None
    organization: str | None = None


# ── 내담자 포털 (client-facing) ──

class AddCounselorRequest(BaseModel):
    code: str = Field(min_length=6, max_length=6)


class CounselorInfo(BaseModel):
    id: str
    name: str
    profile_image: str | None = None
    org_name: str | None = None
    status: str = "active"


# ── 내담자 홈 화면 ──

class NextSessionInfo(BaseModel):
    """다음 예정 세션 정보"""
    id: str
    title: str
    counselor_name: str
    counselor_id: str
    start_time: str
    status: str


class RecentReportInfo(BaseModel):
    """최근 리포트 정보"""
    id: str
    title: str
    created_at: str
    # SDD-211: 승인 전(리뷰 중) 리포트 여부 — 가산 필드
    in_review: bool = False


class ClientHomeResponse(BaseModel):
    """내담자 홈 화면 집계 응답"""
    next_session: NextSessionInfo | None = None
    recent_report: RecentReportInfo | None = None
    unread_messages: int = 0
    today_sessions: int = 0
