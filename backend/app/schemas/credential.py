"""F3 자격 증빙 스키마"""

from __future__ import annotations

from pydantic import BaseModel


class CredentialResponse(BaseModel):
    id: str
    type: str
    file_name: str | None
    status: str
    expires_at: str | None
    created_at: str


class CredentialListResponse(BaseModel):
    credentials: list[CredentialResponse]
    verified_tier: str
    missing: list[str]


class AdminVerifyRequest(BaseModel):
    status: str  # "approved" | "rejected"
    reason: str | None = None
