"""SDD-077 상담사 정보 관리 스키마 — 3자(본인/플랫폼/기관) 공용 조회·수정 계약"""

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.auth import CareerItem, QualificationItem

# 대량 할당 차단 대상 — 전송 자체를 403으로 거부한다 (별도 관리 기능 이용)
FORBIDDEN_UPDATE_FIELDS = ("email", "role", "org_id", "verified_tier", "status", "counselor_code")


class CounselorInfoUpdate(BaseModel):
    """상담사 정보 수정 요청 — 미전송은 유지, null은 삭제(선택 필드만)."""

    model_config = ConfigDict(extra="forbid")

    # 계정 기본 (User)
    name: str | None = Field(None, max_length=100)
    phone: str | None = Field(None, max_length=20)
    profile_image: str | None = Field(None, max_length=500)
    bio: str | None = None
    # 개인정보 (CounselorProfile) — 선택 입력, null 보존
    gender: str | None = Field(None, pattern="^(male|female|other)$")
    birth_date: str | None = Field(None, description="YYYY-MM-DD")
    postal_code: str | None = Field(None, max_length=20)
    address_line1: str | None = Field(None, max_length=300)
    address_line2: str | None = Field(None, max_length=200)
    # 전문 이력
    affiliation_type: str | None = Field(None, max_length=50)
    years_of_experience: int | None = Field(None, ge=0)
    specialties: list[str] | None = None
    qualifications: list[QualificationItem] | None = None
    careers: list[CareerItem] | None = None
    # 낙관적 잠금 (미전송 시 검사 생략 — 구 클라이언트 하위 호환)
    version: int | None = Field(None, ge=1)
    # 관리자 수정 사유 (본인 수정은 불필요)
    reason: str | None = Field(None, max_length=2000)
    # 수정 금지 필드 — 선언만 해두고 전송되면 403으로 거부한다
    email: str | None = None
    role: str | None = None
    org_id: str | None = None
    verified_tier: str | None = None
    status: str | None = None
    counselor_code: str | None = None


class CounselorInfoResponse(BaseModel):
    """상담사 정보 응답 — 이메일은 읽기 전용 표시용."""

    id: str
    email: str
    name: str
    role: str
    status: str
    org_id: str | None = None
    org_name: str | None = None
    counselor_code: str | None = None
    phone: str | None = None
    profile_image: str | None = None
    bio: str | None = None
    gender: str | None = None
    birth_date: str | None = None
    postal_code: str | None = None
    address_line1: str | None = None
    address_line2: str | None = None
    affiliation_type: str | None = None
    years_of_experience: int | None = None
    specialties: list[str] = []
    qualifications: list[QualificationItem] = []
    careers: list[CareerItem] = []
    version: int = 1


class AdminCounselorListItem(BaseModel):
    id: str
    name: str
    email: str
    counselor_code: str | None = None
    role: str
    status: str
    org_id: str | None = None
    org_name: str | None = None


class AdminCounselorListResponse(BaseModel):
    items: list[AdminCounselorListItem]
    total: int


class PrimaryAdminProfilePatch(BaseModel):
    """주 담당자 이름/전화 수정 — 담당자 교체(primary_admin_id 변경) 아님."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: str | None = Field(None, min_length=1, max_length=100)
    phone: str | None = Field(None, max_length=20)
    reason: str = Field(min_length=1, max_length=2000)
    # 저장 직전 담당자 교체 충돌 감지용 — 불일치 시 409
    expected_user_id: str | None = None
