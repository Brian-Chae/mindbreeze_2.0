"""개인 결석 보강 매칭. 잠금·커밋은 최상위 명령이 소유한다."""
from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import null

from app.models.class_program import ClassMember
from app.models.class_membership import ClassMakeupAssignment
from app.models.session import Session, SessionParticipant
from app.services.class_member_commands import execute_member_command
from app.services.class_instructor_service import validate_instructor
from app.services.class_membership_service import _occupied_seats, _sessions_locked



def cancelled_replacement_eligible(db, participant, member, cls=None):
    """명시 편성된 취소 회차 대체만 수료 후 자격으로 인정한다. 개인 보강은 아니다."""
    from app.models.class_program import Class

    if member.status != 'completed' or participant.attendance_kind != 'regular' or not participant.makeup_for_session_id:
        return False
    if cls is None:
        cls = db.query(Class).filter_by(id=member.class_id).first()
    if cls is None or cls.hidden_at is not None or cls.status not in ('active', 'completed') or cls.schedule_mode != 'fixed':
        return False
    target = db.query(Session).filter_by(id=participant.session_id, class_id=cls.id, session_kind='makeup').first()
    if target is None or target.id == participant.makeup_for_session_id or member.class_id != cls.id:
        return False
    source = db.query(Session).filter_by(id=participant.makeup_for_session_id, class_id=cls.id,
                                         session_kind='regular', status='cancelled').first()
    return source is not None


def assignment_dto(assignment):
    fields = ('id', 'member_id', 'source_session_id', 'source_participant_id',
              'target_session_id', 'target_participant_id', 'status')
    result = {key: str(getattr(assignment, key)) for key in fields}
    for key in ('created_at', 'cancelled_at', 'completed_at'):
        value = getattr(assignment, key)
        result[key] = value.isoformat() if value else None
    return result


def canonical_member(db, cls, member_id):
    member = db.query(ClassMember).filter_by(id=UUID(str(member_id)), class_id=cls.id).first()
    if member is None:
        raise HTTPException(404, detail={'code': 'member_not_found'})
    canonical = db.query(ClassMember).filter_by(id=member.canonical_member_id or member.id, class_id=cls.id).first()
    if canonical is None:
        raise HTTPException(404, detail={'code': 'member_not_found'})
    return canonical


def member_ids(db, cls, member):
    return {m.id for m in db.query(ClassMember).filter_by(class_id=cls.id).all()
            if m.id == member.id or m.canonical_member_id == member.id}


def session_in_class(db, cls, session_id):
    row = db.query(Session).filter_by(id=UUID(str(session_id)), class_id=cls.id).first()
    if row is None:
        raise HTTPException(404, detail={'code': 'session_not_found'})
    return row


def require_assign_permission(db, cls, actor, target, member=None):
    """현재 본인 또는 해당 회차 진행자/관리 강사. 센터 관리자만으로 부여하지 않는다."""
    if member is not None and member.user_id == actor.id and member.status in ('active', 'completed'):
        return
    try:
        instructor = validate_instructor(db, cls, actor.id, target.id)
    except HTTPException:
        raise HTTPException(403, detail={'code': 'action_forbidden'})
    if actor.role != 'counselor' or (target.host_id != actor.id and instructor.role not in ('lead', 'assistant')):
        raise HTTPException(403, detail={'code': 'action_forbidden'})


def lock_context(db, cls):
    db.query(ClassMember).filter_by(class_id=cls.id).order_by(ClassMember.id).populate_existing().with_for_update().all()
    sessions = _sessions_locked(db, cls)
    ids = [row.id for row in sessions]
    participants = (db.query(SessionParticipant).filter(SessionParticipant.session_id.in_(ids))
                    .execution_options(include_removed=True).order_by(SessionParticipant.id).populate_existing().with_for_update().all())
    return sessions, participants


def _valid_member(cls, member):
    if cls.status not in ('active', 'completed') or member.status not in ('active', 'completed') or (
        (cls.status == 'completed' or member.status == 'completed') and cls.schedule_mode != 'fixed'
    ):
        raise HTTPException(409, detail={'code': 'member_transition_invalid'})


def validate_reservation(db, cls, member, source, target, participants, now):
    """같은 원결석/대상 회차의 예약 조건만 읽는다. 잠금·변경·flush는 호출자 소유다."""
    from app.services.class_conflict_service import utc

    _valid_member(cls, member)
    if source.class_id != cls.id or target.class_id != cls.id or source.id == target.id or source.status == 'cancelled':
        raise HTTPException(409, detail={'code': 'makeup_source_invalid'})
    if target.status not in ('ready', 'scheduled') or target.started_at is not None or (
        target.scheduled_at is not None and utc(target.scheduled_at) <= utc(now)
    ):
        raise HTTPException(409, detail={'code': 'makeup_target_invalid'})
    ids = member_ids(db, cls, member)
    sources = [p for p in participants if p.session_id == source.id and p.member_id in ids
               and not p.superseded_by_participant_id]
    if len(sources) != 1 or sources[0].attendance_status not in ('absent', 'excused') or sources[0].attendance_kind != 'regular':
        raise HTTPException(409, detail={'code': 'makeup_source_invalid'})
    origin = sources[0]
    # alias에 남아 있는 이전 원결석 예약도 같은 canonical 범위에서 검사한다.
    source_ids = [p.id for p in participants if p.session_id == source.id and p.member_id in ids]
    existing = db.query(ClassMakeupAssignment).filter(
        ClassMakeupAssignment.class_id == cls.id,
        ClassMakeupAssignment.source_participant_id.in_(source_ids),
        ClassMakeupAssignment.status.in_(('reserved', 'completed')),
    ).first()
    if existing:
        raise HTTPException(409, detail={'code': 'makeup_already_reserved'})
    targets = [p for p in participants if p.session_id == target.id and (p.member_id in ids
               or (member.user_id is not None and p.user_id == member.user_id))]
    if len(targets) > 1:
        raise HTTPException(409, detail={'code': 'target_participant_exists'})
    participant = targets[0] if targets else None
    if participant is not None and (
        participant.superseded_by_participant_id is not None
        or participant.attendance_kind != 'makeup' or participant.attendance_status != 'withdrawn'
        or participant.entered_at is not None or participant.removed_at is not None
        or db.query(ClassMakeupAssignment).filter(
            ClassMakeupAssignment.target_participant_id == participant.id,
            ClassMakeupAssignment.status.in_(('reserved', 'completed')),
        ).first()
    ):
        raise HTTPException(409, detail={'code': 'target_participant_exists'})
    target_rows = [p for p in participants if p.session_id == target.id]
    if _occupied_seats(db, cls, target_rows, participant.id if participant else None) >= target.max_participants:
        raise HTTPException(409, detail={'code': 'session_capacity'})
    return origin, participant


