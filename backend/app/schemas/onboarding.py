"""온보딩 스키마 — F1.3 상담사 / F1.4 내담자"""

from __future__ import annotations

from pydantic import BaseModel, Field


class OnboardingProgressResponse(BaseModel):
    current_step: int
    step_data: dict
    completed: bool


# ---------------------------------------------------------------------------
# 상담사 온보딩 (F1.3)
# ---------------------------------------------------------------------------

class CounselorStep1Request(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    phone: str | None = None


class CounselorStep2Request(BaseModel):
    gender: str | None = None
    birth_date: str | None = None
    years_of_experience: int | None = None
    specialties: list[str] = Field(default_factory=list)


class CounselorStep3Request(BaseModel):
    affiliation_type: str | None = None
    credential_files: list[str] = Field(default_factory=list)


class CounselorStep4Request(BaseModel):
    profile_image_url: str | None = None
    bio: str | None = None


class CounselorCompleteResponse(BaseModel):
    counselor_code: str
    verified_tier: str


# ---------------------------------------------------------------------------
# 내담자 온보딩 (F1.4)
# ---------------------------------------------------------------------------

class ClientStep1Request(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    phone: str | None = None


class ClientStep2Request(BaseModel):
    gender: str | None = None
    birth_date: str | None = None
    concerns: list[str] = Field(default_factory=list)
    interests: list[str] = Field(default_factory=list)


class ClientStep3Request(BaseModel):
    profile_image_url: str | None = None
    bio: str | None = None


class ClientStep4MatchRequest(BaseModel):
    counselor_code: str = Field(min_length=6, max_length=6)


class MatchedCounselor(BaseModel):
    name: str
    counselor_code: str
    specialties: list[str] = Field(default_factory=list)


class ClientMatchResponse(BaseModel):
    matched_counselor: MatchedCounselor
