"""장기 guest 자격과 canonical 병합. 원문 자격·개인정보는 operation에 저장하지 않는다."""
from datetime import date, datetime, timedelta, timezone
from hashlib import sha256
import hmac
import json
import secrets
from uuid import UUID, uuid4

from fastapi import HTTPException
from jose import JWTError, jwt
from sqlalchemy import or_

from app.config import settings
from app.models.class_program import Class, ClassMember
from app.models.class_membership import (ClassGuestCredential, ClassGuestJoinOperation,
    ClassGuestMerge, ClassGuestRecovery, ClassMemberOperation, ClassMakeupAssignment)
from app.models.class_scheduling import ClassEffect
from app.models.session import Session, SessionParticipant
from app.services.class_member_commands import execute_member_command
from app.services.class_membership_service import member_dto


def _now(now=None):
    return now or datetime.now(timezone.utc)


def _error(code='guest_credential_invalid', status=401):
    return HTTPException(status, detail={'code': code})


def _data(command):
    return command.model_dump(mode='json') if hasattr(command, 'model_dump') else dict(command)


def _digest(value):
    return sha256(json.dumps(value, sort_keys=True, default=str, separators=(',', ':')).encode()).hexdigest()


def canonical_member_ids(db, member):
    canonical_id = member.canonical_member_id or member.id
    return {m.id for m in db.query(ClassMember).filter(ClassMember.class_id == member.class_id,
        or_(ClassMember.id == canonical_id, ClassMember.canonical_member_id == canonical_id)).all()}


def _lock_class(db, class_id):
    cls = db.query(Class).filter_by(id=UUID(str(class_id))).populate_existing().with_for_update().first()
    if cls is None:
        raise _error('class_not_found', 404)
    db.query(ClassMember).filter_by(class_id=cls.id).order_by(ClassMember.id).populate_existing().with_for_update().all()
    return cls


def authenticate_guest(db, class_id, token, *, scope='read', now=None):
    """현재 DB grant/서명/버전/범위를 검사한다. 읽기 scope는 활동 자격도 허용한다."""
    now = _now(now)
    try:
        if not token:
            raise ValueError()
        claims = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm], options={'verify_exp': False})
        expected_scope = {'class_membership': 'activity', 'class_membership_read': 'read'}[claims['type']]
        cid, mid, gid = UUID(claims['cid']), UUID(claims['sub']), UUID(claims['jti'])
        if cid != UUID(str(class_id)) or int(claims['exp']) <= now.timestamp():
            raise ValueError()
        cls = db.query(Class).filter_by(id=cid).first()
        member = db.query(ClassMember).filter_by(id=mid, class_id=cid, kind='guest', user_id=None).first()
        grant = db.query(ClassGuestCredential).filter_by(id=gid, class_id=cid, member_id=mid).populate_existing().first()
        if (cls is None or member is None or member.canonical_member_id is not None or grant is None
            or grant.scope != expected_scope or grant.revoked_at is not None or grant.expires_at <= now
            or grant.entry_ver != member.entry_ver or claims.get('ver') != member.entry_ver
            or int(grant.expires_at.timestamp()) != int(claims['exp'])
            or member.status not in ('active', 'waitlisted', 'completed', 'left', 'removed')):
            raise ValueError()
        if scope == 'activity' and (expected_scope != 'activity' or member.status not in ('active','waitlisted') or cls.status != 'active'):
            raise ValueError()
        if expected_scope == 'activity' and (member.status not in ('active','waitlisted') or cls.status != 'active'):
            raise ValueError()
        return member, grant
    except (JWTError, ValueError, KeyError, TypeError, AttributeError):
        raise _error()


