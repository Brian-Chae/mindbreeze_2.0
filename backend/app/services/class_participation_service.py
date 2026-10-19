"""수업 참여 스냅샷과 DB 기반 소켓 lease. 잠금 순서는 공통 편성 엔진과 같다."""
from datetime import datetime, timedelta, timezone
from uuid import UUID
from fastapi import HTTPException
from app.models.session import Session, SessionParticipant
from app.models.record import SessionRecord
from app.models.class_program import ClassMember
from app.models.class_membership import SessionPresenceLease
from app.services.class_attendance_service import lock_participants

TTL_SECONDS = 90

def _now():
    return datetime.now(timezone.utc)

def lock_context(db, session_id, actor_id=None):
    row = db.get(Session, UUID(str(session_id)))
    if row is None:
        raise HTTPException(404, detail={'code':'session_not_found'})
    if row.class_id:
        from app.services.class_write_service import lock_class_session
        _, row = lock_class_session(db, row, actor_id)
    else:
        row = db.query(Session).filter_by(id=row.id).populate_existing().with_for_update().one()
    participants = lock_participants(db, row)
    return row, participants

def _expire(db, row, now):
    expired = db.query(SessionPresenceLease).filter(SessionPresenceLease.session_id == row.id, SessionPresenceLease.expires_at <= now).all()
    for lease in expired:
        db.delete(lease)
    if expired:
        row.participation_version = (row.participation_version or 0) + 1
    db.flush()

def build_snapshot(db, row, participants, now):
    """호출자가 회차·참가행 잠금을 가진 상태에서만 수집한다. 원문은 내보내지 않는다."""
    leases = db.query(SessionPresenceLease).filter(SessionPresenceLease.session_id == row.id, SessionPresenceLease.expires_at > now).all()
    record = db.query(SessionRecord).filter_by(session_id=row.id).first()
    state = record.subjective_state if record and isinstance(record.subjective_state, dict) else {}
    stored = state.get('participants') or {}
    result = []
    for p in participants:
        if p.is_waitlisted or p.superseded_by_participant_id or p.removed_at or p.waitlist_cancelled_at:
            continue
        member = db.get(ClassMember, p.member_id) if p.member_id else None
        before = (stored.get(str(p.id)) or {}).get('before')
        # 기존 NULL을 미작성으로 추정하지 않는다. 완료의 근거는 before 저장 내용이다.
        checkin = 'completed' if isinstance(before, dict) else ('not_completed' if p.checkin_state == 'not_completed' else 'unknown')
        expires = max((lease.expires_at for lease in leases if lease.participant_id == p.id), default=None)
        result.append({'participant_id':str(p.id), 'member_id':str(p.member_id) if p.member_id else None,
            'canonical_member_id':str(member.canonical_member_id or member.id) if member else None,
            'attendance_status':p.attendance_status, 'entered_at':p.entered_at.isoformat() if p.entered_at else None,
            'checkin_state':checkin, 'checkin_at':before.get('recorded_at') if isinstance(before, dict) else None,
            'presence_state':'connected' if expires else ('disconnected' if p.presence_seen_at else 'unknown'),
            'presence_expires_at':expires.isoformat() if expires else None})
    return {'session_id':str(row.id), 'participation_version':row.participation_version or 0,
        'generated_at':now.isoformat(), 'presence_ttl_seconds':TTL_SECONDS, 'participants':result}

def _authorize(db, row, user_id, credential=None, participant_id=None):
    if user_id:
        from app.models.user import User
        actor = db.get(User, UUID(str(user_id)))
        if actor is None or actor.status != 'active':
            raise HTTPException(403, detail={'code':'action_forbidden'})
    if user_id and str(row.host_id) == str(user_id):
        if row.class_id:
            from app.models.class_program import Class
            from app.services.class_instructor_service import validate_instructor
            validate_instructor(db, db.get(Class, row.class_id), UUID(str(user_id)), row.id)
        return None
    from app.services.session_service import resolve_participant_actor
    return resolve_participant_actor(row.id, db, current_user_id=user_id, entry_credential=credential, participant_id=participant_id)

def snapshot(db, class_id, session_id, user_id, *, entry_credential=None, member_credential=None, now=None):
    now = now or _now()
    try:
        row, participants = lock_context(db, session_id, user_id)
        if str(row.class_id) != str(class_id):
            raise HTTPException(404, detail={'code':'session_not_found'})
        if member_credential and not user_id:
            from app.services.class_guest_service import authenticate_guest, canonical_member_ids
            from app.services.class_attendance_service import require_eligible
            member, _ = authenticate_guest(db, class_id, member_credential, scope='activity', now=now)
            matches = [p for p in participants if p.member_id in canonical_member_ids(db, member) and not p.superseded_by_participant_id]
            if len(matches) != 1:
                raise HTTPException(403, detail={'code': 'action_forbidden'})
            own = matches[0]
            require_eligible(db, own, allow_excused=True)
        else:
            own = _authorize(db, row, user_id, entry_credential)
        _expire(db, row, now)
        result = build_snapshot(db, row, participants, now)
        if own is not None:
            result = {**result, 'participants':[p for p in result['participants'] if p['participant_id'] == str(own.id)]}
        db.commit()
        return result
    except Exception:
        db.rollback()
        raise

def socket_update(db, socket_id, context, action, *, now=None):
    """sid와 인증된 서버 문맥만 사용한다. 클라이언트 heartbeat 본문은 사용하지 않는다."""
    now = now or _now()
    try:
        row, participants = lock_context(db, context['session_id'], context.get('user_id'))
        _expire(db, row, now)
        if action == 'leave':
            lease = db.query(SessionPresenceLease).filter_by(id=socket_id, session_id=row.id).first()
            if lease:
                db.delete(lease)
                row.participation_version = (row.participation_version or 0) + 1
        else:
            if context.get('role') == 'observer':
                return None
            own = _authorize(db, row, context.get('user_id'), context.get('entry_credential'), context.get('participant_id'))
            if own is not None:
                from app.services.class_attendance_service import require_eligible
                require_eligible(db, own, allow_excused=False)
                lease = db.get(SessionPresenceLease, socket_id)
                if lease and (lease.session_id != row.id or lease.participant_id != own.id):
                    raise HTTPException(403, detail={'code':'action_forbidden'})
                if lease is None:
                    lease = SessionPresenceLease(id=socket_id, session_id=row.id, participant_id=own.id)
                    db.add(lease)
                lease.last_seen_at, lease.expires_at = now, now + timedelta(seconds=TTL_SECONDS)
                own.presence_seen_at = now
                row.participation_version = (row.participation_version or 0) + 1
        db.flush()
        result = build_snapshot(db, row, participants, now)
        db.commit()
        return result
    except Exception:
        db.rollback()
        raise

def expire_due(db, *, now=None):
    """모든 워커가 같은 DB lease를 정리한다. 회차 잠금으로 버전을 직렬화한다."""
    now = now or _now()
    ids = [r[0] for r in db.query(SessionPresenceLease.session_id).filter(SessionPresenceLease.expires_at <= now).distinct().all()]
    results = []
    for sid in sorted(ids, key=str):
        try:
            row, participants = lock_context(db, sid)
            _expire(db, row, now)
            results.append(build_snapshot(db, row, participants, now))
            db.commit()
        except Exception:
            db.rollback()
            raise
    return results
