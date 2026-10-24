"""클래스 본인 동의 및 canonical 개인정보 수명. 하위 처리기는 flush만 수행한다."""
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4
from fastapi import HTTPException
from app.models.class_program import Class, ClassMember
from app.models.class_membership import ClassMemberConsentEvent
from app.models.session import Session, SessionParticipant, ReportChoiceEvent
from app.models.research import ResearchConsent
from app.services import research_consent_service as research


def _now(now=None):
    return now or datetime.now(timezone.utc)


def _error(code, status=403):
    return HTTPException(status, detail={'code':code})


def consent_view(member):
    return {'member_id':str(member.id), 'report_included_default':bool(member.report_included_default),
        'research_consented':bool(member.research_consented), 'research_notice_version':member.research_notice_version,
        'research_selected_at':member.research_selected_at.isoformat() if member.research_selected_at else None,
        'research_origin_id':str(member.research_origin_id) if member.research_origin_id else None,
        'reminder_opt_in':bool(member.reminder_opt_in), 'notice_version':member.notice_version}


def _own_member(db, class_id, user_id=None, member_credential=None):
    if user_id:
        if db.query(Class.id).filter_by(id=UUID(str(class_id))).first() is None:
            raise _error('class_not_found',404)
        from app.models.user import User
        actor=db.get(User,UUID(str(user_id)))
        if actor is None or actor.status!='active': raise _error('action_forbidden')
        member=db.query(ClassMember).filter_by(class_id=UUID(str(class_id)),user_id=actor.id,canonical_member_id=None).first()
        if not member: raise _error('member_not_found',404)
        return member
    from app.services.class_guest_service import authenticate_guest
    return authenticate_guest(db,class_id,member_credential,scope='read')[0]


def get_consents(db, class_id, *, user_id=None, member_credential=None):
    return consent_view(_own_member(db,class_id,user_id,member_credential))


def _event(db,member,choice,value,now,key,*,origin=None,notice=None):
    db.add(ClassMemberConsentEvent(class_id=member.class_id,member_id=member.id,choice=choice,value=value,
        notice_version=notice,selected_at=now,origin_id=origin or uuid4(),actor_user_id=member.user_id,operation_key=key))


def record_join_choices(db,member,key,now):
    """가입 선택 원본은 기존 회차 동의로 추정하지 않고 독립 append-only로 남긴다."""
    for choice,value,notice in [('report',member.report_included_default,member.notice_version),
            ('research',member.research_consented,member.research_notice_version),('reminder',member.reminder_opt_in,None)]:
        _event(db,member,choice,value,now,key,origin=member.research_origin_id if choice=='research' else None,notice=notice)
    db.flush()


def copy_member_defaults(db, member, participant, *, report=True, research_choice=True, pii=False):
    """새 사본/미래 참가행 전용. 호출자가 회차 범위·override·잠금을 확인한다."""
    if pii and member.kind=='guest':
        if member.pii_scrubbed_at:
            participant.pii_scrubbed_at=member.pii_scrubbed_at
            for field in ('guest_name','gender','birth_date','report_email'):
                setattr(participant,field,None)
        elif participant.pii_scrubbed_at is None:
            for field in ('guest_name','gender','birth_date','report_email'):
                setattr(participant,field,getattr(member,field))
    if report and not participant.report_consent_override:
        changed=bool(participant.report_included)!=bool(member.report_included_default)
        participant.report_included=bool(member.report_included_default)
        participant.report_notice_version=member.notice_version
        participant.report_notice_ack_at=member.notice_ack_at
        if changed:
            db.add(ReportChoiceEvent(session_id=participant.session_id,participant_id=participant.id,
                previous_included=not bool(member.report_included_default),new_included=bool(member.report_included_default),
                actor_kind='self',actor_user_id=member.user_id))
    if research_choice and not participant.research_consent_override:
        research.copy_class_choice(db,participant,member)
    db.flush()


def _locked_participants(db,cls,member):
    from app.services.class_guest_service import canonical_member_ids
    ids=canonical_member_ids(db,member)
    sessions=db.query(Session).filter_by(class_id=cls.id).execution_options(include_hidden=True).order_by(Session.id).populate_existing().with_for_update().all()
    rows=db.query(SessionParticipant).filter(SessionParticipant.session_id.in_([s.id for s in sessions]),SessionParticipant.member_id.in_(ids)).execution_options(include_removed=True).order_by(SessionParticipant.id).populate_existing().with_for_update().all()
    return {s.id:s for s in sessions},rows


