"""세션 관리 비즈니스 로직"""

import uuid
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import HTTPException, status
from livekit import api as livekit_api
from sqlalchemy.orm import Session as DBSession

from app.config import settings
from app.models.session import Session, SessionParticipant
from app.models.record import SessionRecord
from app.services import code_service


# SDD-015: 일정 없는 즉석 클래스는 "ready" 상태로 생성된다.
# 기존 예약형 세션의 "scheduled" 는 그대로 유지해 하위 호환을 지킨다.
ACTIVE_STATUSES = ("ready", "scheduled", "in_progress", "paused")

TRANSITIONS = {
    "start": ({"ready", "scheduled"}, "in_progress"),
    "pause": ({"in_progress"}, "paused"),
    "resume": ({"paused"}, "in_progress"),
    "end": ({"in_progress", "paused"}, "completed"),
    "cancel": ({"ready", "scheduled", "in_progress", "paused"}, "cancelled"),
}


def _to_uuid(value: str) -> UUID:
    try:
        return UUID(str(value))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="잘못된 ID 형식입니다")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _serialize(s: Session) -> dict:
    parts = list(s.participants or [])
    waitlist_count = sum(1 for p in parts if p.is_waitlisted)
    return {
        "id": str(s.id),
        "type": s.type,
        "custom_type_name": s.custom_type_name,
        "status": s.status,
        "host_id": str(s.host_id),
        "scheduled_at": s.scheduled_at,
        "access_code": s.access_code,
        "started_at": s.started_at,
        "ended_at": s.ended_at,
        "duration_min": s.duration_min,
        "title": s.title,
        "notes": s.notes,
        "max_participants": s.max_participants,
        "location_type": s.location_type,
        "participant_mode": s.participant_mode,
        "linkband_mode": s.linkband_mode,
        "webrtc_room_id": str(s.webrtc_room_id) if s.webrtc_room_id else None,
        "sfu_enabled": s.sfu_enabled,
        "created_at": s.created_at or _now(),
        "participants": [
            {
                # 게스트는 user_id가 없으므로 None으로 직렬화한다
                "user_id": str(p.user_id) if p.user_id else None,
                "guest_name": p.guest_name,
                "is_guest": p.user_id is None,
                "band_connected": p.band_connected,
                "linkband_device_id": p.linkband_device_id,
                "webrtc_peer_id": p.webrtc_peer_id,
                "consent_audio": p.consent_audio,
                "consent_eeg": p.consent_eeg,
                "is_waitlisted": p.is_waitlisted,
                "waitlist_position": p.waitlist_position,
            }
            for p in parts
        ],
        "waitlist_count": waitlist_count,
    }


_FALLBACK_SORT_TIME = datetime(1970, 1, 1, tzinfo=timezone.utc)


def _sort_key(s: Session) -> datetime:
    """목록 정렬 키 — scheduled_at 우선, 없으면 created_at, 둘 다 없으면 epoch."""
    for value in (s.scheduled_at, s.created_at):
        if value is not None:
            return _ensure_aware(value)
    return _FALLBACK_SORT_TIME


def generate_access_code(db: DBSession) -> str:
    """클래스 코드(6자리) 발급 — Session.access_code 에서 unique 보장."""
    return code_service.generate_unique_code(db, Session, "access_code", label="클래스 코드")


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
        # 일정 없는 즉석 클래스(scheduled_at=None)는 시간 충돌 판정 대상이 아니다
        if s.scheduled_at is None:
            continue
        s_start = _ensure_aware(s.scheduled_at)
        s_end = s_start + timedelta(minutes=s.duration_min)
        if s_start < new_end and scheduled_at < s_end:
            return s
    return None


