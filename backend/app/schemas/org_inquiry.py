"""기관 도입 문의 스키마 (SDD-248)"""

from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator

OrgType = Literal["counseling_center", "meditation_center", "education", "company", "other"]


class OrgInquiryCreate(BaseModel):
    org_name: str = Field(min_length=1, max_length=200)
    contact_name: str = Field(min_length=1, max_length=100)
    email: EmailStr
    phone: str = Field(min_length=1, max_length=30)
    org_type: OrgType | None = None
    expected_users: int | None = Field(None, ge=0, le=1_000_000)
    band_interest: bool | None = None
    message: str | None = Field(None, max_length=2000)
    privacy_consent: bool
    # 허니팟 — 사람은 비워 둔다(화면에서 숨김). 채워지면 봇으로 간주해 거절한다.
    website: str | None = Field(None, max_length=200)

    @field_validator("org_name", "contact_name", "phone")
    @classmethod
    def _strip_required(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("빈 값은 허용되지 않습니다")
        return v

    @field_validator("email")
    @classmethod
    def _email_lower(cls, v: str) -> str:
        if len(v) > 254:
            raise ValueError("이메일이 너무 깁니다")
        return v.strip().lower()

    @field_validator("website")
    @classmethod
    def _honeypot(cls, v: str | None) -> str | None:
        if v is not None and v.strip():
            raise ValueError("요청을 처리할 수 없습니다")
        return None

    @field_validator("privacy_consent")
    @classmethod
    def _consent_required(cls, v: bool) -> bool:
        if v is not True:
            raise ValueError("개인정보 수집·이용에 동의해야 문의할 수 있습니다")
        return v


class OrgInquiryCreatedResponse(BaseModel):
    inquiry_id: str
    status: str