def issue_bundle(db, cls, member, now=None):
    now = _now(now)
    expiry = now + timedelta(days=90)
    result = {'activity_credential': None, 'read_credential': None, 'expires_at': expiry.isoformat()}
    scopes = ['read']
    if member.status in ('active','waitlisted') and cls.status == 'active':
        scopes.append('activity')
    for scope in scopes:
        grant = ClassGuestCredential(id=uuid4(), class_id=cls.id, member_id=member.id, scope=scope,
            entry_ver=member.entry_ver, expires_at=expiry, last_used_at=now)
        db.add(grant)
        result[f'{scope}_credential'] = jwt.encode({'type':'class_membership' if scope=='activity' else 'class_membership_read',
            'cid':str(cls.id), 'sub':str(member.id), 'jti':str(grant.id), 'ver':member.entry_ver, 'exp':expiry},
            settings.jwt_secret_key, algorithm=settings.jwt_algorithm)
    db.flush()
    return result


def guest_dto(db, member, cls):
    result = member_dto(db, member, cls=cls)
    result['capabilities'].update(leave=bool(member.status=='active' and cls.status=='active'),
        cancel_waitlist=bool(member.status=='waitlisted' and cls.status=='active'),
        rejoin=bool(member.status=='left' and cls.status=='active'), read_own_reports=True)
    return result


def _revoke(db, cls, member, now, *, participants=True):
    # autoflush=False에서도 populate_existing이 미저장 버전을 덮지 않게 먼저 잠근다.
    rows = []
    if participants:
        from app.services.class_makeup_service import lock_context
        _, rows = lock_context(db, cls)
    ids = canonical_member_ids(db, member)
    for m in db.query(ClassMember).filter(ClassMember.id.in_(ids)).all():
        m.entry_ver += 1
    for grant in db.query(ClassGuestCredential).filter(ClassGuestCredential.member_id.in_(ids), ClassGuestCredential.revoked_at.is_(None)).all():
        grant.revoked_at = now
    for recovery in db.query(ClassGuestRecovery).filter(ClassGuestRecovery.member_id.in_(ids), ClassGuestRecovery.consumed_at.is_(None)).all():
        recovery.consumed_at = now
    if participants:
        for p in rows:
            if p.member_id in ids:
                p.entry_ver += 1
    db.add(ClassEffect(class_id=cls.id,kind='live_access_reconcile',
        effect_key=f'guest-revoke:{member.id}:{member.entry_ver}',payload={}))
    db.flush()


def join_guest(db, class_id, command, now=None):
    now = _now(now)
    from pydantic import ValidationError
    from app.schemas.class_guests import GuestJoin
    try:
        data = GuestJoin.model_validate(_data(command)).model_dump(mode='json')
    except ValidationError:
        raise _error('guest_input_invalid',422)
    try:
        cls = _lock_class(db, class_id)
        from app.services.class_code_service import normalize_class_code
        from app.services.class_membership_service import _has_seat, _queue, _member_event, _activate_future, _sessions_locked
        if cls.status != 'active' or not normalize_class_code(data['code']) or cls.access_code != normalize_class_code(data['code']):
            raise _error('class_not_found',404)
        name = (data.get('guest_name') or '').strip()
        if not name or len(name)>100:
            raise _error('guest_name_required',422)
        if data.get('report_included') and data.get('notice_version') != 'class-team-v1':
            raise _error('invalid_notice_version',422)
        if data.get('research_consented') and not data.get('research_notice_version'):
            raise _error('invalid_notice_version',422)
        # 공개 가입의 저엔트로피 개인정보는 서버 키 HMAC으로만 비교한다.
        digest = hmac.new(settings.jwt_secret_key.encode(), json.dumps(data,sort_keys=True,default=str).encode(),sha256).hexdigest()
        prior = db.query(ClassGuestJoinOperation).filter_by(class_id=cls.id,operation_key=data['operation_key']).first()
        if prior:
            if prior.request_hash != digest:
                raise _error('operation_key_reused',409)
            member = db.get(ClassMember,prior.member_id)
            # 공개 재시도에서는 개인정보나 현재 병합 대상도 노출하지 않는다.
            result={'class_id':str(cls.id),'member':{'id':str(member.id)},'credential_bundle':None,'recovery_required':True}
            db.commit()
            return result
        waiting = data.get('join_mode','active')=='waitlist'
        if not waiting and (_queue(db,cls) or not _has_seat(db,cls)):
            raise _error('waitlist_precedes' if _queue(db,cls) else 'class_capacity',409)
        if waiting and _has_seat(db,cls) and not _queue(db,cls):
            raise _error('waitlist_not_required',409)
        birth = data.get('birth_date')
        if isinstance(birth,str):
            birth = date.fromisoformat(birth)
        member = ClassMember(class_id=cls.id,kind='guest',user_id=None,status='invited',joined_via='code',
            guest_name=name,gender=data.get('gender'),birth_date=birth,report_email=data.get('report_email'),joined_at=now,
            report_included_default=data.get('report_included',False),notice_version=data.get('notice_version'),
            notice_ack_at=now if data.get('notice_version') else None, research_consented=data.get('research_consented',False),
            research_notice_version=data.get('research_notice_version'),research_selected_at=now if data.get('research_consented') else None,
            research_origin_id=uuid4() if data.get('research_consented') else None,reminder_opt_in=data.get('reminder_opt_in',False))
        db.add(member);db.flush()
        from app.services.class_member_consent_service import record_join_choices
        record_join_choices(db,member,data['operation_key'],now)
        _member_event(db,cls,member,'waitlisted' if waiting else 'active',None,now,actor_kind='self')
        if not waiting:
            _activate_future(db,cls,member,_sessions_locked(db,cls),now)
        cls.revision += 1
        db.add(ClassGuestJoinOperation(class_id=cls.id,member_id=member.id,operation_key=data['operation_key'],request_hash=digest))
        result={'class_id':str(cls.id),'revision':cls.revision,'member':guest_dto(db,member,cls),'credential_bundle':issue_bundle(db,cls,member,now)}
        db.commit();return result
    except Exception:
        db.rollback();raise


