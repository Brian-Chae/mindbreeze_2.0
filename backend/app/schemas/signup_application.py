"""가입 신청 스키마 (SDD-073)"""

from pydantic import BaseModel, EmailStr, Field


class SignupConsent(BaseModel):
    """공개 신청 폼 동의 — 개인정보 수집·이용 필수 동의."""

    privacy: bool


class OrganizationApplicationCreate(BaseModel):
    organization_name: str = Field(min_length=1, max_length=200)
    contact_name: str = Field(min_length=1, max_length=100)
    email: EmailStr
    phone: str | None = Field(None, max_length=20)
    inquiry: str | None = Field(None, max_length=2000)
    consents: SignupConsent


class IndividualCounselorApplicationCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    email: EmailStr
    email_verify_token: str = Field(min_length=1)
    phone: str | None = Field(None, max_length=20)
    display_name: str | None = Field(None, max_length=200)
    specialties: str | None = Field(None, max_length=300)
    inquiry: str | None = Field(None, max_length=2000)
    consents: SignupConsent


class ApplicationCreatedResponse(BaseModel):
    application_id: str
    status: str


class ApplicationSummary(BaseModel):
    id: str
    application_type: str
    organization_name: str
    contact_name: str
    email: str
    phone: str | None = None
    status: str
    notify_status: str
    created_at: str | None = None


class ApplicationDetail(ApplicationSummary):
    inquiry: str | None = None
    specialties: str | None = None
    review_note: str | None = None
    reviewed_at: str | None = None
    organization_id: str | None = None
    user_id: str | None = None
    notified_at: str | None = None


class ApplicationListResponse(BaseModel):
    items: list[ApplicationSummary]
    total: int
    page: int
    size: int


class ApplicationRejectRequest(BaseModel):
    reason: str | None = Field(None, max_length=1000)


class ApplicationActionResponse(BaseModel):
    application: ApplicationDetail
    invite_sent: bool = False
