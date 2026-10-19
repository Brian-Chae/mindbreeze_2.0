"""출석 명령과 실제 입장·정상 종료 훅. 호출자가 잠금과 커밋을 소유한다."""
from datetime import datetime, timezone
from uuid import UUID
from fastapi import HTTPException
from app.models.class_program import ClassMember
from app.models.class_membership import ClassAttendanceEvent, ClassMakeupAssignment
from app.models.session import Session, SessionParticipant
from app.services.class_member_commands import execute_member_command
from app.services.class_instructor_service import validate_instructor
from app.services.class_membership_service import _occupied_seats, _sessions_locked


def participant_dto(db, participant):
    member = db.get(ClassMember, participant.member_id) if participant.member_id else None
    assignment = db.query(ClassMakeupAssignment).filter(ClassMakeupAssignment.target_participant_id == participant.id, ClassMakeupAssignment.status.in_(('reserved','completed'))).first()
    return {'id':str(participant.id),'session_id':str(participant.session_id),'member_id':str(participant.member_id) if participant.member_id else None,'canonical_member_id':str(member.canonical_member_id or member.id) if member else None,'attendance_status':participant.attendance_status,'attendance_kind':participant.attendance_kind,'entered_at':participant.entered_at.isoformat() if participant.entered_at else None,'makeup_for_session_id':str(participant.makeup_for_session_id) if participant.makeup_for_session_id else None,'makeup_assignment_id':str(assignment.id) if assignment else None}


def lock_participants(db, session):
    return db.query(SessionParticipant).filter_by(session_id=session.id).order_by(SessionParticipant.id).populate_existing().with_for_update().all()


def eligible_participant(db, participant, *, allow_excused=True, allow_completed=False):
    if participant.removed_at or participant.waitlist_cancelled_at or participant.superseded_by_participant_id or participant.attendance_status == 'withdrawn':
        return False
    if not allow_excused and participant.member_id and participant.attendance_status == 'excused':
        return False
    if participant.member_id is None:
        return True
    member = db.get(ClassMember, participant.member_id)
    if member is None:
        return False
    member = db.get(ClassMember, member.canonical_member_id or member.id)
    if member.status == 'active':
        return True
    if member.status == 'completed':
        # 종료 본인 조회·사후 체크인만 활동 자격과 분리한다. 새 입장에는 적용하지 않는다.
        if allow_completed and not participant.is_waitlisted:
            session = db.get(Session, participant.session_id)
            if session and session.status == 'completed' and session.class_id == member.class_id:
                return True
        if participant.attendance_kind == 'makeup':
            ids = {m.id for m in db.query(ClassMember).filter(
                ClassMember.class_id == member.class_id,
                (ClassMember.id == member.id) | (ClassMember.canonical_member_id == member.id),
            ).all()}
            assignment = db.query(ClassMakeupAssignment).filter(
                ClassMakeupAssignment.class_id == member.class_id,
                ClassMakeupAssignment.target_participant_id == participant.id,
                ClassMakeupAssignment.target_session_id == participant.session_id,
                ClassMakeupAssignment.member_id.in_(ids),
                ClassMakeupAssignment.status.in_(('reserved', 'completed')),
            ).first()
            if assignment is None:
                return False
            source = db.query(SessionParticipant).join(Session, Session.id == SessionParticipant.session_id).filter(
                SessionParticipant.id == assignment.source_participant_id,
                SessionParticipant.session_id == assignment.source_session_id,
                SessionParticipant.member_id.in_(ids), Session.class_id == member.class_id,
                SessionParticipant.superseded_by_participant_id.is_(None),
                SessionParticipant.attendance_status.in_(('absent', 'excused')),
            ).first()
            return source is not None
        from app.services.class_makeup_service import cancelled_replacement_eligible
        return cancelled_replacement_eligible(db, participant, member)
    return False


def require_eligible(db, participant, *, allow_excused=True, allow_completed=False):
    if not eligible_participant(db, participant, allow_excused=allow_excused, allow_completed=allow_completed):
        raise HTTPException(403,detail={'code':'member_access_revoked'})


def check_capacity(db, cls, session, participant, participants):
    if _occupied_seats(db, cls, participants, exclude_id=participant.id) >= session.max_participants:
        raise HTTPException(409,detail={'code':'session_capacity'})


def source_assignment(db, participant):
    """이 참가행을 원결석으로 사용하는 예약·완료 이력. 클래스 잠금 안에서 검사한다."""
    return db.query(ClassMakeupAssignment).filter(
        ClassMakeupAssignment.source_participant_id == participant.id,
        ClassMakeupAssignment.status.in_(('reserved', 'completed')),
    ).first()


def require_source_preserved(db, participant, status):
    if participant.attendance_status in ('absent', 'excused') and status not in ('absent', 'excused'):
        assignment = source_assignment(db, participant)
        if assignment is not None:
            raise HTTPException(409, detail={'code': 'makeup_source_in_use',
                'assignment_id': str(assignment.id), 'assignment_status': assignment.status})