def create_session(host_id: str, payload, db: DBSession) -> dict:
    host_uuid = _to_uuid(host_id)
    # SDD-015: scheduled_at 이 없으면 "즉석 클래스" — 과거 일시 검증·충돌 검사를 건너뛰고
    # status를 ready로 두어 상담사가 "시작"을 누를 때 진행중으로 전이한다.
    scheduled_at = _ensure_aware(payload.scheduled_at) if payload.scheduled_at else None
    initial_status = "scheduled" if scheduled_at else "ready"

    if scheduled_at is not None:
        if scheduled_at < _now() - timedelta(minutes=1):
            raise HTTPException(status_code=400, detail="과거 일시에는 세션을 생성할 수 없습니다")

        if not payload.force:
            conflict = detect_conflict(host_uuid, scheduled_at, payload.duration_min, None, db)
            if conflict:
                raise HTTPException(status_code=409, detail="시간이 겹치는 세션이 있습니다")

    # type=custom 일 때 custom_type_name 필수 (스키마에서도 검증하나 서비스 레벨 방어)
    if payload.type == "custom" and not (payload.custom_type_name and payload.custom_type_name.strip()):
        raise HTTPException(status_code=400, detail="기타 유형 선택 시 유형 이름을 입력해야 합니다")

    if payload.type == "meditation":
        max_p = payload.max_participants
    else:
        max_p = max(payload.max_participants, 1)

    if len(payload.participant_ids) > max_p:
        raise HTTPException(status_code=400, detail="참여자 수가 정원을 초과합니다")

    # 온라인 세션은 WebRTC 룸 ID 자동 생성
    webrtc_room_id = uuid.uuid4() if payload.location_type == "online" else None

    session = Session(
        type=payload.type,
        custom_type_name=payload.custom_type_name.strip() if (payload.type == "custom" and payload.custom_type_name) else None,
        status=initial_status,
        host_id=host_uuid,
        scheduled_at=scheduled_at,
        access_code=generate_access_code(db),
        duration_min=payload.duration_min,
        title=payload.title,
        notes=payload.notes,
        max_participants=max_p,
        location_type=payload.location_type,
        participant_mode=payload.participant_mode,
        linkband_mode=payload.linkband_mode,
        webrtc_room_id=webrtc_room_id,
        sfu_enabled=payload.sfu_enabled,
    )
    db.add(session)
    db.flush()

    for pid in payload.participant_ids:
        db.add(SessionParticipant(session_id=session.id, user_id=_to_uuid(pid)))

    db.commit()
    db.refresh(session)

    # 그룹 세션(참여자 2인 이상)이면 채팅방 자동 생성
    if len(payload.participant_ids) >= 2:
        from app.services import chat_service
        chat_service.get_or_create_room_by_session(session.id, db)

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
    # scheduled_at 이 없는 즉석 클래스는 created_at 으로 정렬한다
    result = sorted(seen.values(), key=_sort_key, reverse=True)
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

    _current_scheduled = _ensure_aware(s.scheduled_at) if s.scheduled_at else None
    new_scheduled_at = _ensure_aware(payload.scheduled_at) if payload.scheduled_at else _current_scheduled
    new_duration = payload.duration_min if payload.duration_min is not None else s.duration_min

    if not payload.force and new_scheduled_at is not None and (payload.scheduled_at or payload.duration_min):
        conflict = detect_conflict(s.host_id, new_scheduled_at, new_duration, s.id, db)
        if conflict:
            raise HTTPException(status_code=409, detail="시간이 겹치는 세션이 있습니다")

    # 유형 변경 검증: 최종 유형이 custom 이면 custom_type_name 필수
    new_type = payload.type if payload.type is not None else s.type
    new_custom_name = payload.custom_type_name if payload.custom_type_name is not None else s.custom_type_name
    if new_type == "custom" and not (new_custom_name and new_custom_name.strip()):
        raise HTTPException(status_code=400, detail="기타 유형 선택 시 유형 이름을 입력해야 합니다")

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
    if payload.type is not None:
        s.type = payload.type
    if payload.custom_type_name is not None:
        s.custom_type_name = payload.custom_type_name.strip() or None
    # 유형이 custom 이 아니게 되면 custom_type_name 정리
    if new_type != "custom":
        s.custom_type_name = None
    if payload.participant_mode is not None:
        s.participant_mode = payload.participant_mode
    if payload.linkband_mode is not None:
        s.linkband_mode = payload.linkband_mode
    if payload.sfu_enabled is not None:
        s.sfu_enabled = payload.sfu_enabled
    if payload.location_type is not None:
        s.location_type = payload.location_type
        # 온라인 전환 시 WebRTC 룸 자동 생성, 오프라인 전환 시 정리
        if payload.location_type == "online" and not s.webrtc_room_id:
            s.webrtc_room_id = uuid.uuid4()
        elif payload.location_type == "offline":
            s.webrtc_room_id = None

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

    # SDD-021: 1.0 "클래스 시작" 패리티 — 그룹 수업은 active 참가자(대기열 제외) 1명 이상이어야
    # 시작할 수 있다. 1:1 세션은 내담자가 암묵적으로 지정되므로 기존 상태전이 동작을 유지한다.
    if action == "start" and s.participant_mode == "group":
        active = [p for p in (s.participants or []) if not p.is_waitlisted]
        if len(active) < 1:
            raise HTTPException(
                status_code=400,
                detail="참가자가 1명 이상 있어야 클래스를 시작할 수 있습니다",
            )

    s.status = target
    # SDD-015: 실제 시작/종료 시각 기록 (재시작 시 최초 시작 시각은 보존)
    if action == "start" and s.started_at is None:
        s.started_at = _now()
    elif action == "end":
        s.ended_at = _now()
    db.commit()
    db.refresh(s)

    if action == "end":
        try:
            from app.services import audio_service
            audio_service.finalize_on_session_end(s.id, db)
        except Exception:
            pass

    return _serialize(s)