def refresh_guest(db, class_id, token, now=None):
    now = _now(now)
    try:
        cls = _lock_class(db,class_id)
        member, grant = authenticate_guest(db,cls.id,token,now=now)
        grant.revoked_at=now
        result={'class_id':str(cls.id),'member':guest_dto(db,member,cls),'credential_bundle':issue_bundle(db,cls,member,now)}
        db.commit();return result
    except Exception:
        db.rollback();raise


def logout_guest(db, class_id, token, now=None):
    now=_now(now)
    try:
        cls=_lock_class(db,class_id)
        member,_=authenticate_guest(db,cls.id,token,now=now)
        _revoke(db,cls,member,now)
        db.commit();return {'logged_out':True}
    except Exception:
        db.rollback();raise


def _guest_pair(db,cls,source_id,target_id):
    rows=[]
    for mid in (source_id,target_id):
        m=db.query(ClassMember).filter_by(id=UUID(str(mid)),class_id=cls.id,kind='guest',user_id=None).first()
        if m is None:
            raise _error('member_not_found',404)
        rows.append(m)
    if rows[0].id==rows[1].id:
        raise _error('guest_merge_record_conflict',409)
    return rows


def _manager(db,cls,actor):
    from app.services.class_access_service import authorize_class_action
    authorize_class_action(db,actor,cls,'invite')


def _actual(db,p):
    from app.models.record import EEGRecord,EEGRawChunk,Report,SessionRecord
    if p.entered_at is not None or p.attendance_status=='attended' or p.checkin_state=='completed' or p.checkin_at is not None or p.webrtc_peer_id or p.presence_seen_at:
        return True
    for model in (EEGRecord,EEGRawChunk,Report):
        if db.query(model.id).filter_by(participant_id=p.id).first():
            return True
    record=db.query(SessionRecord).filter_by(session_id=p.session_id).first()
    slots=((record.subjective_state or {}).get('participants') or {}).get(str(p.id)) if record else None
    return isinstance(slots,dict) and any(isinstance(slots.get(key),dict) for key in ('before','after'))


