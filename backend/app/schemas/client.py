"""내담자 관리 스키마"""

from pydantic import BaseModel, EmailStr, Field


class ClientSummary(BaseModel):
    id: str
    name: str
    email: str
    concerns: list[str] = []
    last_session_at: str | None = None

    model_config = {"from_attributes": True}


class ClientListResponse(BaseModel):
    clients: list[ClientSummary]
    total: int
    page: int


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

    model_config = {"from_attributes": True}


class MemoRequest(BaseModel):
    memo: str = ""


class InviteRequest(BaseModel):
    email: EmailStr


class InviteResponse(BaseModel):
    invite_token: str
    invite_url: str


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