def _next_waitlist_position(s: Session) -> int:
    positions = [p.waitlist_position or 0 for p in (s.participants or []) if p.is_waitlisted]
    return (max(positions) + 1) if positions else 1


def _promote_waitlist(s: Session, db: DBSession) -> None:
    """정원에 여유가 생기면 대기열 1순위를 자동 승격"""
    active = [p for p in (s.participants or []) if not p.is_waitlisted]
    if len(active) >= s.max_participants:
        return
    waiting = sorted(
        [p for p in (s.participants or []) if p.is_waitlisted],
        key=lambda p: p.waitlist_position or 0,
    )
    if not waiting:
        return
    promoted = waiting[0]
    promoted.is_waitlisted = False
    promoted.waitlist_position = None
    for idx, p in enumerate(waiting[1:], start=1):
        p.waitlist_position = idx
    db.flush()


def invite_participant(session_id: str, host_id: str, user_id: str, db: DBSession) -> dict:
    s = _get_session_as_host(session_id, host_id, db)
    if s.status in ("completed", "cancelled"):
        raise HTTPException(status_code=400, detail="종료된 세션에는 초대할 수 없습니다")

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

    active = [p for p in (s.participants or []) if not p.is_waitlisted]
    if len(active) >= s.max_participants:
        position = _next_waitlist_position(s)
        db.add(SessionParticipant(
            session_id=s.id,
            user_id=target_uuid,
            is_waitlisted=True,
            waitlist_position=position,
        ))
    else:
        db.add(SessionParticipant(session_id=s.id, user_id=target_uuid))

    db.commit()
    db.refresh(s)
    return _serialize(s)


def remove_participant(session_id: str, host_id: str, user_id: str, db: DBSession) -> dict:
    s = _get_session_as_host(session_id, host_id, db)
    target_uuid = _to_uuid(user_id)
    participant = (
        db.query(SessionParticipant)
        .filter(
            SessionParticipant.session_id == s.id,
            SessionParticipant.user_id == target_uuid,
        )
        .first()
    )
    if not participant:
        raise HTTPException(status_code=404, detail="참여자를 찾을 수 없습니다")

    was_waitlisted = participant.is_waitlisted
    removed_position = participant.waitlist_position
    db.delete(participant)
    db.flush()
    db.refresh(s)

    if was_waitlisted and removed_position is not None:
        # 대기열에서 빠진 경우, 뒤 순번 당기기
        for p in (s.participants or []):
            if p.is_waitlisted and p.waitlist_position and p.waitlist_position > removed_position:
                p.waitlist_position -= 1
        db.flush()
    else:
        _promote_waitlist(s, db)

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


# ── LiveKit WebRTC ──────────────────────────────────────────────

def generate_livekit_token(room_name: str, participant_name: str, participant_id: str) -> str:
    """LiveKit 접근 토큰(JWT)을 발급합니다."""
    token = (
        livekit_api.AccessToken(settings.livekit_api_key, settings.livekit_api_secret)
        .with_identity(participant_id)
        .with_name(participant_name)
        .with_grants(
            livekit_api.VideoGrants(
                room_join=True,
                room=room_name,
            )
        )
    )
    return token.to_jwt()


