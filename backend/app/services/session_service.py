"""세션 관리 비즈니스 로직"""

from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.orm import Session as DBSession

from app.models.session import Session, SessionParticipant
from app.models.record import SessionRecord


ACTIVE_STATUSES = ("scheduled", "in_progress", "paused")

TRANSITIONS = {
    "start": ({"scheduled"}, "in_progress"),
    "pause": ({"in_progress"}, "paused"),
    "resume": ({"paused"}, "in_progress"),
    "end": ({"in_progress", "paused"}, "completed"),
    "cancel": ({"scheduled", "in_progress", "paused"}, "cancelled"),
}


def _to_uuid(value: str) -> UUID:
    try:
        return UUID(str(value))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="잘못된 ID 형식입니다")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _serialize(s: Session) -> dict:
    return {
        "id": str(s.id),
        "type": s.type,
        "status": s.status,
        "host_id": str(s.host_id),
        "scheduled_at": s.scheduled_at,
        "duration_min": s.duration_min,
        "title": s.title,
        "notes": s.notes,
        "max_participants": s.max_participants,
        "created_at": s.created_at or _now(),
        "participants": [
            {
                "user_id": str(p.user_id),
                "band_connected": p.band_connected,
                "consent_audio": p.consent_audio,
                "consent_eeg": p.consent_eeg,
            }
            for p in (s.participants or [])
        ],
    }


