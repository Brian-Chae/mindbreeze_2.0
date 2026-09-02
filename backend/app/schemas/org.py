"""상담센터(Organization) 관련 Pydantic 스키마"""

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator


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
    """SDD-015/016 — system_admin 기관 등록.

    SDD-016에서 주 담당자(org_admin) 정보를 함께 받도록 확장했다.
    담당자 정보를 생략하면 기관만 생성되는 기존 동작을 유지한다.
    """

    name: str = Field(min_length=1, max_length=200)
    phone: str | None = Field(None, max_length=20)
    address: str | None = Field(None, max_length=300)
    admin_name: str | None = Field(None, min_length=1, max_length=100)
    admin_email: EmailStr | None = None
    admin_phone: str | None = Field(None, max_length=20)

    @model_validator(mode="after")
    def _validate_admin(self) -> "OrganizationAdminCreate":
        # 담당자를 등록하려면 이름과 이메일이 함께 있어야 한다
        if bool(self.admin_name) != bool(self.admin_email):
            raise ValueError("담당자 이름과 이메일은 함께 입력해야 합니다")
        return self


class OrgAdminSummary(BaseModel):
    """생성된 기관 담당자 요약 — 초대 토큰은 포함하지 않는다."""

    id: str
    email: str
    name: str
    status: str


class OrganizationWithAdminResponse(BaseModel):
    """기관 등록 결과 — 기관 + 담당자 + 초대 발송 여부."""

    org: "OrganizationAdminResponse"
    admin: OrgAdminSummary | None = None
    invite_sent: bool = False


class ResendInviteResponse(BaseModel):
    admin: OrgAdminSummary
    invite_sent: bool = False


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


OrganizationWithAdminResponse.model_rebuild()