def _get_session_for_participant(session_id: str, user_id: str, db: DBSession) -> Session:
    """host 또는 participant 권한으로 세션 조회"""
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


def join_session(session_id: str, user_id: str, user_name: str, db: DBSession) -> dict:
    """세션 참여자 입장 처리 — 상태 전이 + WebRTC 룸 ID 생성 + LiveKit 토큰 발급"""
    s = _get_session_for_participant(session_id, user_id, db)

    # 오프라인 세션은 입장 불가
    if s.location_type == "offline":
        raise HTTPException(status_code=400, detail="오프라인 세션은 입장할 수 없습니다")

    # webrtc_room_id가 없으면 생성
    if not s.webrtc_room_id:
        s.webrtc_room_id = uuid.uuid4()

    # 상태 전이: scheduled → in_progress (host만 가능)
    if s.status == "scheduled" and s.host_id == _to_uuid(user_id):
        s.status = "in_progress"
    elif s.status not in ("in_progress", "paused"):
        raise HTTPException(status_code=400, detail="현재 세션에 입장할 수 없는 상태입니다")

    db.commit()
    db.refresh(s)

    # LiveKit 토큰 발급
    room_name = str(s.webrtc_room_id)
    token = generate_livekit_token(room_name, user_name, user_id)

    result = _serialize(s)
    result["livekit_token"] = token
    return result


# ---------------------------------------------------------------------------
# SDD-015: 클래스 코드 기반 조회 · 참여
# ---------------------------------------------------------------------------

# 코드로 참여할 수 없는 상태 (이미 끝났거나 취소된 클래스)
_CLOSED_STATUSES = ("completed", "cancelled")


def _get_session_by_code(code: str, db: DBSession) -> Session:
    normalized = code_service.normalize_code(code)
    if len(normalized) != code_service.CODE_LENGTH:
        raise HTTPException(status_code=404, detail="클래스를 찾을 수 없습니다")
    s = db.query(Session).filter(Session.access_code == normalized).first()
    if not s:
        raise HTTPException(status_code=404, detail="클래스를 찾을 수 없습니다")
    return s


def get_session_by_code(code: str, db: DBSession) -> dict:
    """참여 전 클래스 정보 확인 — 인증 불필요, 민감 정보는 노출하지 않는다."""
    s = _get_session_by_code(code, db)
    host_name = None
    if s.host_id:
        from app.models.user import User

        host = db.query(User).filter(User.id == s.host_id).first()
        host_name = host.name if host else None
    return {
        "id": str(s.id),
        "access_code": s.access_code,
        "title": s.title,
        "type": s.type,
        "custom_type_name": s.custom_type_name,
        "status": s.status,
        "host_name": host_name,
        "participant_mode": s.participant_mode,
        "linkband_mode": s.linkband_mode,
        "location_type": s.location_type,
        # SDD-021: 대기열(waitlisted) 제외, active 참가자만 카운트한다
        "participant_count": sum(1 for p in (s.participants or []) if not p.is_waitlisted),
        "max_participants": s.max_participants,
        "started_at": s.started_at,
        "scheduled_at": s.scheduled_at,
    }


def join_session_by_code(
    code: str,
    db: DBSession,
    *,
    user_id: str | None = None,
    guest_name: str | None = None,
) -> dict:
    """클래스 코드로 참여.

    로그인 사용자 → SessionParticipant(user_id) 생성 (이미 있으면 재사용).
    게스트 → user_id=NULL + guest_name 으로 생성. 동일 이름 중복 참여는 허용한다.
    """
    s = _get_session_by_code(code, db)
    if s.status in _CLOSED_STATUSES:
        raise HTTPException(status_code=400, detail="이미 종료된 클래스입니다")

    if user_id:
        uid = _to_uuid(user_id)
        if s.host_id == uid:
            # host 상담사는 참여자로 중복 등록하지 않는다
            return {"session": _serialize(s), "participant_id": None, "is_guest": False}
        existing = (
            db.query(SessionParticipant)
            .filter(
                SessionParticipant.session_id == s.id,
                SessionParticipant.user_id == uid,
            )
            .first()
        )
        if existing is None:
            existing = SessionParticipant(session_id=s.id, user_id=uid)
            db.add(existing)
            db.commit()
        db.refresh(s)
        return {"session": _serialize(s), "participant_id": str(existing.id), "is_guest": False}

    name = (guest_name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="게스트 참여에는 이름이 필요합니다")

    participant = SessionParticipant(session_id=s.id, user_id=None, guest_name=name[:100])
    db.add(participant)
    db.commit()
    db.refresh(s)
    return {"session": _serialize(s), "participant_id": str(participant.id), "is_guest": True}


