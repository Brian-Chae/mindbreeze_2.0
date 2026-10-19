"""로그인 또는 검증된 guest 본인의 멤버십·출석·보강 명령."""
from uuid import UUID
from fastapi import APIRouter, BackgroundTasks, Depends, Request, Header
from sqlalchemy.orm import Session
from app.api.deps import get_current_user_optional
from app.api.v1.classes import scheduling_enabled, code_limited
from app.core.database import get_db
from app.core.redis import get_redis
from app.schemas.class_membership import MemberTransitionCommand, MemberWaitlistCommand, AttendanceCommand, MemberCommand, MakeupAssignmentCommand
from app.services.class_membership_service import transition_membership, request_waitlist
from app.services.class_effect_service import dispatch_class_effects

from app.schemas.class_membership import AttendanceResponse, ParticipationResponse

router = APIRouter(prefix="/classes", tags=["classes"], dependencies=[Depends(scheduling_enabled)])


@router.post("/{class_id}/members/{member_id}/transition")
def transition(class_id: UUID, member_id: UUID, payload: MemberTransitionCommand, background_tasks: BackgroundTasks, current_user: dict | None = Depends(get_current_user_optional), db: Session = Depends(get_db), x_class_member_credential: str | None = Header(default=None, alias='X-Class-Member-Credential')):
    if current_user:
        result = transition_membership(db, current_user['id'], class_id, member_id, payload)
    else:
        from app.services.class_guest_service import guest_transition
        result = guest_transition(db, class_id, member_id, x_class_member_credential, payload)
    background_tasks.add_task(dispatch_class_effects, str(class_id))
    return result


@router.post("/{class_id}/waitlist")
async def waitlist(class_id: UUID, payload: MemberWaitlistCommand, request: Request, current_user: dict | None = Depends(get_current_user_optional), db: Session = Depends(get_db), redis=Depends(get_redis), x_class_member_credential: str | None = Header(default=None, alias='X-Class-Member-Credential')):
    from app.services.class_guest_service import guest_waitlist
    return await code_limited(request, redis, payload.code, lambda: request_waitlist(db, current_user['id'], class_id, payload) if current_user else guest_waitlist(db, class_id, x_class_member_credential, payload))


@router.post('/{class_id}/sessions/{session_id}/members/{member_id}/attendance', response_model=AttendanceResponse)
def attendance(class_id: UUID, session_id: UUID, member_id: UUID, payload: 'AttendanceCommand', current_user: dict | None = Depends(get_current_user_optional), db: Session = Depends(get_db), x_class_member_credential: str | None = Header(default=None, alias='X-Class-Member-Credential')):
    from app.services.class_attendance_service import change_attendance
    if current_user:
        return change_attendance(db, current_user['id'], class_id, session_id, member_id, payload)
    from app.services.class_guest_service import guest_attendance
    return guest_attendance(db, class_id, session_id, member_id, x_class_member_credential, payload)


@router.get('/{class_id}/sessions/{session_id}/participation', response_model=ParticipationResponse)
def participation(class_id: UUID, session_id: UUID, x_class_member_credential: str | None = Header(default=None, alias='X-Class-Member-Credential'), x_entry_credential: str | None = Header(default=None, alias='X-Entry-Credential'), current_user: dict | None = Depends(get_current_user_optional), db: Session = Depends(get_db)):
    from app.services.class_participation_service import snapshot
    return snapshot(db, class_id, session_id, current_user['id'] if current_user else None, entry_credential=x_entry_credential, member_credential=x_class_member_credential)


@router.post('/{class_id}/makeup-assignments', status_code=201)
def assign_makeup(class_id: UUID, payload: MakeupAssignmentCommand, current_user: dict | None = Depends(get_current_user_optional), db: Session = Depends(get_db), x_class_member_credential: str | None = Header(default=None, alias='X-Class-Member-Credential')):
    from app.services.class_makeup_service import assign_makeup as assign
    if current_user:
        return assign(db, current_user['id'], class_id, payload)
    from app.services.class_guest_service import guest_makeup
    return guest_makeup(db, class_id, x_class_member_credential, payload)


@router.post('/{class_id}/makeup-assignments/{assignment_id}/cancel')
def cancel_makeup(class_id: UUID, assignment_id: UUID, payload: MemberCommand, current_user: dict | None = Depends(get_current_user_optional), db: Session = Depends(get_db), x_class_member_credential: str | None = Header(default=None, alias='X-Class-Member-Credential')):
    from app.services.class_makeup_service import cancel_makeup as cancel
    if current_user:
        return cancel(db, current_user['id'], class_id, assignment_id, payload)
    from app.services.class_guest_service import guest_cancel_makeup
    return guest_cancel_makeup(db, class_id, assignment_id, x_class_member_credential, payload)


from app.schemas.class_consents import ClassConsentCommand, ClassResearchWithdrawalCommand


@router.get('/{class_id}/me/consents')
def own_consents(class_id: UUID, current_user: dict | None = Depends(get_current_user_optional), db: Session = Depends(get_db), x_class_member_credential: str | None = Header(default=None, alias='X-Class-Member-Credential')):
    from app.services.class_member_consent_service import get_consents
    return get_consents(db,class_id,user_id=current_user['id'] if current_user else None,member_credential=x_class_member_credential)


@router.put('/{class_id}/me/consents')
def update_own_consents(class_id: UUID, payload: ClassConsentCommand, current_user: dict | None = Depends(get_current_user_optional), db: Session = Depends(get_db), x_class_member_credential: str | None = Header(default=None, alias='X-Class-Member-Credential')):
    from app.services.class_member_consent_service import update_consents
    return update_consents(db,class_id,payload.model_dump(mode='json',exclude_unset=True),user_id=current_user['id'] if current_user else None,member_credential=x_class_member_credential)


@router.post('/{class_id}/me/research-withdrawal')
def withdraw_own_research(class_id: UUID, payload: ClassResearchWithdrawalCommand, current_user: dict | None = Depends(get_current_user_optional), db: Session = Depends(get_db), x_class_member_credential: str | None = Header(default=None, alias='X-Class-Member-Credential')):
    from app.services.class_member_consent_service import withdraw_research
    return withdraw_research(db,class_id,payload,user_id=current_user['id'] if current_user else None,member_credential=x_class_member_credential)


@router.post('/{class_id}/access-code/rotate')
def rotate_class_access_code(class_id: UUID, payload: MemberCommand, current_user: dict | None = Depends(get_current_user_optional), db: Session = Depends(get_db)):
    from fastapi import HTTPException
    if current_user is None: raise HTTPException(401,detail={'code':'action_forbidden'})
    from app.services.class_member_consent_service import rotate_access_code
    return rotate_access_code(db,class_id,current_user['id'],payload)
