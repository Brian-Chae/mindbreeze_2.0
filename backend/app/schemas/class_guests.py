"""공개 guest 가입과 강사 확인 복구의 제한된 입력."""
from datetime import date
from typing import Literal
from uuid import UUID
from pydantic import BaseModel,ConfigDict,Field,EmailStr,model_validator
from app.schemas.class_membership import MemberCommand

class GuestJoin(BaseModel):
    model_config=ConfigDict(extra='forbid')
    code:str=Field(pattern=r'^[0-9]{4}$')
    operation_key:UUID
    guest_name:str=Field(min_length=1,max_length=100)
    gender:Literal['male','female','other']
    birth_date:date|None=None  # 이전 요청·데이터 호환, 새 연월 입력의 일자는 의미 없음
    birth_year_month:str|None=None
    report_email:EmailStr=Field(max_length=320)
    report_included:bool=False
    notice_version:str|None=Field(default=None,max_length=20)
    research_consented:bool=False
    research_notice_version:str|None=Field(default=None,max_length=20)
    reminder_opt_in:bool=False
    join_mode:Literal['active','waitlist']='active'

    @model_validator(mode='after')
    def normalize_guest_input(self) -> "GuestJoin":
        if self.birth_year_month is not None:
            from app.schemas.guest_birth import parse_guest_birth_year_month
            self.birth_date = parse_guest_birth_year_month(self.birth_year_month)
        if self.birth_date is None:
            raise ValueError('생년월을 입력해 주세요')
        # 이전 앱이 true를 보내도 비회원은 연구 동의 주체가 아니다.
        self.research_consented = False
        self.research_notice_version = None
        return self

class GuestMergePreview(BaseModel):
    model_config=ConfigDict(extra='forbid')
    source_member_id:UUID
    target_member_id:UUID
    reason:str=Field(min_length=1,max_length=1000)

class GuestMerge(MemberCommand):
    source_member_id:UUID
    target_member_id:UUID
    confirmed_preview_fingerprint:str=Field(min_length=64,max_length=64)
    identity_confirmed:Literal[True]

class GuestRecovery(MemberCommand):
    identity_confirmed:Literal[True]

class GuestExchange(BaseModel):
    model_config=ConfigDict(extra='forbid')
    exchange_token:str=Field(min_length=32,max_length=200)


class GuestEntryResponse(BaseModel):
    class_id: str
    revision: int
    session_id: str
    participant_id: str
    entry_credential: str
    expires_at: str