def _command(db,class_id,command,user_id,token,apply,*,withdraw=False,now=None):
    from app.services.class_member_commands import execute_member_command
    from app.services.class_guest_service import execute_guest_command
    def authorize_member(cls,member):
        if not withdraw and (cls.status!='active' or member.status not in ('active','waitlisted')):
            raise _error('action_forbidden')
    if user_id:
        own={}
        def authorize(cls,actor,data):
            member=db.query(ClassMember).filter_by(class_id=cls.id,user_id=actor.id,canonical_member_id=None).first()
            if not member: raise _error('member_not_found',404)
            authorize_member(cls,member);own['member']=member
        return execute_member_command(db,user_id,class_id,command,action='class_research_withdrawal' if withdraw else 'class_consents',target_id=class_id,
            authorize=authorize,apply=lambda cls,actor,data:apply(cls,own['member'],data))
    def authorize(cls,member,grant,data): authorize_member(cls,member)
    return execute_guest_command(db,class_id,token,command,action='class_research_withdrawal' if withdraw else 'class_consents',target_id=class_id,
        scope='read' if withdraw else 'activity',authorize=authorize,apply=lambda cls,m,g,data:apply(cls,m,data),now=now)


def update_consents(db,class_id,command,*,user_id=None,member_credential=None,now=None):
    now=_now(now)
    if hasattr(command,'model_dump'):
        command=command.model_dump(mode='json',exclude_unset=True)
    def apply(cls,member,data):
        if member.user_id is None and data.get('research_consented') is True:
            raise _error('guest_research_not_applicable')
        report_changed='report_included_default' in data and data['report_included_default']!=member.report_included_default
        notice_changed='research_notice_version' in data and data['research_notice_version']!=member.research_notice_version
        if notice_changed and data.get('research_consented') is not True:
            raise _error('research_choice_required',422)
        research_reselected=notice_changed and data.get('research_consented') is True
        research_changed=('research_consented' in data and data['research_consented']!=member.research_consented) or research_reselected
        if data.get('report_included_default') and data.get('notice_version',member.notice_version)!='class-team-v1':
            raise _error('invalid_notice_version',422)
        if research_changed and data['research_consented'] and not data.get('research_notice_version'):
            raise _error('invalid_notice_version',422)
        for field in ('notice_version','research_notice_version'):
            if field in data: setattr(member,field,data[field])
        if 'notice_version' in data: member.notice_ack_at=now
        for field,choice in [('report_included_default','report'),('research_consented','research'),('reminder_opt_in','reminder')]:
            if field not in data or (getattr(member,field)==data[field] and not (choice=='research' and research_reselected)): continue
            setattr(member,field,data[field])
            if choice=='research' and data[field]:
                member.research_selected_at=now;member.research_origin_id=uuid4()
            _event(db,member,choice,data[field],now,data['operation_key'],
                origin=member.research_origin_id if choice=='research' else None,
                notice=member.research_notice_version if choice=='research' else member.notice_version if choice=='report' else None)
        sessions,participants=_locked_participants(db,cls,member)
        updated=[]
        for p in participants:
            s=sessions[p.session_id]
            if p.entered_at is not None or s.status not in ('ready','scheduled','open') or s.started_at is not None or s.ended_at is not None or p.superseded_by_participant_id is not None:
                continue
            if s.scheduled_at and s.scheduled_at<=now and s.status!='open': continue
            report=report_changed and not p.report_consent_override
            research_change=research_changed and not p.research_consent_override
            if report or research_change:
                copy_member_defaults(db,member,p,report=report,research_choice=research_change)
                updated.append(str(p.id))
        db.flush()
        return {'consents':consent_view(member),'updated_future_participant_ids':updated}
    return _command(db,class_id,command,user_id,member_credential,apply,now=now)