def _merge_preview_locked(db,cls,source,target):
    from app.services.class_makeup_service import lock_context
    if source.canonical_member_id or target.canonical_member_id:
        raise _error('guest_merge_record_conflict',409)
    _,rows=lock_context(db,cls)
    ids=canonical_member_ids(db,source)|canonical_member_ids(db,target)
    reservations=db.query(ClassMakeupAssignment).filter(ClassMakeupAssignment.member_id.in_(ids),ClassMakeupAssignment.status.in_(('reserved','completed'))).all()
    referenced={pid for assignment in reservations for pid in (assignment.source_participant_id,assignment.target_participant_id)}
    groups={}
    for p in rows:
        if p.member_id in ids and p.superseded_by_participant_id is None:
            groups.setdefault(p.session_id,[]).append(p)
    conflicts=[];withdraw=[];pairs=[];fingerprints=[]
    for sid,participants in sorted(groups.items(),key=lambda item:str(item[0])):
        actual=[p for p in participants if _actual(db,p)]
        fingerprints.extend((str(p.id),str(p.member_id),p.attendance_status,p.entry_ver,str(p.entered_at),_actual(db,p),str(p.removed_at)) for p in participants)
        if len(actual)>1:
            conflicts.append({'session_id':str(sid),'code':'guest_merge_record_conflict'})
            continue
        keep=actual[0] if actual else sorted(participants,key=lambda p:(p.id not in referenced,p.attendance_status=='withdrawn',p.member_id!=target.id,str(p.id)))[0]
        for p in participants:
            if p.id!=keep.id:
                pairs.append((p,keep));withdraw.append(str(p.id))
    # 실제 기록 우선 선택이 유효 예약의 원결석/대상을 지울 수는 없다.
    # 예약 취소는 별도 명시 명령으로만 하며, 병합은 FK나 예약 상태를 바꾸지 않는다.
    superseded_ids={participant.id for participant,_ in pairs}
    for assignment in reservations:
        for role,participant_id,session_id in (
            ('source',assignment.source_participant_id,assignment.source_session_id),
            ('target',assignment.target_participant_id,assignment.target_session_id),
        ):
            if participant_id in superseded_ids:
                conflicts.append({'session_id':str(session_id),'code':'makeup_assignment_invalidated',
                    'assignment_id':str(assignment.id),'participant_id':str(participant_id),'role':role})
    # 병합 후 같은 canonical 원결석의 두 예약이 될 상황도 사전에 거부한다.
    seen=set()
    for assignment in reservations:
        key=assignment.source_session_id
        if key in seen:
            conflicts.append({'session_id':str(key),'code':'makeup_already_reserved'})
        seen.add(key)
    fingerprint=_digest({'revision':cls.revision,'source':str(source.id),'target':str(target.id),
        'members':sorted(str(i) for i in ids),'participants':sorted(fingerprints),
        'assignments':sorted((str(a.id),a.status) for a in reservations)})
    return {'source_member_id':str(source.id),'target_member_id':str(target.id),'conflicts':conflicts,
        'withdraw_participant_ids':sorted(withdraw),'preview_fingerprint':fingerprint},pairs


def preview_merge(db,actor_id,class_id,source_id,target_id,reason=None):
    from app.models.user import User
    try:
        actor=db.query(User).filter_by(id=UUID(str(actor_id))).populate_existing().with_for_update(key_share=True).first()
        if actor is None or actor.status!='active':raise _error('action_forbidden',403)
        cls=_lock_class(db,class_id);_manager(db,cls,actor)
        source,target=_guest_pair(db,cls,source_id,target_id)
        result,_=_merge_preview_locked(db,cls,source,target)
        db.commit();return result
    except Exception:
        db.rollback();raise


