"""클래스 본인 선택 동의 입력. 필드 누락은 기존값 보존이다."""
from pydantic import BaseModel, Field, model_validator
from app.schemas.class_membership import MemberCommand


class ClassConsentCommand(MemberCommand):
    report_included_default: bool | None = None
    research_consented: bool | None = None
    research_notice_version: str | None = Field(default=None,min_length=1,max_length=20)
    notice_version: str | None = Field(default=None,min_length=1,max_length=20)
    reminder_opt_in: bool | None = None

    @model_validator(mode='after')
    def no_null_choice(self):
        for field in self.model_fields_set:
            if field in ('report_included_default','research_consented','reminder_opt_in') and getattr(self,field) is None:
                raise ValueError('선택값은 true 또는 false여야 합니다')
        return self


class ClassResearchWithdrawalCommand(MemberCommand):
    reason: str = Field(min_length=1,max_length=1000)


class ClassSessionRecordingConsent(BaseModel):
    """SDD-220(F1): 회차별 녹음·녹화 필수 동의 — 입장 자격을 받기 전(회원 로그인/게스트 멤버 자격)에 저장한다."""

    consented: bool
    notice_version: str | None = Field(default=None, min_length=1, max_length=20)
