"""Auth Schemas — Pydantic Models for Request/Response"""

import re
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, field_serializer, field_validator

_PASSWORD_RE = re.compile(r"^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$")


def _validate_password(v: str) -> str:
    if not _PASSWORD_RE.match(v):
        raise ValueError("비밀번호는 8자 이상이며 영문·숫자·특수문자를 모두 포함해야 합니다")
    return v


class ConsentRequest(BaseModel):
    tos: bool
    privacy: bool
    sensitive: bool


class RegisterRequest(BaseModel):
    """기존 (하위 호환) 가입 스키마"""
    email: EmailStr
    password: str = Field(min_length=8, description="영문+숫자+특수문자 8자 이상")
    name: str = Field(min_length=1, max_length=100)
    role: str = Field(pattern="^(counselor|client)$")
    email_verify_token: str | None = None
    consents: ConsentRequest | None = None


class _RegisterBase(BaseModel):
    email: EmailStr
    password: str
    name: str = Field(min_length=1, max_length=100)
    email_verify_token: str
    consents: ConsentRequest

    @field_validator("password")
    @classmethod
    def _check_password(cls, v: str) -> str:
        return _validate_password(v)


class RegisterCounselorRequest(_RegisterBase):
    """상담사 가입 — role=counselor 고정"""


class RegisterClientRequest(_RegisterBase):
    """내담자 가입 — role=client 고정"""


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: str


class LogoutRequest(BaseModel):
    refresh_token: str


class OtpRequestPayload(BaseModel):
    email: EmailStr


class OtpVerifyPayload(BaseModel):
    email: EmailStr
    code: str = Field(min_length=6, max_length=6)


class EmailVerifyTokenResponse(BaseModel):
    email_verify_token: str


class UserResponse(BaseModel):
    id: UUID
    email: str
    name: str
    role: str
    verified_tier: str
    onboarding_completed: bool = False

    model_config = {"from_attributes": True}

    @field_serializer("id")
    def serialize_id(self, v: UUID) -> str:
        return str(v)


class LoginResponse(TokenResponse):
    user: UserResponse


class PasswordForgotRequest(BaseModel):
    email: EmailStr


class PasswordResetRequest(BaseModel):
    token: str
    new_password: str = Field(min_length=8)
