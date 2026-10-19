"""장기 guest 자격은 전용 헤더만 받는다. 로그인 Bearer와 교환하지 않는다."""
from uuid import UUID
from fastapi import APIRouter,Depends,Header,Request,BackgroundTasks
from sqlalchemy.orm import Session
from app.api.deps import get_current_user
from app.api.v1.classes import scheduling_enabled,code_limited
from app.core.database import get_db
from app.core.redis import get_redis
from app.schemas.class_guests import GuestJoin,GuestMergePreview,GuestMerge,GuestRecovery,GuestExchange
from app.schemas.class_membership import MemberCommand,MemberWaitlistCommand
from app.services import class_guest_service as service
from app.services.class_effect_service import dispatch_class_effects

router=APIRouter(prefix='/classes',tags=['classes'],dependencies=[Depends(scheduling_enabled)])

def guest_credential(value:str|None=Header(default=None,alias='X-Class-Member-Credential')):
    if not value:raise service._error()
    return value

@router.post('/{class_id}/guest-memberships',status_code=201)
async def join(class_id:UUID,payload:GuestJoin,request:Request,db:Session=Depends(get_db),redis=Depends(get_redis)):
    return await code_limited(request,redis,payload.code,lambda:service.join_guest(db,class_id,payload))

@router.post('/{class_id}/guest-credentials/refresh')
def refresh(class_id:UUID,token:str=Depends(guest_credential),db:Session=Depends(get_db)):
    return service.refresh_guest(db,class_id,token)

@router.post('/{class_id}/guest-credentials/logout')
def logout(class_id:UUID,background_tasks:BackgroundTasks,token:str=Depends(guest_credential),db:Session=Depends(get_db)):
    result=service.logout_guest(db,class_id,token)
    background_tasks.add_task(dispatch_class_effects,str(class_id));return result

@router.post('/{class_id}/guest-credentials/rejoin')
async def rejoin(class_id:UUID,payload:MemberWaitlistCommand,request:Request,token:str=Depends(guest_credential),db:Session=Depends(get_db),redis=Depends(get_redis)):
    return await code_limited(request,redis,payload.code,lambda:service.rejoin_guest(db,class_id,token,payload))

@router.post('/{class_id}/sessions/{session_id}/guest-entry')
def enter(class_id:UUID,session_id:UUID,payload:MemberCommand,token:str=Depends(guest_credential),db:Session=Depends(get_db)):
    return service.guest_entry(db,class_id,session_id,token,payload)

@router.post('/{class_id}/guest-merges/preview')
def preview(class_id:UUID,payload:GuestMergePreview,current_user:dict=Depends(get_current_user),db:Session=Depends(get_db)):
    return service.preview_merge(db,current_user['id'],class_id,payload.source_member_id,payload.target_member_id,payload.reason)

@router.post('/{class_id}/guest-merges')
def merge(class_id:UUID,payload:GuestMerge,background_tasks:BackgroundTasks,current_user:dict=Depends(get_current_user),db:Session=Depends(get_db)):
    result=service.merge_guests(db,current_user['id'],class_id,payload)
    background_tasks.add_task(dispatch_class_effects,str(class_id));return result

@router.post('/{class_id}/members/{member_id}/recovery')
def recovery(class_id:UUID,member_id:UUID,payload:GuestRecovery,current_user:dict=Depends(get_current_user),db:Session=Depends(get_db)):
    return service.issue_recovery(db,current_user['id'],class_id,member_id,payload)

@router.post('/{class_id}/guest-credentials/exchange')
def exchange(class_id:UUID,payload:GuestExchange,background_tasks:BackgroundTasks,db:Session=Depends(get_db)):
    result=service.exchange_recovery(db,class_id,payload.exchange_token)
    background_tasks.add_task(dispatch_class_effects,str(class_id));return result