def merge_guests(db,actor_id,class_id,command,now=None):
    now=_now(now)
    def authorize(cls,actor,data):
        _manager(db,cls,actor);_guest_pair(db,cls,data['source_member_id'],data['target_member_id'])
        if data.get('identity_confirmed') is not True or not (data.get('reason') or '').strip():raise _error('reason_required',422)
    def apply(cls,actor,data):
        source,target=_guest_pair(db,cls,data['source_member_id'],data['target_member_id'])
        preview,pairs=_merge_preview_locked(db,cls,source,target)
        if preview['preview_fingerprint']!=data['confirmed_preview_fingerprint']:raise _error('guest_merge_preview_stale',409)
        if preview['conflicts']:
            raise HTTPException(409,detail={'code':'guest_merge_record_conflict','conflicts':preview['conflicts']})
        # source/target의 예전 교환 토큰과 회차 자격도 모두 회수한다.
        _revoke(db,cls,source,now);_revoke(db,cls,target,now)
        from app.services.class_attendance_service import _change
        for p,keep in pairs:
            if p.attendance_status!='withdrawn':
                _change(db,cls,db.get(Session,p.session_id),p,'withdrawn',actor.id,data['operation_key'],data.get('reason'),'host')
            p.superseded_by_participant_id=keep.id
        for m in db.query(ClassMember).filter(ClassMember.id.in_(canonical_member_ids(db,source))).all():
            m.canonical_member_id=target.id;m.status='removed';m.removed_at=now;m.waitlist_position=None
        db.add(ClassGuestMerge(class_id=cls.id,source_member_id=source.id,target_member_id=target.id,actor_user_id=actor.id,
            reason=data['reason'],preview_fingerprint=preview['preview_fingerprint']))
        db.flush()
        return {'canonical_member_id':str(target.id),'source_member_id':str(source.id),'recovery_required':True}
    return execute_member_command(db,actor_id,class_id,command,action='guest_merge',target_id='merge',authorize=authorize,apply=apply)


def issue_recovery(db,actor_id,class_id,member_id,command,now=None):
    now=_now(now);secret={}
    def target(cls):
        m=db.query(ClassMember).filter_by(id=UUID(str(member_id)),class_id=cls.id,kind='guest',user_id=None).first()
        if m is None:raise _error('member_not_found',404)
        return db.get(ClassMember,m.canonical_member_id or m.id)
    def authorize(cls,actor,data):
        _manager(db,cls,actor);target(cls)
        if data.get('identity_confirmed') is not True or not (data.get('reason') or '').strip():raise _error('reason_required',422)
    def apply(cls,actor,data):
        member=target(cls)
        if member.status not in ('active','waitlisted','left','removed','completed'):raise _error('recovery_unavailable',409)
        for r in db.query(ClassGuestRecovery).filter_by(member_id=member.id,consumed_at=None).all():r.consumed_at=now
        token=secrets.token_urlsafe(32);expiry=now+timedelta(minutes=10)
        db.add(ClassGuestRecovery(class_id=cls.id,member_id=member.id,token_hash=sha256(token.encode()).hexdigest(),
            expires_at=expiry,issued_by=actor.id,reason=data['reason']))
        secret['exchange_token']=token
        return {'expires_at':expiry.isoformat(),'recovery_required':True}
    result=execute_member_command(db,actor_id,class_id,command,action='guest_recovery',target_id=member_id,authorize=authorize,apply=apply)
    return {**result,**secret}


def exchange_recovery(db,class_id,token,now=None):
    now=_now(now)
    try:
        cls=_lock_class(db,class_id)
        recovery=db.query(ClassGuestRecovery).filter_by(class_id=cls.id,token_hash=sha256(token.encode()).hexdigest()).populate_existing().with_for_update().first()
        if recovery is None or recovery.consumed_at is not None or recovery.expires_at<=now:raise _error()
        member=db.query(ClassMember).filter_by(id=recovery.member_id,class_id=cls.id,kind='guest',user_id=None,canonical_member_id=None).first()
        if member is None or member.status not in ('active','waitlisted','left','removed','completed'):raise _error()
        _revoke(db,cls,member,now)
        recovery.consumed_at=now
        result={'class_id':str(cls.id),'member':guest_dto(db,member,cls),'credential_bundle':issue_bundle(db,cls,member,now)}
        db.commit();return result
    except Exception:
        db.rollback();raise


