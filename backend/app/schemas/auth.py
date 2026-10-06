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
    # 자동 로그인(로그인 상태 유지) — True면 refresh 쿠키를 14일 지속 쿠키로,
    # False면 브라우저 세션 쿠키로 발급한다. 미지정 시 기존 동작(지속)을 유지한다.
    remember_me: bool = True

    @field_validator("password")
    @classmethod
    def _check_password(cls, v: str) -> str:
        return _validate_password(v)


class _RegisterBase(BaseModel):
    email: EmailStr
    password: str
    name: str = Field(min_length=1, max_length=100)
    email_verify_token: str
    consents: ConsentRequest
    # 자동 로그인(로그인 상태 유지) — 가입 직후 세션의 refresh 쿠키 수명을 결정한다.
    # True(기본)면 14일 지속 쿠키, False면 브라우저 세션 쿠키.
    remember_me: bool = True

    @field_validator("password")
    @classmethod
    def _check_password(cls, v: str) -> str:
        return _validate_password(v)


class RegisterCounselorRequest(_RegisterBase):
    """상담사 가입 — role=counselor 고정.

    SDD-015: 기관 코드(org_code) 필수. 스키마에서는 optional로 두고
    서비스 레이어에서 400으로 거부해 누락/오류 모두 같은 형태로 응답한다.
    """

    org_code: str | None = Field(None, max_length=6)


class RegisterClientRequest(_RegisterBase):
    """내담자 가입 — role=client 고정"""

    # 초대 링크를 통한 가입 시 상담사 자동 연결에 사용하는 초대 토큰(선택).
    # ClientInvite.token은 String(64)이므로 과도한 입력은 쿼리 전에 거른다.
    invite_token: str | None = Field(None, max_length=128)
    # SDD-073: 가입 시점에 수집하는 개인정보. 전화번호는 선택(문자 인증 없음).
    gender: str | None = Field(None, pattern="^(male|female|other)$")
    birth_date: str | None = Field(None, description="YYYY-MM-DD 형식")
    phone: str | None = Field(None, max_length=20)
    # SDD-073: 초대한 상담사 코드(6자리 counselor_code).
    # invite_token 이 있으면 코드 대신 초대 상담사를 확정한다.
    counselor_code: str | None = Field(None, max_length=12)


class CounselorCodeCheckRequest(BaseModel):
    """SDD-073 — 가입 전 상담사 코드 확인. OTP 검증(email_verify_token) 후에만 허용."""

    counselor_code: str = Field(min_length=1, max_length=12)
    email_verify_token: str = Field(min_length=1)


class CounselorCodeCheckResponse(BaseModel):
    """코드 확인 응답 — 연결 대상 표시명·기관명만 노출한다(연락처·내담자 정보 금지)."""

    counselor_name: str
    organization_name: str | None = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str
    role: str | None = Field(None, pattern="^(client|counselor|org_admin|platform_admin)$")
    # 자동 로그인(로그인 상태 유지) — True(기본)면 refresh 쿠키 14일 지속,
    # False면 브라우저 세션 쿠키(창을 닫으면 로그아웃).
    remember_me: bool = True


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str | None = None  # refresh는 httpOnly cookie로만 전달 (XSS 탈취 방지)
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: str | None = None  # 없으면 httpOnly cookie에서 읽음


class LogoutRequest(BaseModel):
    refresh_token: str | None = None


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
    auth_provider: str = "email"
    counselors: list[dict] = []
    counselor_code: str | None = None

    model_config = {"from_attributes": True}

    @field_serializer("id")
    def serialize_id(self, v: UUID) -> str:
        return str(v)


class GoogleAuthRequest(BaseModel):
    access_token: str
    invite_token: str | None = None
    role: str | None = Field(None, pattern="^(client|counselor|org_admin|platform_admin)$")
    # SEC-04: 신규 Google 가입 시 약관·민감정보 동의. 기존 사용자 로그인은 불필요.
    # 신규 계정 생성 경로에서는 필수(누락/미동의 시 422).
    consents: ConsentRequest | None = None
    # 자동 로그인(로그인 상태 유지) — 이메일 로그인과 동일한 refresh 쿠키 분기.
    remember_me: bool = True


class UpdateUserMeRequest(BaseModel):
    """PATCH /users/me 요청 — 업데이트 가능 필드만 선택적으로 전달"""
    name: str | None = Field(None, min_length=1, max_length=100)
    phone: str | None = Field(None, min_length=1, max_length=20)
    gender: str | None = Field(None, pattern="^(male|female|other)$")
    birth_date: str | None = Field(None, description="YYYY-MM-DD 형식")


class LoginResponse(TokenResponse):
    user: UserResponse


class PasswordForgotRequest(BaseModel):
    email: EmailStr


class SetPasswordRequest(BaseModel):
    """SDD-016 — 초대 토큰으로 최초 비밀번호를 설정한다."""

    # VB-12: 토큰 문자열 상한 — 매우 긴 토큰이 JWT 디코드/해시 경로로 전달되는 것을 막는다.
    token: str = Field(min_length=1, max_length=512)
    new_password: str = Field(min_length=8, max_length=128)


class PasswordResetRequest(BaseModel):
    # VB-12: 재설정 토큰 상한(과도한 길이의 토큰 입력 시 파싱 부하 방지).
    token: str = Field(min_length=1, max_length=512)
    new_password: str = Field(min_length=8, max_length=128)


# ---------------------------------------------------------------------------
# 상담사 프로필 스키마
# ---------------------------------------------------------------------------


class QualificationItem(BaseModel):
    id: str | None = None
    name: str
    issuer: str | None = None
    issued_at: str | None = None


class CareerItem(BaseModel):
    id: str | None = None
    organization: str
    role: str | None = None
    started_at: str | None = None
    ended_at: str | None = None
    is_current: bool = False


class CounselorProfileUpdate(BaseModel):
    name: str | None = None
    phone: str | None = None
    profile_image: str | None = None
    bio: str | None = None
    affiliation_type: str | None = None
    years_of_experience: int | None = None
    specialties: list[str] | None = None
    qualifications: list[QualificationItem] | None = None
    careers: list[CareerItem] | None = None


class CounselorProfileResponse(BaseModel):
    id: str
    email: str
    name: str
    role: str
    phone: str | None = None
    profile_image: str | None = None
    bio: str | None = None
    counselor_code: str | None = None
    affiliation_type: str | None = None
    years_of_experience: int | None = None
    specialties: list[str] = []
    qualifications: list[QualificationItem] = []
    careers: list[CareerItem] = []
    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# 내담자 프로필 스키마
# ---------------------------------------------------------------------------


class ClientProfileResponse(BaseModel):
    """내담자 프로필 응답"""
    id: str
    email: str
    name: str
    role: str
    phone: str | None = None
    profile_image: str | None = None
    bio: str | None = None
    gender: str | None = None
    birth_date: str | None = None
    concerns: list[str] = []
    interests: list[str] = []

    model_config = {"from_attributes": True}


class ClientProfileUpdate(BaseModel):
    """내담자 프로필 수정 요청"""
    # VB-07: DB 컬럼 길이(User.name String(100)/phone String(20)/profile_image String(500))를
    # 초과하는 입력은 422 로 거른다(무가공 대입 500 방지).
    name: str | None = Field(None, max_length=100)
    phone: str | None = Field(None, max_length=20)
    profile_image: str | None = Field(None, max_length=500)
    bio: str | None = None
    gender: str | None = None
    birth_date: str | None = None
    concerns: list[str] | None = None
    interests: list[str] | None = None