def reserve_locked(db, cls, member, source, target, participants, now):
    """공유 판정을 통과한 예약만 기존 잠금 트랜잭션 안에서 생성한다."""
    origin, participant = validate_reservation(db, cls, member, source, target, participants, now)
    if participant is None:
        participant = SessionParticipant(session_id=target.id, member_id=member.id, user_id=member.user_id, joined_at=null(), report_included=False)
        db.add(participant)
        db.flush()
        from app.services.class_member_consent_service import copy_member_defaults
        copy_member_defaults(db,member,participant,pii=True)
    participant.attendance_kind = 'makeup'
    participant.attendance_status = 'expected'
    participant.makeup_for_session_id = source.id
    participant.is_waitlisted = False
    participant.waitlist_cancelled_at = None
    participant.entry_ver = (participant.entry_ver or 0) + 1
    target.participation_version = (target.participation_version or 0) + 1
    db.flush()
    assignment = ClassMakeupAssignment(class_id=cls.id, member_id=member.id,
        source_session_id=source.id, source_participant_id=origin.id,
        target_session_id=target.id, target_participant_id=participant.id,
        status='reserved', created_at=now)
    db.add(assignment)
    db.flush()
    if participant not in participants:
        participants.append(participant)
    return assignment, participant


def sync_completion(db, participant, now=None):
    """예약 완료는 실제 대상 출석에서만 파생한다. 원 결석은 바꾸지 않는다."""
    for assignment in db.query(ClassMakeupAssignment).filter(
        ClassMakeupAssignment.target_participant_id == participant.id,
        ClassMakeupAssignment.status.in_(('reserved', 'completed')),
    ).all():
        if participant.attendance_status == 'attended':
            assignment.status = 'completed'
            assignment.completed_at = assignment.completed_at or participant.entered_at or now or datetime.now(timezone.utc)
        else:
            assignment.status = 'reserved'
            assignment.completed_at = None


def assign_makeup(db, actor_id, class_id, command, now=None):
    now = now or datetime.now(timezone.utc)
    def authorize(cls, actor, data):
        member = canonical_member(db, cls, data['member_id'])
        target = session_in_class(db, cls, data['target_session_id'])
        session_in_class(db, cls, data['source_session_id'])
        require_assign_permission(db, cls, actor, target, member)
    def apply(cls, actor, data):
        _, participants = lock_context(db, cls)
        member = canonical_member(db, cls, data['member_id'])
        source = session_in_class(db, cls, data['source_session_id'])
        target = session_in_class(db, cls, data['target_session_id'])
        assignment, participant = reserve_locked(db, cls, member, source, target, participants, now)
        from app.services.class_attendance_service import participant_dto
        return {'assignment': assignment_dto(assignment), 'participant': participant_dto(db, participant)}
    return execute_member_command(db, actor_id, class_id, command, action='assign_makeup', target_id='makeup', authorize=authorize, apply=apply)


def cancel_makeup(db, actor_id, class_id, assignment_id, command, now=None):
    now = now or datetime.now(timezone.utc)
    assignment_id = UUID(str(assignment_id))
    def context(cls):
        assignment = db.query(ClassMakeupAssignment).filter_by(id=assignment_id, class_id=cls.id).first()
        if assignment is None:
            raise HTTPException(404, detail={'code': 'makeup_not_found'})
        return assignment
    def authorize(cls, actor, data):
        assignment = context(cls)
        member = canonical_member(db, cls, assignment.member_id)
        target = session_in_class(db, cls, assignment.target_session_id)
        require_assign_permission(db, cls, actor, target, member)
    def apply(cls, actor, data):
        _, participants = lock_context(db, cls)
        assignment = context(cls)
        target = session_in_class(db, cls, assignment.target_session_id)
        participant = next(p for p in participants if p.id == assignment.target_participant_id)
        if assignment.status != 'reserved' or participant.entered_at is not None or target.started_at is not None or target.status not in ('ready', 'scheduled', 'open', 'cancelled'):
            raise HTTPException(409, detail={'code': 'makeup_cancel_invalid'})
        assignment.status = 'cancelled'
        assignment.cancelled_at = now
        participant.entry_ver += 1
        from app.services.class_attendance_service import _change
        _change(db, cls, target, participant, 'withdrawn', actor.id, data['operation_key'], data.get('reason'), 'self' if participant.user_id == actor.id else 'host')
        db.flush()
        return {'assignment': assignment_dto(assignment)}
    return execute_member_command(db, actor_id, class_id, command, action='cancel_makeup', target_id=assignment_id, authorize=authorize, apply=apply)
