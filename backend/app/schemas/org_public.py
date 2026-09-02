"""기관 전용 공개 페이지 Pydantic 스키마

인증 없이 노출되는 응답이므로 개인정보(이메일·전화·주소·사업자번호)는 담지 않는다.
"""

from datetime import datetime

from pydantic import BaseModel


class PublicCounselor(BaseModel):
    """공개용 상담사 정보 — 이름과 전문분야만 노출한다."""

    id: str
    name: str
    specialties: list[str] = []


class PublicClass(BaseModel):
    """공개용 클래스 정보 — 참여 전 확인에 필요한 최소 정보만 노출한다."""

    id: str
    title: str | None = None
    type: str
    access_code: str | None = None
    status: str
    participant_mode: str
    started_at: datetime | None = None
    participant_count: int = 0
    max_participants: int = 1


class OrgPublicResponse(BaseModel):
    org_id: str
    org_name: str
    org_code: str | None = None
    # Organization 모델에 소개글 필드가 아직 없어 항상 None. 필드 추가 시 그대로 매핑된다.
    intro: str | None = None
    counselors: list[PublicCounselor] = []
    classes: list[PublicClass] = []
