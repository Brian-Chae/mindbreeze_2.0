"""상담센터(Organization) 관련 Pydantic 스키마"""

from pydantic import BaseModel, ConfigDict, Field


class OrganizationBase(BaseModel):
    name: str
    ceo_name: str
    biz_number: str
    address: str
    phone: str | None = None


class OrganizationCreate(OrganizationBase):
    pass


class OrganizationResponse(BaseModel):
    # SDD-015: system_admin 간이 등록 기관은 사업자 정보가 없을 수 있어 응답에서는 optional
    name: str
    ceo_name: str | None = None
    biz_number: str | None = None
    address: str | None = None
    phone: str | None = None
    id: str
    # SDD-015: 상담사 가입에 사용하는 6자리 기관 코드
    org_code: str | None = None
    verified: bool
    verified_at: str | None = None
    created_at: str

    model_config = ConfigDict(from_attributes=True)


class OrganizationAdminCreate(BaseModel):
    """SDD-015 — system_admin 간이 기관 등록. 기관명만 필수."""

    name: str = Field(min_length=1, max_length=200)
    phone: str | None = Field(None, max_length=20)


class OrganizationAdminResponse(BaseModel):
    """간이 등록 결과 — 발급된 기관 코드 포함."""

    id: str
    name: str
    org_code: str | None = None
    phone: str | None = None
    verified: bool
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


class OrgJoinRequestDetail(BaseModel):
    id: str
    org_id: str
    org_name: str
    user_id: str
    user_name: str
    user_email: str
    status: str
    reason: str | None = None
    created_at: str


class CounselorResponse(BaseModel):
    id: str
    name: str
    email: str
    role: str