# ---------------------------------------------------------------------------
# SDD-021: 클래스 시작 프로세스 1.0 패리티
# ---------------------------------------------------------------------------


def _participant_log_state(status: str) -> str:
    """세션 상태에서 참가자 진행 상태(1.0 SessionLog 상태)를 파생한다.

    참가자 단위 상태 저장은 Phase 2 이므로, 현재는 세션 상태를 그대로 매핑한다.
    """
    if status == "completed":
        return "COMPLETED"
    if status in ("in_progress", "paused"):
        return "STARTED"
    return "READY"


def get_live_metrics(session_id: str, host_id: str, db: DBSession) -> dict:
    """호스트 전용 실시간 모니터링 데이터.

    뇌파 값(효율/배터리/접촉상태)은 이번 단계에서 null/placeholder 로 둔다.
    실제 EEG 연동(Web Bluetooth/Looxid SDK)은 Phase 2 에서 채운다.
    band_connected 는 기존 SessionParticipant 필드를 그대로 사용한다.
    """
    s = _get_session_as_host(session_id, host_id, db)
    # 모니터링 대상은 active 참가자만 (대기열 제외)
    active = [p for p in (s.participants or []) if not p.is_waitlisted]

    # 로그인 참가자 표시 이름을 한 번의 쿼리로 확보 (게스트는 guest_name 사용)
    from app.models.user import User

    user_ids = [p.user_id for p in active if p.user_id]
    names: dict = {}
    if user_ids:
        for u in db.query(User).filter(User.id.in_(user_ids)).all():
            names[u.id] = u.name

    log_state = _participant_log_state(s.status)

    metrics = []
    for p in active:
        display_name = names.get(p.user_id) if p.user_id else p.guest_name
        metrics.append(
            {
                "participant_id": str(p.id),
                "user_id": str(p.user_id) if p.user_id else None,
                "is_guest": p.user_id is None,
                "display_name": display_name or "익명",
                "seat_number": None,  # Phase 2: 좌석 배정
                "consent_eeg": p.consent_eeg,
                "session_log_state": log_state,
                "band_connected": p.band_connected,
                "device_status": "unknown",  # placeholder — 접촉 상태는 Phase 2 EEG 연동
                "band_battery": None,
                "avg_efficiency": None,
                "current_efficiency": None,
                "upload_status": "idle",
                "last_eeg_at": None,
            }
        )

    return {
        "session_id": str(s.id),
        "status": s.status,
        "access_code": s.access_code,
        "metrics": metrics,
        # DashboardBox 4종 집계 — 뇌파 placeholder 단계에서는 모두 0
        "summary": {
            "participant_count": len(metrics),
            "contact_fail_count": 0,
            "device_fail_count": 0,
            "band_low_count": 0,
        },
    }


def get_guest_session_state(
    code: str,
    db: DBSession,
    *,
    participant_id: str | None = None,
) -> dict:
    """게스트가 인증 없이 자기/세션 상태를 확인한다 (대기→명상 전이 감지용).

    민감한 참가자 목록은 노출하지 않고, 세션 상태와 본인 상태만 내려준다.
    """
    s = _get_session_by_code(code, db)

    participant_state = None
    if participant_id:
        try:
            pid = UUID(str(participant_id))
        except (TypeError, ValueError):
            pid = None
        if pid is not None:
            p = (
                db.query(SessionParticipant)
                .filter(
                    SessionParticipant.id == pid,
                    SessionParticipant.session_id == s.id,
                )
                .first()
            )
            if p is not None:
                participant_state = _participant_log_state(s.status)

    return {
        "session_id": str(s.id),
        "status": s.status,
        "in_progress": s.status == "in_progress",
        "ended": s.status in _CLOSED_STATUSES,
        "participant_state": participant_state,
    }