def withdraw_research(db,class_id,command,*,user_id=None,member_credential=None,now=None):
    now=_now(now)
    def apply(cls,member,data):
        if not (data.get('reason') or '').strip(): raise _error('reason_required',422)
        _,participants=_locked_participants(db,cls,member)
        rows=db.query(ResearchConsent).filter(ResearchConsent.participant_id.in_([p.id for p in participants]),ResearchConsent.consented.is_(True)).order_by(ResearchConsent.id).with_for_update().all()
        research.withdraw_rows(db,rows,now=now,actor_kind='self',actor_user_id=member.user_id,reason=data['reason'])
        # 미래 기본값도 끄되 원선택 시각·ID와 회차 원증빙은 보존한다.
        from app.services.class_guest_service import canonical_member_ids
        for m in db.query(ClassMember).filter(ClassMember.id.in_(canonical_member_ids(db,member))).all(): m.research_consented=False
        _event(db,member,'research',False,now,data['operation_key'],origin=member.research_origin_id,notice=member.research_notice_version)
        db.flush()
        return {'affected_count':len(rows),'withdrawn_at':now.isoformat()}
    return _command(db,class_id,command,user_id,member_credential,apply,withdraw=True,now=now)


def rotate_access_code(db,class_id,user_id,command):
    from app.services.class_member_commands import execute_member_command
    from app.services.class_access_service import authorize_class_action
    from app.services.class_code_service import generate_class_code,ClassCodeExhausted,exhausted_http_error
    def apply(cls,actor,data):
        try: cls.access_code=generate_class_code(db)
        except ClassCodeExhausted: raise exhausted_http_error()
        return {'access_code':cls.access_code}
    return execute_member_command(db,user_id,class_id,command,action='rotate_access_code',target_id=class_id,
        authorize=lambda cls,actor,data:authorize_class_action(db,actor,cls,'manage'),apply=apply)


def scrub_expired_guests(db, *, now=None, execute=True, apply_from=None):
    """canonical 종료+마지막 출석 종료 중 늦은 시각의 90일 경계. commit은 sweep 소유."""
    from app.services.class_guest_service import canonical_member_ids
    from app.models.session_email_invite import SessionEmailInvite
    now=_now(now);rep={'members':0,'participants':0,'invites':0}
    class_ids=[cid for cid, in db.query(ClassMember.class_id).filter_by(kind='guest',canonical_member_id=None).distinct().order_by(ClassMember.class_id).all()]
    for cid in class_ids:
        cls=db.query(Class).filter_by(id=cid).execution_options(include_hidden=True).populate_existing().with_for_update().first()
        members=db.query(ClassMember).filter_by(class_id=cid).order_by(ClassMember.id).populate_existing().with_for_update().all()
        sessions=db.query(Session).filter_by(class_id=cid).execution_options(include_hidden=True).order_by(Session.id).populate_existing().with_for_update().all()
        participants=db.query(SessionParticipant).filter(SessionParticipant.session_id.in_([s.id for s in sessions])).execution_options(include_removed=True).order_by(SessionParticipant.id).populate_existing().with_for_update().all()
        by_session={s.id:s for s in sessions}
        for member in members:
            if member.kind!='guest' or member.canonical_member_id is not None or member.status not in ('completed','left','removed'): continue
            ids=canonical_member_ids(db,member)
            originals=[m for m in members if m.id in ids]
            end_fields={'completed':'completed_at','left':'left_at','removed':'removed_at'}
            # 병합 원본의 최근 종료도 같은 개인정보 수명에 포함한다.
            # 활동 중이거나 종료 시각이 없는 alias는 생성일 등으로 추정하지 않는다.
            if any(m.status not in end_fields for m in originals): continue
            ends=[getattr(m,end_fields[m.status]) for m in originals]
            if any(stamp is None for stamp in ends): continue
            end=max(ends)
            copies=[p for p in participants if p.member_id in ids]
            attended=[by_session[p.session_id].ended_at for p in copies if p.attendance_status=='attended']
            if any(stamp is None for stamp in attended): continue
            ref=max([end,*attended])
            if now<ref+timedelta(days=90) or (apply_from and ref<apply_from): continue
            unscrubbed=[row for row in [*originals,*copies] if row.pii_scrubbed_at is None]
            emails={row.report_email.casefold() for row in [*originals,*copies] if row.report_email}
            invites=db.query(SessionEmailInvite).filter(SessionEmailInvite.session_id.in_([p.session_id for p in copies]),SessionEmailInvite.email_norm.in_(emails),SessionEmailInvite.pii_scrubbed_at.is_(None)).order_by(SessionEmailInvite.id).with_for_update().all() if emails else []
            rep['members']+=sum(m.pii_scrubbed_at is None for m in originals)
            rep['participants']+=sum(p.pii_scrubbed_at is None for p in copies)
            rep['invites']+=len(invites)
            if not execute: continue
            for row in unscrubbed:
                for field in ('guest_name','gender','birth_date','report_email'): setattr(row,field,None)
                row.pii_scrubbed_at=now
            for p in copies:
                if p.report_email_status not in (None,'sent'): p.report_email_status='cancelled'
            for invite in invites:
                invite.email=None;invite.email_norm=None;invite.pii_scrubbed_at=now;invite.status='cancelled'
            _scrub_operation_results(db,cid,ids)
    db.flush()
    return rep