def _safe_result(value):
    """저장할 결과는 식별자·상태만. 비밀과 PII는 응답 조립에서만 더한다."""
    blocked={'name','guest_name','gender','birth_date','report_email','reason','credential_bundle','entry_credential','exchange_token'}
    if isinstance(value,dict):return {k:_safe_result(v) for k,v in value.items() if k not in blocked}
    if isinstance(value,list):return [_safe_result(v) for v in value]
    return value


def execute_guest_command(db,class_id,token,command,*,action,target_id,apply,authorize=None,scope='activity',now=None,decorate=None):
    now,data=_now(now),_data(command)
    try:
        cls=_lock_class(db,class_id)
        member,grant=authenticate_guest(db,cls.id,token,scope=scope,now=now)
        if authorize:authorize(cls,member,grant,data)
        digest=_digest({'action':action,'class_id':str(cls.id),'member_id':str(member.id),'target_id':str(target_id),'body':data})
        prior=db.query(ClassMemberOperation).filter_by(member_id=member.id,operation_key=data['operation_key']).first()
        if prior:
            if prior.request_hash!=digest:raise _error('operation_key_reused',409)
            result=dict(prior.result)
        else:
            if data.get('expected_revision')!=cls.revision:raise HTTPException(409,detail={'code':'stale_class','revision':cls.revision})
            result=apply(cls,member,grant,data)
            cls.revision+=1
            result={'class_id':str(cls.id),'revision':cls.revision,**result}
            db.add(ClassMemberOperation(member_id=member.id,operation_key=data['operation_key'],request_hash=digest,result=_safe_result(result)))
        if 'member' in result:
            result={**result,'member':{**result['member'],'name':None if member.pii_scrubbed_at else member.guest_name}}
        if decorate:result=decorate(cls,member,grant,result,prior is not None)
        db.commit();return result
    except Exception:
        db.rollback();raise


def guest_transition(db,class_id,member_id,token,command,now=None):
    from types import SimpleNamespace
    from app.services.class_membership_service import _member_event,_withdraw_future,_sessions_locked,_promote_fifo
    now=_now(now);secrets_out={}
    def authorize(cls,member,grant,data):
        if str(member.id)!=str(member_id) or data['action'] not in ('leave','cancel_waitlist'):raise _error('action_forbidden',403)
    def apply(cls,member,grant,data):
        action=data['action']
        if member.status!=('active' if action=='leave' else 'waitlisted'):raise _error('member_transition_invalid',409)
        sessions=_sessions_locked(db,cls)
        _member_event(db,cls,member,'left',None,now,data.get('reason'),'self')
        _withdraw_future(db,cls,member,sessions,SimpleNamespace(id=None),data,now)
        promoted=_promote_fifo(db,cls,sessions,None,now)
        db.add(ClassEffect(class_id=cls.id,kind='live_access_reconcile',effect_key=f'guest-leave:{member.id}:{member.entry_ver}',payload={}))
        secrets_out['credential_bundle']=issue_bundle(db,cls,member,now)
        return {'member':guest_dto(db,member,cls),'promoted_member_ids':promoted}
    return execute_guest_command(db,class_id,token,command,action='guest_transition',target_id=member_id,
        authorize=authorize,apply=apply,now=now,decorate=lambda c,m,g,r,replay:{**r,**secrets_out})


def rejoin_guest(db,class_id,token,command,now=None):
    from app.services.class_membership_service import rejoin_member
    from app.services.class_code_service import normalize_class_code
    now=_now(now);secrets_out={}
    def authorize(cls,member,grant,data):
        if grant.scope!='read':raise _error()
        if not normalize_class_code(data['code']) or cls.access_code!=normalize_class_code(data['code']):raise _error('class_not_found',404)
    def apply(cls,member,grant,data):
        rejoin_member(db,cls,member,None,now,data.get('reason'))
        _revoke(db,cls,member,now)
        secrets_out['credential_bundle']=issue_bundle(db,cls,member,now)
        return {'member':guest_dto(db,member,cls)}
    return execute_guest_command(db,class_id,token,command,action='guest_rejoin',target_id='self',authorize=authorize,
        apply=apply,scope='read',now=now,decorate=lambda c,m,g,r,replay:{**r,**secrets_out,**({'credential_bundle':None,'recovery_required':True} if replay else {})})


