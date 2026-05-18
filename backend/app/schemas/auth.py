"""Auth Schemas — Pydantic Models for Request/Response"""

from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, field_serializer


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, description="영문+숫자+특수문자 8자 이상")
    name: str = Field(min_length=1, max_length=100)
    role: str = Field(pattern="^(counselor|client)$")


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: str


class UserResponse(BaseModel):
    id: UUID
    email: str
    name: str
    role: str
    verified_tier: str

    model_config = {"from_attributes": True}

    @field_serializer("id")
    def serialize_id(self, v: UUID) -> str:
        return str(v)