def lock_session_choice(db, session_id, current_user_id=None):
    """기존 회차 명시 선택도 기본값 전파와 같은 잠금 순서로 직렬화한다."""
    from app.models.user import User
    session=db.query(Session).filter_by(id=session_id).first()
    if session is None or session.class_id is None:
        return session
    if current_user_id:
        db.query(User).filter_by(id=UUID(str(current_user_id))).with_for_update(key_share=True).first()
    db.query(Class).filter_by(id=session.class_id).with_for_update().first()
    db.query(ClassMember).filter_by(class_id=session.class_id).order_by(ClassMember.id).with_for_update().all()
    session=db.query(Session).filter_by(id=session_id).populate_existing().with_for_update().first()
    db.query(SessionParticipant).filter_by(session_id=session_id).execution_options(include_removed=True).order_by(SessionParticipant.id).populate_existing().with_for_update().all()
    return session


def _scrub_operation_results(db, class_id, member_ids):
    """동일인 추정 없이 명시 멤버 ID를 가진 이전 응답 사본만 비운다."""
    from app.models.class_scheduling import ClassOperation
    from app.models.class_membership import ClassMemberOperation
    ids={str(mid) for mid in member_ids}
    pii_fields={'name','guest_name','gender','birth_date','report_email'}
    def redact(value):
        if isinstance(value,list): return [redact(item) for item in value]
        if not isinstance(value,dict): return value
        exact=str(value.get('member_id')) in ids or str(value.get('id')) in ids
        return {key:None if exact and key in pii_fields else redact(item) for key,item in value.items()}
    operations=db.query(ClassOperation).filter_by(class_id=class_id).order_by(ClassOperation.id).populate_existing().with_for_update().all()
    operations+=db.query(ClassMemberOperation).filter(ClassMemberOperation.member_id.in_(member_ids)).order_by(ClassMemberOperation.id).populate_existing().with_for_update().all()
    for operation in operations:
        clean=redact(operation.result)
        if clean!=operation.result: operation.result=clean


def set_session_recording_consent(db, class_id, session_id, consented, notice_version, *, user_id=None, member_credential=None):
    """SDD-220(F1): 클래스 멤버(회원·게스트)의 이 회차 녹음·녹화 동의를 참여자 행에 저장한다.

    입장 자격(entry_credential)을 받기 전에 호출하므로 로그인 또는 멤버 자격(X-Class-Member-Credential)으로 본인을 확인한다.
    거부(false)는 기록만 하고 이후 guest-entry/입장은 계속 403 RECORDING_CONSENT_REQUIRED 다.
    """
    from app.services import recording_consent_service as rcs
    from app.services.class_guest_service import canonical_member_ids
    member=_own_member(db,class_id,user_id,member_credential)
    sid=UUID(str(session_id))
    if db.query(Session.id).filter_by(id=sid,class_id=UUID(str(class_id))).first() is None:
        raise _error('session_not_found',404)
    rows=db.query(SessionParticipant).filter(SessionParticipant.session_id==sid,
        SessionParticipant.member_id.in_(canonical_member_ids(db,member)),
        SessionParticipant.superseded_by_participant_id.is_(None)).all()
    if len(rows)!=1: raise _error('participant_not_found',404)
    p=rows[0]
    if consented: rcs.apply_recording_consent(p,notice_version)
    else:
        p.recording_consented=False;p.recording_consent_at=None;p.recording_notice_version=None
    db.commit()
    return rcs._view(p)