def guest_waitlist(db,class_id,token,command,now=None):
    from app.services.class_code_service import normalize_class_code
    def authorize(cls,member,grant,data):
        if cls.access_code!=normalize_class_code(data['code']):raise _error('class_not_found',404)
    def apply(cls,member,grant,data):
        if member.status!='waitlisted':raise _error('member_transition_invalid',409)
        return {'member':guest_dto(db,member,cls)}
    return execute_guest_command(db,class_id,token,command,action='guest_waitlist',target_id='self',authorize=authorize,apply=apply,now=now)


def guest_attendance(db,class_id,session_id,member_id,token,command,now=None):
    from app.services.class_makeup_service import lock_context
    from app.services.class_attendance_service import _change,check_capacity,participant_dto
    now=_now(now)
    def authorize(cls,member,grant,data):
        if str(member.id)!=str(member_id) or member.status!='active' or data['action'] not in ('excuse','undo_excuse'):raise _error('action_forbidden',403)
    def apply(cls,member,grant,data):
        sessions,rows=lock_context(db,cls)
        session=next((s for s in sessions if str(s.id)==str(session_id)),None)
        if session is None:raise _error('session_not_found',404)
        matches=[p for p in rows if p.session_id==session.id and p.member_id in canonical_member_ids(db,member) and not p.superseded_by_participant_id]
        if len(matches)!=1:raise _error('attendance_ambiguous',409)
        p=matches[0]
        if data['expected_participation_version']!=session.participation_version:raise HTTPException(409,detail={'code':'stale_participation','participation_version':session.participation_version})
        if session.status not in ('ready','scheduled','open') or session.started_at or p.entered_at or (session.scheduled_at and session.scheduled_at<now):raise _error('attendance_already_started',409)
        expected='expected' if data['action']=='excuse' else 'excused'
        if p.attendance_status!=expected or p.removed_at or p.waitlist_cancelled_at:raise _error('attendance_transition_invalid',409)
        status='excused' if expected=='expected' else 'expected'
        if status=='expected':check_capacity(db,cls,session,p,[r for r in rows if r.session_id==session.id])
        _change(db,cls,session,p,status,None,data['operation_key'],data.get('reason'),'self')
        return {'participant':participant_dto(db,p),'participation_version':session.participation_version}
    result=execute_guest_command(db,class_id,token,command,action='guest_attendance',target_id=f'{session_id}:{member_id}',authorize=authorize,apply=apply,now=now)
    from app.services.session_service import _notify_participant_changed
    _notify_participant_changed(db.get(Session,UUID(str(session_id))),db)
    return result


def guest_makeup(db,class_id,token,command,now=None):
    from app.services.class_makeup_service import lock_context,session_in_class,reserve_locked,assignment_dto
    from app.services.class_attendance_service import participant_dto
    now=_now(now)
    def authorize(cls,member,grant,data):
        if str(member.id)!=str(data['member_id']) or member.status not in ('active','completed'):raise _error('action_forbidden',403)
    def apply(cls,member,grant,data):
        _,rows=lock_context(db,cls)
        a,p=reserve_locked(db,cls,member,session_in_class(db,cls,data['source_session_id']),session_in_class(db,cls,data['target_session_id']),rows,now)
        return {'assignment':assignment_dto(a),'participant':participant_dto(db,p)}
    return execute_guest_command(db,class_id,token,command,action='guest_makeup',target_id='makeup',authorize=authorize,apply=apply,now=now)


