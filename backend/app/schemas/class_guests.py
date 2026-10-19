"""공개 guest 가입과 강사 확인 복구의 제한된 입력."""
from datetime import date
from typing import Literal
from uuid import UUID
from pydantic import BaseModel,ConfigDict,Field,EmailStr
from app.schemas.class_membership import MemberCommand

class GuestJoin(BaseModel):
    model_config=ConfigDict(extra='forbid')
    code:str=Field(pattern=r'^[0-9]{4}$')
    operation_key:UUID
    guest_name:str=Field(min_length=1,max_length=100)
    gender:Literal['male','female','other']
    birth_date:date
    report_email:EmailStr=Field(max_length=320)
    report_included:bool=False
    notice_version:str|None=Field(default=None,max_length=20)
    research_consented:bool=False
    research_notice_version:str|None=Field(default=None,max_length=20)
    reminder_opt_in:bool=False
    join_mode:Literal['active','waitlist']='active'

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
