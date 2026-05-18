"""상담센터(Organization) 관련 Pydantic 스키마"""

from pydantic import BaseModel, ConfigDict


class OrganizationBase(BaseModel):
    name: str
    ceo_name: str
    biz_number: str
    address: str
    phone: str | None = None


class OrganizationCreate(OrganizationBase):
    pass


class OrganizationResponse(OrganizationBase):
    id: str
    verified: bool
    verified_at: str | None = None
    created_at: str

    model_config = ConfigDict(from_attributes=True)


class OrganizationSearchResult(BaseModel):
    id: str
    name: str
    address: str
    verified: bool


class JoinRequestCreate(BaseModel):
    """가입 신청 — body 없음 (URL의 org_id만 사용)"""
    pass


class JoinRequestResponse(BaseModel):
    id: str
    org_id: str
    org_name: str
    status: str
    reason: str | None = None
    created_at: str


class JoinRequestUpdate(BaseModel):
    status: str  # "approved" | "rejected"
    reason: str | None = None


class CounselorResponse(BaseModel):
    id: str
    name: str
    email: str
    role: str