def _ensure_aware(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def detect_conflict(
    host_id: UUID,
    scheduled_at: datetime,
    duration_min: int,
    exclude_id: UUID | None,
    db: DBSession,
) -> Session | None:
    """동일 host의 시간 겹침 세션 1건 반환 (없으면 None)"""
    scheduled_at = _ensure_aware(scheduled_at)
    new_end = scheduled_at + timedelta(minutes=duration_min)
    q = (
        db.query(Session)
        .filter(Session.host_id == host_id)
        .filter(Session.status.in_(ACTIVE_STATUSES))
    )
    if exclude_id is not None:
        q = q.filter(Session.id != exclude_id)
    for s in q.all():
        s_start = _ensure_aware(s.scheduled_at)
        s_end = s_start + timedelta(minutes=s.duration_min)
        if s_start < new_end and scheduled_at < s_end:
            return s
    return None


def create_session(host_id: str, payload, db: DBSession) -> dict:
    host_uuid = _to_uuid(host_id)
    scheduled_at = _ensure_aware(payload.scheduled_at)

    if scheduled_at < _now() - timedelta(minutes=1):
        raise HTTPException(status_code=400, detail="과거 일시에는 세션을 생성할 수 없습니다")

    if not payload.force:
        conflict = detect_conflict(host_uuid, scheduled_at, payload.duration_min, None, db)
        if conflict:
            raise HTTPException(status_code=409, detail="시간이 겹치는 세션이 있습니다")

    if payload.type == "meditation":
        max_p = payload.max_participants
    else:
        max_p = max(payload.max_participants, 1)

    if len(payload.participant_ids) > max_p:
        raise HTTPException(status_code=400, detail="참여자 수가 정원을 초과합니다")

    session = Session(
        type=payload.type,
        status="scheduled",
        host_id=host_uuid,
        scheduled_at=scheduled_at,
        duration_min=payload.duration_min,
        title=payload.title,
        notes=payload.notes,
        max_participants=max_p,
    )
    db.add(session)
    db.flush()

    for pid in payload.participant_ids:
        db.add(SessionParticipant(session_id=session.id, user_id=_to_uuid(pid)))

    db.commit()
    db.refresh(session)
    return _serialize(session)


def list_sessions(user_id: str, db: DBSession) -> tuple[list[dict], int]:
    uid = _to_uuid(user_id)
    hosted = db.query(Session).filter(Session.host_id == uid).all()
    participated_ids = [
        p.session_id for p in db.query(SessionParticipant).filter(SessionParticipant.user_id == uid).all()
    ]
    participated = (
        db.query(Session).filter(Session.id.in_(participated_ids)).all() if participated_ids else []
    )
    seen: dict[UUID, Session] = {s.id: s for s in hosted}
    for s in participated:
        seen.setdefault(s.id, s)
    result = sorted(seen.values(), key=lambda s: s.scheduled_at, reverse=True)
    return [_serialize(s) for s in result], len(result)


def _get_session_for_user(session_id: str, user_id: str, db: DBSession) -> Session:
    sid = _to_uuid(session_id)
    s = db.query(Session).filter(Session.id == sid).first()
    if not s:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")
    uid = _to_uuid(user_id)
    if s.host_id == uid:
        return s
    is_participant = (
        db.query(SessionParticipant)
        .filter(SessionParticipant.session_id == sid, SessionParticipant.user_id == uid)
        .first()
    )
    if is_participant:
        return s
    raise HTTPException(status_code=403, detail="접근 권한이 없습니다")


def _get_session_as_host(session_id: str, host_id: str, db: DBSession) -> Session:
    sid = _to_uuid(session_id)
    s = db.query(Session).filter(Session.id == sid).first()
    if not s:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")
    if s.host_id != _to_uuid(host_id):
        raise HTTPException(status_code=403, detail="host 상담사만 가능합니다")
    return s


def get_session(session_id: str, user_id: str, db: DBSession) -> dict:
    return _serialize(_get_session_for_user(session_id, user_id, db))


def update_session(session_id: str, host_id: str, payload, db: DBSession) -> dict:
    s = _get_session_as_host(session_id, host_id, db)
    if s.status in ("completed", "cancelled"):
        raise HTTPException(status_code=400, detail="종료된 세션은 수정할 수 없습니다")

    new_scheduled_at = _ensure_aware(payload.scheduled_at) if payload.scheduled_at else _ensure_aware(s.scheduled_at)
    new_duration = payload.duration_min if payload.duration_min is not None else s.duration_min

    if not payload.force and (payload.scheduled_at or payload.duration_min):
        conflict = detect_conflict(s.host_id, new_scheduled_at, new_duration, s.id, db)
        if conflict:
            raise HTTPException(status_code=409, detail="시간이 겹치는 세션이 있습니다")

    if payload.scheduled_at:
        s.scheduled_at = new_scheduled_at
    if payload.duration_min is not None:
        s.duration_min = new_duration
    if payload.title is not None:
        s.title = payload.title
    if payload.notes is not None:
        s.notes = payload.notes
    if payload.max_participants is not None:
        s.max_participants = payload.max_participants

    db.commit()
    db.refresh(s)
    return _serialize(s)


def delete_session(session_id: str, host_id: str, db: DBSession) -> None:
    s = _get_session_as_host(session_id, host_id, db)
    db.delete(s)
    db.commit()


def transition_status(session_id: str, host_id: str, action: str, db: DBSession) -> dict:
    if action not in TRANSITIONS:
        raise HTTPException(status_code=400, detail="알 수 없는 액션입니다")
    s = _get_session_as_host(session_id, host_id, db)
    allowed_from, target = TRANSITIONS[action]
    if s.status not in allowed_from:
        raise HTTPException(status_code=400, detail="잘못된 상태 전이입니다")
    s.status = target
    db.commit()
    db.refresh(s)
    return _serialize(s)


def invite_participant(session_id: str, host_id: str, user_id: str, db: DBSession) -> dict:
    s = _get_session_as_host(session_id, host_id, db)
    if s.status in ("completed", "cancelled"):
        raise HTTPException(status_code=400, detail="종료된 세션에는 초대할 수 없습니다")

    current = len(s.participants or [])
    if current >= s.max_participants:
        raise HTTPException(status_code=400, detail="참여자 정원을 초과했습니다")

    target_uuid = _to_uuid(user_id)
    existing = (
        db.query(SessionParticipant)
        .filter(
            SessionParticipant.session_id == s.id,
            SessionParticipant.user_id == target_uuid,
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="이미 초대된 참여자입니다")

    db.add(SessionParticipant(session_id=s.id, user_id=target_uuid))
    db.commit()
    db.refresh(s)
    return _serialize(s)


def add_marker(session_id: str, host_id: str, timestamp_sec: float, note: str, db: DBSession) -> dict:
    s = _get_session_as_host(session_id, host_id, db)
    if s.status not in ("in_progress", "paused"):
        raise HTTPException(status_code=400, detail="진행 중인 세션에서만 마커를 추가할 수 있습니다")

    record = db.query(SessionRecord).filter(SessionRecord.session_id == s.id).first()
    if not record:
        record = SessionRecord(session_id=s.id, markers=[])
        db.add(record)
        db.flush()

    markers = list(record.markers or [])
    markers.append({"timestamp_sec": timestamp_sec, "note": note, "created_at": _now().isoformat()})
    record.markers = markers
    db.commit()
    return {"markers": markers}