def guest_cancel_makeup(db,class_id,assignment_id,token,command,now=None):
    from app.services.class_makeup_service import lock_context,assignment_dto
    from app.services.class_attendance_service import _change
    now=_now(now)
    def context(cls,member):
        a=db.query(ClassMakeupAssignment).filter_by(id=UUID(str(assignment_id)),class_id=cls.id).first()
        if a is None or a.member_id not in canonical_member_ids(db,member):raise _error('makeup_not_found',404)
        return a
    def authorize(cls,member,grant,data):context(cls,member)
    def apply(cls,member,grant,data):
        _,rows=lock_context(db,cls);a=context(cls,member);s=db.get(Session,a.target_session_id)
        p=next(p for p in rows if p.id==a.target_participant_id)
        if a.status!='reserved' or p.entered_at or s.started_at or s.status not in ('ready','scheduled','open','cancelled'):raise _error('makeup_cancel_invalid',409)
        a.status='cancelled';a.cancelled_at=now;p.entry_ver+=1
        _change(db,cls,s,p,'withdrawn',None,data['operation_key'],data.get('reason'),'self')
        return {'assignment':assignment_dto(a)}
    return execute_guest_command(db,class_id,token,command,action='guest_cancel_makeup',target_id=assignment_id,authorize=authorize,apply=apply,now=now)


def guest_entry(db,class_id,session_id,token,command,now=None):
    from app.services.class_makeup_service import lock_context,cancelled_replacement_eligible
    from app.services.class_attendance_service import mark_entered,check_capacity
    from app.services.entry_credential_service import issue
    now=_now(now);context_cache={}
    def authorize(cls,member,grant,data):
        sessions,rows=lock_context(db,cls)
        s=next((s for s in sessions if str(s.id)==str(session_id)),None)
        if s is None:raise _error('session_not_found',404)
        matches=[p for p in rows if p.session_id==s.id and p.member_id in canonical_member_ids(db,member) and not p.superseded_by_participant_id]
        if len(matches)!=1:raise _error('member_access_revoked',403)
        p=matches[0]
        if s.status not in ('open','in_progress') or p.removed_at or p.waitlist_cancelled_at or p.is_waitlisted or p.attendance_status=='withdrawn':raise _error('member_access_revoked',403)
        if member.status=='active' and cls.status=='active' and grant.scope=='activity':
            pass
        elif member.status=='completed' and cls.status in ('active','completed') and cls.schedule_mode=='fixed' and grant.scope=='read':
            a=db.query(ClassMakeupAssignment).filter(ClassMakeupAssignment.class_id==cls.id,ClassMakeupAssignment.member_id.in_(canonical_member_ids(db,member)),
                ClassMakeupAssignment.target_participant_id==p.id,ClassMakeupAssignment.target_session_id==s.id,ClassMakeupAssignment.status.in_(('reserved','completed'))).first()
            if a:
                source=db.query(SessionParticipant).filter_by(id=a.source_participant_id,session_id=a.source_session_id).first()
                if not source or source.member_id not in canonical_member_ids(db,member) or source.attendance_status not in ('absent','excused'):raise _error('member_access_revoked',403)
            elif not cancelled_replacement_eligible(db,p,member,cls):raise _error('member_access_revoked',403)
        else:raise _error('member_access_revoked',403)
        check_capacity(db,cls,s,p,[r for r in rows if r.session_id==s.id])
        context_cache.update(session=s,participant=p)
    def apply(cls,member,grant,data):
        s,p=context_cache['session'],context_cache['participant']
        mark_entered(db,s,p,now)
        return {'session_id':str(s.id),'participant_id':str(p.id)}
    def decorate(cls,member,grant,result,replay):
        # 현재 자격과 배정은 prior 복원 전에도 재검사했다. 토큰은 저장하지 않는다.
        credential,expiry=issue(context_cache['participant'])
        return {**result,'entry_credential':credential,'expires_at':expiry.isoformat()}
    result=execute_guest_command(db,class_id,token,command,action='guest_entry',target_id=session_id,scope='read',authorize=authorize,apply=apply,now=now,decorate=decorate)
    from app.services.session_service import _notify_participant_changed
    _notify_participant_changed(context_cache['session'],db)
    return result