def _change(db, cls, session, participant, status, actor_id, key, reason=None, actor_kind='self'):
    previous = participant.attendance_status
    if previous == status:
        return False
    require_source_preserved(db, participant, status)
    participant.attendance_status = status
    participant.attendance_marked_by = 'self' if actor_kind == 'guest' else actor_kind
    if participant.member_id:
        db.add(ClassAttendanceEvent(class_id=cls.id,session_id=session.id,participant_id=participant.id,member_id=participant.member_id,old_status=previous,new_status=status,actor_user_id=actor_id,actor_kind=actor_kind,reason=reason,operation_key=key))
    session.participation_version = (session.participation_version or 0) + 1
    if participant.attendance_kind == 'makeup':
        from app.services.class_makeup_service import sync_completion
        sync_completion(db, participant)
    return True


def mark_entered(db, session, participant, now=None):
    """정원과 현재 자격 확인 후 최초 실제 입장만 기록한다. 대기는 출석이 아니다."""
    from app.models.class_program import Class
    if participant.is_waitlisted:
        return
    require_eligible(db, participant)
    cls = db.get(Class, session.class_id) if session.class_id else None
    if cls is None or participant.member_id is None:
        if participant.entered_at is None:
            participant.entered_at = now or datetime.now(timezone.utc)
        return
    participants = lock_participants(db, session)
    require_eligible(db, participant)
    if participant.entered_at is not None and participant.attendance_status == 'attended':
        return
    check_capacity(db, cls, session, participant, participants)
    require_source_preserved(db, participant, 'attended')
    first = participant.entered_at is None
    if first:
        participant.entered_at = now or datetime.now(timezone.utc)
    changed = _change(db,cls,session,participant,'attended',participant.user_id,f'enter:{participant.id}',actor_kind='self' if participant.user_id else 'guest')
    if first and not changed:
        session.participation_version += 1
    db.flush()


def finalize_attendance(db, cls, session):
    for participant in lock_participants(db, session):
        if participant.attendance_status == 'expected' and participant.entered_at is None and not participant.is_waitlisted and not participant.superseded_by_participant_id:
            _change(db,cls,session,participant,'absent',None,f'end:{session.id}',actor_kind='system')
    db.flush()


def change_attendance(db, actor_id, class_id, session_id, member_id, command, now=None):
    now = now or datetime.now(timezone.utc)
    session_id, member_id = UUID(str(session_id)), UUID(str(member_id))
    def context(cls):
        row = db.query(Session).filter_by(id=session_id,class_id=cls.id).first()
        member = db.query(ClassMember).filter_by(id=member_id,class_id=cls.id).first()
        if row is None or member is None:
            raise HTTPException(404,detail={'code':'attendance_not_found'})
        return row, member
    def authorize(cls, actor, data):
        row, member = context(cls)
        correction = data['action'].startswith('correct_')
        if correction:
            try:
                instructor = validate_instructor(db, cls, actor.id, row.id)
            except HTTPException:
                raise HTTPException(403, detail={'code': 'attendance_forbidden'})
            if actor.role != 'counselor' or (row.host_id != actor.id and instructor.role not in ('lead','assistant')):
                raise HTTPException(403,detail={'code':'attendance_forbidden'})
            if not (data.get('reason') or '').strip():
                raise HTTPException(422,detail={'code':'reason_required'})
        elif member.user_id != actor.id or member.status != 'active':
            raise HTTPException(403,detail={'code':'attendance_forbidden'})
    def apply(cls, actor, data):
        sessions = _sessions_locked(db,cls)
        row = next(s for s in sessions if s.id == session_id)
        participants = lock_participants(db,row)
        member = context(cls)[1]
        canonical = member.canonical_member_id or member.id
        ids = [m.id for m in db.query(ClassMember).filter(ClassMember.class_id==cls.id).all() if m.id==canonical or m.canonical_member_id==canonical]
        matches = [p for p in participants if p.member_id in ids and not p.superseded_by_participant_id]
        if len(matches)!=1:
            raise HTTPException(409,detail={'code':'attendance_ambiguous'})
        participant=matches[0]
        if data['expected_participation_version'] != row.participation_version:
            raise HTTPException(409,detail={'code':'stale_participation','participation_version':row.participation_version})
        action=data['action']
        if action.startswith('correct_'):
            if row.status != 'completed':
                raise HTTPException(409,detail={'code':'attendance_not_finished'})
            status=action.removeprefix('correct_')
        else:
            if row.status not in ('ready','scheduled','open') or row.started_at is not None or participant.entered_at is not None or (row.scheduled_at and row.scheduled_at < now):
                raise HTTPException(409,detail={'code':'attendance_already_started'})
            expected='expected' if action=='excuse' else 'excused'
            if participant.attendance_status != expected:
                raise HTTPException(409,detail={'code':'attendance_transition_invalid'})
            status='excused' if action=='excuse' else 'expected'
            if status=='expected':check_capacity(db,cls,row,participant,participants)
        _change(db,cls,row,participant,status,actor.id,data['operation_key'],data.get('reason'),'host' if action.startswith('correct_') else 'self')
        db.flush()
        return {'participant':participant_dto(db,participant),'participation_version':row.participation_version}
    result = execute_member_command(db,actor_id,class_id,command,action='attendance',target_id=f'{session_id}:{member_id}',authorize=authorize,apply=apply)
    from app.services.session_service import _notify_participant_changed
    _notify_participant_changed(db.get(Session, session_id), db)
    return result
