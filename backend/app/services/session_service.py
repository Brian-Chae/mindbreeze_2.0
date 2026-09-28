"""세션 관리 비즈니스 로직"""

import uuid
from datetime import date, datetime, timedelta, timezone
from uuid import UUID

from fastapi import HTTPException, status
from livekit import api as livekit_api
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DBSession

from app.config import settings
from app.models.user import User
from app.models.session import Session, SessionParticipant
from app.models.record import SessionRecord
from app.models.eeg_feature import EEGFeatureWindow
from app.services import code_service, eeg_query, reminder_service as _reminder_service


# SDD-015: 일정 없는 즉석 클래스는 "ready" 상태로 생성된다.
# 기존 예약형 세션의 "scheduled" 는 그대로 유지해 하위 호환을 지킨다.
# SDD-088: "open"(오픈/대기)은 상담사가 준비를 마치고 회원 입장을 받는 상태 —
# 진행 중으로 간주해 중복 개설 방지·목록 필터에 포함한다.
ACTIVE_STATUSES = ("ready", "scheduled", "open", "in_progress", "paused")

# SDD-088: ready/scheduled → open(오픈/대기) → in_progress → completed.
# start 출발에 ready/scheduled 를 남기는 것은 과도기 하위 호환(구 클라이언트·1:1 즉석 세션).
# 오픈된 방의 정상 퇴로는 cancel(=클래스 닫기)이며, end 는 진행중/일시정지에서만 가능하다.
TRANSITIONS = {
    "open": ({"ready", "scheduled"}, "open"),
    "start": ({"ready", "scheduled", "open"}, "in_progress"),
    "pause": ({"in_progress"}, "paused"),
    "resume": ({"paused"}, "in_progress"),
    "end": ({"in_progress", "paused"}, "completed"),
    "cancel": ({"ready", "scheduled", "open", "in_progress", "paused"}, "cancelled"),
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
        # SDD-028: 실행 회차 식별자. 미설정(직접 생성 등) 시 session_id 를 회차로 간주한다.
        "run_id": str(s.run_id) if s.run_id else str(s.id),
        "type": s.type,
        "custom_type_name": s.custom_type_name,
        "status": s.status,
        "host_id": str(s.host_id),
        "scheduled_at": s.scheduled_at,
        "access_code": s.access_code,
        "opened_at": s.opened_at,
        "started_at": s.started_at,
        "ended_at": s.ended_at,
        "duration_min": s.duration_min,
        "title": s.title,
        "notes": s.notes,
        # 진행 큐시트(타임라인 대본) — 미작성(마이그레이션 이전 행)은 빈 배열로 내린다.
        "cuesheet": s.cuesheet or [],
        "max_participants": s.max_participants,
        "location_type": s.location_type,
        "participant_mode": s.participant_mode,
        "linkband_mode": s.linkband_mode,
        "webrtc_room_id": str(s.webrtc_room_id) if s.webrtc_room_id else None,
        "sfu_enabled": s.sfu_enabled,
        "record_audio": s.record_audio,
        "record_video": s.record_video,
        # 클래스 실시간 채팅 사용 여부(회원/상담사 UI 게이트용)
        "chat_enabled": s.chat_enabled,
        # SDD-095: 클래스 템플릿 여부 — 프론트가 "템플릿에서 시작·복제" UI 를 게이트한다
        "is_template": bool(s.is_template),
        # SDD-097: 예약 사전 안내(리마인더) 시점 목록 — 회원 홈 카드/상담사 폼 표시용
        "reminder_offsets": list(s.reminder_offsets or []),
        "created_at": s.created_at or _now(),
        "participants": [
            {
                # SDD-094: 참가자 공통 식별자(게스트 포함) — 상담사 UI 상태 매핑용
                "participant_id": str(p.id),
                # 게스트는 user_id가 없으므로 None으로 직렬화한다
                "user_id": str(p.user_id) if p.user_id else None,
                "guest_name": p.guest_name,
                "gender": p.gender,
                "birth_date": p.birth_date,
                "is_guest": p.user_id is None,
                "band_connected": p.band_connected,
                "linkband_device_id": p.linkband_device_id,
                "webrtc_peer_id": p.webrtc_peer_id,
                "consent_audio": p.consent_audio,
                "consent_eeg": p.consent_eeg,
                "is_waitlisted": p.is_waitlisted,
                "waitlist_position": p.waitlist_position,
                # SDD-094: 발언권 관리 상태(상담사 UI 손들기 표시/부여 버튼용)
                "raise_hand": p.raise_hand,
                "speaking": p.speaking,
            }
            for p in parts
        ],
        "waitlist_count": waitlist_count,
    }


_FALLBACK_SORT_TIME = datetime(1970, 1, 1, tzinfo=timezone.utc)


def _with_chat_room(data: dict, session_id: UUID, db: DBSession) -> dict:
    """단건 세션 응답에 chat_room_id 를 덧붙인다(목록 경로는 N+1 방지를 위해 제외)."""
    from app.services import chat_service

    room = chat_service.get_room_by_session(session_id, db)
    data["chat_room_id"] = str(room.id) if room else None
    return data


def ensure_session_chat_room(session_id: UUID, db: DBSession):
    """세션 채팅방 멱등 개설 — 클래스 생성/오픈 시 호출한다(기존 방이 있으면 그대로 사용)."""
    from app.services import chat_service

    return chat_service.get_or_create_room_by_session(session_id, db)


def set_chat_enabled(session_id: str, host_id: str, enabled: bool, db: DBSession) -> dict:
    """클래스 실시간 채팅 켜기/끄기 — host(상담사) 전용.

    토글 시 세션 채팅방을 멱등 개설해 방이 없는 세션에서도 즉시 room_id 를 얻을 수 있다.
    """
    s = _get_session_as_host(session_id, host_id, db)
    room = ensure_session_chat_room(s.id, db)
    s.chat_enabled = bool(enabled)
    db.commit()
    db.refresh(s)
    return {
        "session_id": str(s.id),
        "chat_enabled": s.chat_enabled,
        "room_id": str(room.id),
        "room_type": room.room_type,
    }


def get_session_chat_room(session_id: str, user_id: str, db: DBSession) -> dict:
    """세션 채팅방 조회 — host 또는 참여자(비참여자 403).

    아직 방이 없는 세션(마이그레이션 이전 생성)은 host 조회 시에만 멱등 개설한다.
    """
    s = _get_session_for_user(session_id, user_id, db)
    from app.services import chat_service

    room = chat_service.get_room_by_session(s.id, db)
    if room is None and s.host_id == _to_uuid(user_id):
        room = chat_service.get_or_create_room_by_session(s.id, db)
    return {
        "session_id": str(s.id),
        "chat_enabled": bool(s.chat_enabled),
        "room_id": str(room.id) if room else None,
        "room_type": room.room_type if room else "session",
    }


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


def _cuesheet_steps(payload) -> list[dict]:
    """생성/수정 payload 의 큐시트 단계를 JSONB 저장용 dict 목록으로 바꾼다.

    CuesheetStep.model_dump() 로 라벨·목표시간(분)·메모만 남긴다(미작성 시 빈 목록).
    """
    steps = getattr(payload, "cuesheet", None) or []
    return [step.model_dump() for step in steps]


def _copy_cuesheet(value: list | None) -> list[dict]:
    """복제/템플릿 저장 시 큐시트 단계를 원본과 분리된 dict 사본으로 옮긴다.

    JSONB 값은 dict 참조를 공유하면 한쪽 수정이 다른 행에 새어나갈 수 있으므로
    단계마다 얕은 복사본을 만든다(중첩 없는 평면 구조).
    """
    return [dict(step) for step in (value or [])]


def normalize_reminder_offsets(value) -> list[int]:
    """SDD-097: 리마인더 시점 정규화 — reminder_service 규칙 재사용(단일 진실)."""
    return _reminder_service.normalize_reminder_offsets(value)


def create_session(host_id: str, payload, db: DBSession) -> dict:
    host_uuid = _to_uuid(host_id)
    from app.services.org_management_service import require_active_user_org
    host = db.get(User, host_uuid)
    if host is None:
        raise HTTPException(404, "사용자를 찾을 수 없습니다")
    org = require_active_user_org(host, db)
    # SDD-095: 클래스 템플릿 저장 — 반복 클래스를 빠르게 다시 만들기 위한 "유형 설정 저장본".
    # 일정·참여자·참여코드·WebRTC 룸·채팅방 없이 ready 상태로만 저장하고 알림도 발화하지 않는다.
    if bool(getattr(payload, "is_template", False)):
        return _create_template(host_uuid, org, payload, db)
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

    # 회원 클라이언트 라이브 스트리밍을 위해 모든 세션에 WebRTC 룸을 생성한다
    # (기존: location_type='online' 만. 상담사 영상·음성 라이브 송출은 장소유형과 무관)
    webrtc_room_id = uuid.uuid4()

    session = Session(
        type=payload.type,
        custom_type_name=payload.custom_type_name.strip() if (payload.type == "custom" and payload.custom_type_name) else None,
        status=initial_status,
        host_id=host_uuid,
        organization_id=org.id if org else None,
        organization_attribution_known=True,
        scheduled_at=scheduled_at,
        access_code=generate_access_code(db),
        duration_min=payload.duration_min,
        title=payload.title,
        notes=payload.notes,
        cuesheet=_cuesheet_steps(payload),
        # SDD-097: 예약 클래스 사전 안내(리마인더) 시점 — 시작 N분 전 정수 목록.
        reminder_offsets=normalize_reminder_offsets(getattr(payload, "reminder_offsets", None)),
        max_participants=max_p,
        location_type=payload.location_type,
        participant_mode=payload.participant_mode,
        linkband_mode=payload.linkband_mode,
        webrtc_room_id=webrtc_room_id,
        sfu_enabled=payload.sfu_enabled,
        record_audio=payload.record_audio,
        record_video=payload.record_video,
    )
    db.add(session)
    db.flush()

    # SDD-028: 기본 run_id = session_id. 최초 실행의 회차 식별자로 자기 id 를 채운다.
    # 이후 "새 실행(명시적)"은 start_new_run 이 새 run_id 를 발급하고, pause/resume·이어하기는
    # 기존 run_id 를 유지한다.
    session.run_id = session.id

    for pid in payload.participant_ids:
        db.add(SessionParticipant(session_id=session.id, user_id=_to_uuid(pid)))

    db.commit()
    db.refresh(session)

    # 클래스 실시간 채팅방(room_type="session") 자동 개설 — 1:1/그룹 모두.
    # 이전에는 그룹(참여자 2인 이상)만 개설했으나, 클래스 채팅은 방을 미리 개설해 두고
    # Session.chat_enabled 로 발신 여부를 제어한다(개설은 멱등).
    ensure_session_chat_room(session.id, db)

    # SDD-093: S01(예약)/S04(즉석 클래스 ready) 알림 발화
    event_type = "session_booked" if initial_status == "scheduled" else "session_ready"
    _notify_participants_event(
        session,
        event_type,
        db,
        recipient_ids=[_to_uuid(pid) for pid in payload.participant_ids],
        include_waitlisted=True,
        title="새 세션 예약" if initial_status == "scheduled" else "새 세션이 열렸습니다",
        body=session.title or "세션",
    )

    # SDD-097: 예약 클래스면 리마인더를 ETA 태스크로 예약한다(끔이면 아무것도 안 함).
    if scheduled_at is not None:
        _reminder_service.schedule_session_reminders(session, db)

    return _with_chat_room(_serialize(session), session.id, db)


# ---------------------------------------------------------------------------
# SDD-095: 클래스 템플릿 · 복제
# ---------------------------------------------------------------------------

# 복제/템플릿 저장 시 옮기는 "유형 설정" 필드.
# 일정(scheduled_at)·상태(status)·참여코드(access_code)·WebRTC 룸·run_id·참여자 명단은
# 복사하지 않는다 — 복제본은 항상 새 클래스로 신규 발급/초기화한다.
_COPYABLE_CONFIG_FIELDS = (
    "type",
    "custom_type_name",
    "duration_min",
    "max_participants",
    "location_type",
    "participant_mode",
    "linkband_mode",
    "sfu_enabled",
    "record_audio",
    "record_video",
    "chat_enabled",
    # SDD-097: 리마인더 시점도 유형 설정으로 함께 복사/템플릿화한다(일정만 새로 정한다).
    "reminder_offsets",
)


def _normalized_max_participants(session_type: str, max_participants: int) -> int:
    """유형별 정원 정규화 — 명상(그룹)은 입력값, 그 외는 최소 1명."""
    if session_type == "meditation":
        return max_participants
    return max(max_participants, 1)


def _create_template(host_uuid: UUID, org, payload, db: DBSession) -> dict:
    """클래스 템플릿 행 생성 — 실제 진행 대상이 아니므로 코드/룸/채팅방/알림이 없다."""
    if payload.type == "custom" and not (payload.custom_type_name and payload.custom_type_name.strip()):
        raise HTTPException(status_code=400, detail="기타 유형 선택 시 유형 이름을 입력해야 합니다")

    template = Session(
        type=payload.type,
        custom_type_name=(
            payload.custom_type_name.strip()
            if (payload.type == "custom" and payload.custom_type_name)
            else None
        ),
        status="ready",
        host_id=host_uuid,
        organization_id=org.id if org else None,
        organization_attribution_known=True,
        scheduled_at=None,
        access_code=None,
        duration_min=payload.duration_min,
        title=payload.title,
        notes=payload.notes,
        cuesheet=_cuesheet_steps(payload),
        reminder_offsets=normalize_reminder_offsets(getattr(payload, "reminder_offsets", None)),
        max_participants=_normalized_max_participants(payload.type, payload.max_participants),
        location_type=payload.location_type,
        participant_mode=payload.participant_mode,
        linkband_mode=payload.linkband_mode,
        webrtc_room_id=None,
        sfu_enabled=payload.sfu_enabled,
        record_audio=payload.record_audio,
        record_video=payload.record_video,
        is_template=True,
    )
    db.add(template)
    db.flush()
    # SDD-028 정합: run_id 기본값 = 자기 id (템플릿은 실행되지 않으므로 그대로 유지)
    template.run_id = template.id
    db.commit()
    db.refresh(template)
    return _serialize(template)


def _clone_session_config(
    source: Session,
    *,
    host_uuid: UUID,
    organization_id: UUID | None,
    is_template: bool,
    title: str | None,
    scheduled_at: datetime | None,
    db: DBSession,
) -> Session:
    """원본 클래스의 '유형 설정'만 복사해 새 Session 행을 만든다(commit 은 호출측 책임).

    - 유형 설정(type/정원/진행형태/LINK BAND/녹화·채팅 설정/안내문)은 그대로 옮긴다.
    - 일정·상태·참여코드·WebRTC 룸·run_id 는 신규 발급/초기화한다.
    - 참여자 명단은 복사하지 않는다(복제본은 빈 클래스로 시작).
    """
    config = {field: getattr(source, field) for field in _COPYABLE_CONFIG_FIELDS}
    if is_template:
        # 템플릿은 일정도 코드도 갖지 않는다 — 항상 ready.
        initial_status = "ready"
        clone_scheduled_at = None
    else:
        clone_scheduled_at = _ensure_aware(scheduled_at) if scheduled_at else None
        # SDD-015 정합: 일정이 없으면 "즉석 클래스"(ready), 있으면 예약(scheduled).
        initial_status = "scheduled" if clone_scheduled_at else "ready"

    clone = Session(
        **config,
        status=initial_status,
        host_id=host_uuid,
        organization_id=organization_id,
        organization_attribution_known=True,
        scheduled_at=clone_scheduled_at,
        access_code=None if is_template else generate_access_code(db),
        title=title,
        notes=source.notes,
        cuesheet=_copy_cuesheet(source.cuesheet),
        webrtc_room_id=None if is_template else uuid.uuid4(),
        is_template=is_template,
    )
    db.add(clone)
    db.flush()
    # SDD-028: 복제본도 새 실행 회차 — run_id = 자기 id.
    clone.run_id = clone.id
    return clone


def duplicate_session(
    session_id: str,
    host_id: str,
    db: DBSession,
    *,
    scheduled_at: datetime | None = None,
    title: str | None = None,
    force: bool = False,
) -> dict:
    """SDD-095: 클래스 복제 — 유형 설정만 복사해 새 클래스를 만든다.

    - 복사: 유형/커스텀 유형명/소요 시간/정원/진행 형태/LINK BAND/녹화·채팅 설정/제목·안내문
    - 신규 발급: 참여코드, run_id, WebRTC 룸, 상태(예정)
    - 제외: 참여자 명단, EEG·기록·리포트, 일정(요청 시 새 일정으로 덮어쓰기)
    - 원본이 템플릿(is_template=True)이더라도 결과물은 항상 실제 클래스(is_template=False)다.
    호스트 상담사만 호출할 수 있다.
    """
    source = _get_session_as_host(session_id, host_id, db)
    host_uuid = _to_uuid(host_id)
    host = db.get(User, host_uuid)
    if host is None:
        raise HTTPException(404, "사용자를 찾을 수 없습니다")
    from app.services.org_management_service import require_active_user_org

    org = require_active_user_org(host, db)

    new_scheduled_at = _ensure_aware(scheduled_at) if scheduled_at else None
    if new_scheduled_at is not None:
        if new_scheduled_at < _now() - timedelta(minutes=1):
            raise HTTPException(status_code=400, detail="과거 일시에는 세션을 생성할 수 없습니다")
        if not force:
            conflict = detect_conflict(host_uuid, new_scheduled_at, source.duration_min, None, db)
            if conflict:
                raise HTTPException(status_code=409, detail="시간이 겹치는 세션이 있습니다")

    clone = _clone_session_config(
        source,
        host_uuid=host_uuid,
        organization_id=org.id if org else None,
        is_template=False,
        title=title if title is not None else source.title,
        scheduled_at=new_scheduled_at,
        db=db,
    )
    db.commit()
    db.refresh(clone)

    # 복제본도 실제 클래스이므로 채팅방을 개설한다(생성 경로와 동일한 멱등 개설).
    ensure_session_chat_room(clone.id, db)
    # SDD-097: 복제본에 새 일정이 있으면 리마인더도 새 일정 기준으로 예약한다.
    if new_scheduled_at is not None:
        _reminder_service.schedule_session_reminders(clone, db)
    return _with_chat_room(_serialize(clone), clone.id, db)


def save_as_template(
    session_id: str,
    host_id: str,
    db: DBSession,
    *,
    title: str | None = None,
) -> dict:
    """SDD-095: 기존 클래스의 유형 설정을 재사용 가능한 템플릿으로 저장한다(복제 + is_template)."""
    source = _get_session_as_host(session_id, host_id, db)
    host_uuid = _to_uuid(host_id)
    host = db.get(User, host_uuid)
    if host is None:
        raise HTTPException(404, "사용자를 찾을 수 없습니다")
    from app.services.org_management_service import require_active_user_org

    org = require_active_user_org(host, db)

    template = _clone_session_config(
        source,
        host_uuid=host_uuid,
        organization_id=org.id if org else None,
        is_template=True,
        title=(title or source.title),
        scheduled_at=None,
        db=db,
    )
    db.commit()
    db.refresh(template)
    return _serialize(template)


def list_templates(user_id: str, db: DBSession) -> tuple[list[dict], int]:
    """호스트가 저장한 클래스 템플릿 목록 (최신순) — 생성 폼의 '내 템플릿에서 시작' 용."""
    uid = _to_uuid(user_id)
    rows = (
        db.query(Session)
        .filter(Session.host_id == uid, Session.is_template.is_(True))
        .all()
    )
    result = sorted(rows, key=_sort_key, reverse=True)
    return [_serialize(s) for s in result], len(result)


def list_sessions(user_id: str, db: DBSession) -> tuple[list[dict], int]:
    """내 클래스 목록 — 템플릿(is_template=True)은 제외한다(별도 /sessions/templates)."""
    uid = _to_uuid(user_id)
    hosted = (
        db.query(Session)
        .filter(Session.host_id == uid, Session.is_template.is_(False))
        .all()
    )
    participated_ids = [
        p.session_id for p in db.query(SessionParticipant).filter(SessionParticipant.user_id == uid).all()
    ]
    participated = (
        db.query(Session)
        .filter(Session.id.in_(participated_ids), Session.is_template.is_(False))
        .all()
        if participated_ids
        else []
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
    from app.services.org_management_service import require_active_org, require_active_user_org
    host = db.get(User, s.host_id)
    if host:
        require_active_user_org(host, db)
    if s.organization_id:
        require_active_org(s.organization_id, db)
    return s


def get_session(session_id: str, user_id: str, db: DBSession) -> dict:
    s = _get_session_for_user(session_id, user_id, db)
    return _with_chat_room(_serialize(s), s.id, db)


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
    # 진행 큐시트 — 주어졌을 때만 통째 교체(빈 배열이면 큐시트 삭제).
    if payload.cuesheet is not None:
        s.cuesheet = _cuesheet_steps(payload)
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
    if payload.record_audio is not None:
        s.record_audio = payload.record_audio
    if payload.record_video is not None:
        s.record_video = payload.record_video
    # 클래스 실시간 채팅 on/off (SDD-… 클래스 채팅) — host 만 변경 가능(이 경로 자체가 host 전용)
    if payload.chat_enabled is not None:
        s.chat_enabled = bool(payload.chat_enabled)
    if payload.location_type is not None:
        s.location_type = payload.location_type
        # 회원 라이브 스트리밍은 장소유형과 무관 — 룸이 없으면 항상 생성 (오프라인 전환 시에도 유지)
        if not s.webrtc_room_id:
            s.webrtc_room_id = uuid.uuid4()

    # SDD-097: 리마인더 시점 재설정 — 주어졌을 때만 교체.
    reminders_changed = False
    if getattr(payload, "reminder_offsets", None) is not None:
        s.reminder_offsets = normalize_reminder_offsets(payload.reminder_offsets)
        reminders_changed = True

    db.commit()
    db.refresh(s)

    # SDD-097: 일정 또는 리마인더 시점이 바뀌면 ETA 태스크를 다시 예약한다.
    # (이미 지난 시점은 예약되지 않고, 발송 로그가 중복 발송을 막는다.)
    if reminders_changed or payload.scheduled_at is not None:
        _reminder_service.schedule_session_reminders(s, db)

    # SDD-093: S02 세션 변경 알림
    _notify_participants_event(
        s, "session_updated", db,
        title="세션 정보가 변경되었습니다",
        body=s.title or "세션",
    )

    return _with_chat_room(_serialize(s), s.id, db)


def delete_session(session_id: str, host_id: str, db: DBSession) -> None:
    s = _get_session_as_host(session_id, host_id, db)
    # SDD-093: S13 세션 삭제 알림 (삭제 전 발화 — participants 접근 필요)
    _notify_participants_event(
        s, "session_deleted", db,
        include_waitlisted=True,
        title="세션이 취소되었습니다",
        body=s.title or "세션",
    )
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
    # SDD-088: 오픈 시각도 최초 1회만 기록 (대기 경과 표시·오픈→시작 지표용)
    if action == "open" and s.opened_at is None:
        s.opened_at = _now()
    elif action == "start" and s.started_at is None:
        s.started_at = _now()
    elif action == "end":
        s.ended_at = _now()
    # SDD-026: 상태 계약 버전 증가 — 클라이언트의 중복/역순 이벤트 판정 기준
    s.state_version = (s.state_version or 0) + 1
    db.commit()
    db.refresh(s)

    # 클래스 오픈 시점에 세션 채팅방을 보장한다(생성 시 개설이 기본 — 기존 세션 대상 멱등 보완).
    # 입장한 회원이 곧바로 room_id 를 받아 채팅에 참여할 수 있게 한다.
    if action == "open":
        ensure_session_chat_room(s.id, db)

    if action == "end":
        try:
            from app.services import audio_service
            audio_service.finalize_on_session_end(s.id, db)
        except Exception:
            pass
        # SDD-084: 영상 녹화도 세션 종료 시 자동 종료 (audio finalize 실패와 무관하게 시도)
        try:
            from app.services import video_service
            video_service.finalize_on_session_end(s.id, db)
        except Exception:
            pass
        # SDD-086: 세션 종료 시 리포트 자동 생성 — counselor 1건 + participant별 client.
        # 리포트 생성은 audio_service.finalize_on_session_end 의 Celery chain(STT→요약→리포트)에서
        # 비동기 처리된다. 여기서는 동기 생성하지 않아 세션 종료 API 응답을 지연시키지 않는다.

    # SDD-026: 상태전이는 session_state_changed 이벤트로 발행(commit 후, best-effort)
    _notify_session_state(s)

    # SDD-093: S03/S05~S09 상태 전이 알림 발화 (대기열은 시작/일시정지/재개/종료 제외)
    _action_event = {
        "open": "session_opened",
        "start": "session_started",
        "pause": "session_paused",
        "resume": "session_resumed",
        "end": "session_completed",
        "cancel": "session_cancelled",
    }
    _action_title = {
        "open": "세션이 오픈되었습니다",
        "start": "세션이 시작되었습니다",
        "pause": "세션이 일시정지되었습니다",
        "resume": "세션이 재개되었습니다",
        "end": "세션이 종료되었습니다",
        "cancel": "세션이 취소되었습니다",
    }
    event_type = _action_event.get(action)
    if event_type:
        _notify_participants_event(
            s, event_type, db,
            include_waitlisted=(action == "cancel"),
            title=_action_title.get(action, event_type),
            body=s.title or "세션",
        )

    return _with_chat_room(_serialize(s), s.id, db)


# 새 실행(명시적)을 발급할 수 없는 상태 — 완료/취소된 세션은 즉시 재시작을 허용하지 않는다.
_NON_RESTARTABLE_STATUSES = ("completed", "cancelled")


def start_new_run(session_id: str, host_id: str, db: DBSession) -> dict:
    """같은 수업 정의를 "새 실행(명시적)"으로 열어 새 run_id 를 발급한다.

    SDD-028 경량 SessionRun:
      - run_id 만 새 값으로 교체한다(EEG/리포트는 session_id 기반이라 데이터 마이그레이션 없음).
      - completed/cancelled 세션은 즉시 재시작을 허용하지 않는다(기존 상태 규칙 유지) → 400.
        (재수업이 필요하면 새 세션을 생성한다.)
      - pause/resume·이어하기는 이 함수를 호출하지 않으므로 기존 run_id 가 그대로 유지된다.
    호스트 상담사만 호출할 수 있다.
    """
    s = _get_session_as_host(session_id, host_id, db)
    if s.status in _NON_RESTARTABLE_STATUSES:
        raise HTTPException(
            status_code=400,
            detail="완료·취소된 세션은 즉시 재시작할 수 없습니다. 새 세션을 생성하세요",
        )
    s.run_id = uuid.uuid4()
    db.commit()
    db.refresh(s)
    return _serialize(s)


def _notify_participants_event(
    s: Session,
    event_type: str,
    db: DBSession,
    *,
    recipient_ids: list | None = None,
    include_waitlisted: bool = False,
    title: str,
    body: str | None = None,
) -> None:
    """세션 참여자에게 인앱 알림을 best-effort 로 발화한다.

    SDD-093 노티피케이션 재설계 — 이벤트 카탈로그(33종)의 세션 이벤트 발화 일원화.
    수신자 기본값: 호스트 제외 + (include_waitlisted=False 시) 대기열 제외.
    """
    try:
        from app.services import notification_service
        from app.services.notification_service import build_standard_extra, EVENT_CATALOG

        target_type = EVENT_CATALOG.get(event_type, {}).get("target_type", "session")
        if recipient_ids is None:
            recipient_ids = [
                p.user_id for p in (s.participants or [])
                if (include_waitlisted or not p.is_waitlisted) and p.user_id != s.host_id
            ]
        for uid in recipient_ids:
            try:
                notification_service.notify_event(
                    event_type,
                    uid,
                    {
                        "title": title,
                        "body": body,
                        "extra": build_standard_extra(
                            event_type,
                            target_type,
                            str(s.id),
                            params=None,
                            legacy={"session_id": str(s.id)},
                        ),
                    },
                    db,
                )
            except Exception:
                pass
    except Exception:
        pass


def _notify_session_state(s: Session) -> None:
    """session_state_changed 이벤트를 best-effort 로 발행한다(WS 루프 없으면 no-op)."""
    try:
        from app.ws import session_live_namespace as live

        live.notify_session_state_changed(
            str(s.id),
            {
                "status": s.status,
                "version": s.state_version or 0,
                "started_at": s.started_at.isoformat() if s.started_at else None,
                "ended_at": s.ended_at.isoformat() if s.ended_at else None,
            },
        )
    except Exception:
        pass


def _notify_participant_changed(s: Session) -> None:
    """participant_changed 이벤트를 best-effort 로 발행한다(호스트 룸 전용)."""
    try:
        from app.ws import session_live_namespace as live

        active = [p for p in (s.participants or []) if not p.is_waitlisted]
        live.notify_participant_changed(
            str(s.id),
            {
                "version": s.state_version or 0,
                "participant_count": len(active),
                "waitlist_count": sum(1 for p in (s.participants or []) if p.is_waitlisted),
            },
        )
    except Exception:
        pass


def _next_waitlist_position(s: Session) -> int:
    positions = [p.waitlist_position or 0 for p in (s.participants or []) if p.is_waitlisted]
    return (max(positions) + 1) if positions else 1


def _promote_waitlist(s: Session, db: DBSession) -> UUID | None:
    """정원에 여유가 생기면 대기열 1순위를 자동 승격. 승격된 사용자 ID를 반환한다."""
    active = [p for p in (s.participants or []) if not p.is_waitlisted]
    if len(active) >= s.max_participants:
        return None
    waiting = sorted(
        [p for p in (s.participants or []) if p.is_waitlisted],
        key=lambda p: p.waitlist_position or 0,
    )
    if not waiting:
        return None
    promoted = waiting[0]
    promoted.is_waitlisted = False
    promoted.waitlist_position = None
    for idx, p in enumerate(waiting[1:], start=1):
        p.waitlist_position = idx
    db.flush()
    return promoted.user_id


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

    # SDD-093: S10 세션 초대 알림
    _notify_participants_event(
        s, "session_invited", db,
        recipient_ids=[target_uuid],
        include_waitlisted=True,
        title="세션에 초대되었습니다",
        body=s.title or "세션",
    )

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

    promoted_id: UUID | None = None
    if was_waitlisted and removed_position is not None:
        # 대기열에서 빠진 경우, 뒤 순번 당기기
        for p in (s.participants or []):
            if p.is_waitlisted and p.waitlist_position and p.waitlist_position > removed_position:
                p.waitlist_position -= 1
        db.flush()
    else:
        promoted_id = _promote_waitlist(s, db)

    db.commit()
    db.refresh(s)

    # SDD-093: S12 제거 알림
    _notify_participants_event(
        s, "session_participant_removed", db,
        recipient_ids=[target_uuid],
        include_waitlisted=True,
        title="세션에서 제외되었습니다",
        body=s.title or "세션",
    )
    # SDD-093: S11 대기열 승격 알림
    if promoted_id:
        _notify_participants_event(
            s, "session_waitlist_promoted", db,
            recipient_ids=[promoted_id],
            title="대기열에서 참여자로 승격되었습니다",
            body=s.title or "세션",
        )

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

def generate_livekit_token(
    room_name: str,
    participant_name: str,
    participant_id: str,
    *,
    can_publish: bool = True,
    can_subscribe: bool = True,
) -> str:
    """LiveKit 접근 토큰(JWT)을 발급합니다.

    can_publish=False 면 구독 전용 토큰(회원/게스트) — 상담사 영상·음성만 수신한다.
    """
    token = (
        livekit_api.AccessToken(settings.livekit_api_key, settings.livekit_api_secret)
        .with_identity(participant_id)
        .with_name(participant_name)
        .with_grants(
            livekit_api.VideoGrants(
                room_join=True,
                room=room_name,
                can_publish=can_publish,
                can_subscribe=can_subscribe,
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

# SDD-088: 아직 오픈 전 상태 — 상담사가 "클래스 오픈"을 눌러야 회원 입장이 열린다.
_PRE_OPEN_STATUSES = ("ready", "scheduled")


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
        # 클래스 실시간 채팅 사용 여부 — 참여 전 채팅 가능 여부 안내용
        "chat_enabled": bool(s.chat_enabled),
    }


def join_session_by_code(
    code: str,
    db: DBSession,
    *,
    user_id: str | None = None,
    guest_name: str | None = None,
    gender: str | None = None,
    birth_date: date | None = None,
) -> dict:
    """클래스 코드로 참여.

    로그인 사용자 → SessionParticipant(user_id) 생성 (이미 있으면 재사용).
    게스트 → user_id=NULL + guest_name 으로 생성. 동일 이름 중복 참여는 허용한다.
    """
    s = _get_session_by_code(code, db)
    if s.status in _CLOSED_STATUSES:
        raise HTTPException(status_code=400, detail="이미 종료된 클래스입니다")
    # SDD-088: 입장 게이트 이동 — 오픈(open) 이후부터 회원/게스트 입장을 허용한다.
    # host 상담사는 오픈 전에도 자기 세션 참여 처리(no-op)를 막지 않는다.
    if s.status in _PRE_OPEN_STATUSES:
        uid = _to_uuid(user_id) if user_id else None
        if uid is None or s.host_id != uid:
            raise HTTPException(
                status_code=400,
                detail="아직 오픈 전인 클래스입니다. 상담사가 클래스를 열면 입장할 수 있습니다",
            )

    if user_id:
        uid = _to_uuid(user_id)
        if s.host_id == uid:
            # host 상담사는 참여자로 중복 등록하지 않는다
            return {"session": _with_chat_room(_serialize(s), s.id, db), "participant_id": None, "is_guest": False}
        existing = (
            db.query(SessionParticipant)
            .filter(
                SessionParticipant.session_id == s.id,
                SessionParticipant.user_id == uid,
            )
            .first()
        )
        if existing is None:
            # SDD-026: 코드로 자발 참여 = EEG 수집 opt-in 으로 기록(consent_eeg=True).
            # 호스트가 초대(invite_participant)한 참가자는 consent_eeg=False 로 남아, 본인이
            # 참여 동의를 거치기 전에는 업로드가 차단된다.
            existing = SessionParticipant(session_id=s.id, user_id=uid, consent_eeg=True)
            db.add(existing)
        else:
            existing.consent_eeg = True
        db.commit()
        db.refresh(s)
        _notify_participant_changed(s)
        return {"session": _with_chat_room(_serialize(s), s.id, db), "participant_id": str(existing.id), "is_guest": False}

    name = (guest_name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="게스트 참여에는 이름이 필요합니다")

    # SDD-026: 게스트도 코드 참여 시 EEG 수집 opt-in 기록
    participant = SessionParticipant(
        session_id=s.id, user_id=None, guest_name=name[:100],
        gender=gender, birth_date=birth_date, consent_eeg=True,
    )
    db.add(participant)
    db.commit()
    db.refresh(s)
    _notify_participant_changed(s)
    from app.services.report_email_service import participant_token
    return {"session": _serialize(s), "participant_id": str(participant.id), "is_guest": True,
            "participant_token": participant_token(participant)}


def member_livekit_token(
    code: str,
    participant_id: str,
    db: DBSession,
    *,
    participant_token: str | None = None,
    current_user_id: str | None = None,
) -> dict:
    """회원/게스트 구독 전용 LiveKit 토큰 발급.

    can_publish 규칙: 온라인 세션이면서 1:1 이거나, 그룹이면 max_participants ≤ 20 일 때만 송신 허용.
    그 외(오프라인, 온라인 그룹 20명 초과)는 구독 전용(can_publish=False).
    """
    s = _get_session_by_code(code, db)
    if not s.webrtc_room_id:
        raise HTTPException(status_code=400, detail="아직 상담사 화상이 시작되지 않았습니다")

    pid = _to_uuid(participant_id)
    participant = (
        db.query(SessionParticipant)
        .filter(SessionParticipant.id == pid, SessionParticipant.session_id == s.id)
        .first()
    )
    if participant is None:
        raise HTTPException(status_code=403, detail="참여자 권한이 없습니다")

    if participant.user_id is None:
        # 게스트 — participant_token 소유 증명 필수
        from app.services.report_email_service import _decode
        try:
            claims = _decode(participant_token, "report_participant")
        except HTTPException:
            raise HTTPException(status_code=403, detail="참여자 토큰이 유효하지 않습니다")
        if claims.get("sub") != str(participant.id):
            raise HTTPException(status_code=403, detail="참여자 토큰이 유효하지 않습니다")
    elif current_user_id is None or _to_uuid(current_user_id) != participant.user_id:
        # 로그인 회원 — 본인 참여 확인
        raise HTTPException(status_code=403, detail="참여자 권한이 없습니다")

    name = participant.guest_name
    if not name and participant.user_id:
        from app.models.user import User
        user = db.query(User).filter(User.id == participant.user_id).first()
        name = user.name if user else None
    name = name or "참여자"

    # SDD-094: 발언권 기반 송신 규칙 — 온라인 + (1:1 상시 또는 그룹≤20 & speaking=True).
    can_publish = _compute_can_publish(s, participant)

    token = generate_livekit_token(
        room_name=str(s.webrtc_room_id),
        participant_name=name,
        participant_id=str(participant.id),
        can_publish=can_publish,
    )
    return {
        "livekit_token": token,
        "webrtc_room_id": str(s.webrtc_room_id),
        "can_publish": can_publish,
    }


def _compute_can_publish(s: Session, participant: SessionParticipant) -> bool:
    """SDD-094 송신 허용 규칙.

    can_publish = (location_type=="online") AND
                  (participant_mode=="one_on_one"
                   OR (participant_mode=="group" AND max_participants<=20 AND participant.speaking))
    온라인 1:1 은 상시 송출(True), 온라인 그룹≤20 은 손들기 후 상담사가 발언권을 부여(speaking=True)했을 때만
    송출 허용. 그 외(오프라인, 온라인 그룹>20)는 항상 구독 전용(False).
    """
    if s.location_type != "online":
        return False
    if s.participant_mode == "one_on_one":
        return True
    if s.participant_mode == "group" and (s.max_participants or 0) <= 20:
        return bool(participant.speaking)
    return False


# ---------------------------------------------------------------------------
# SDD-094: 발언권 관리 (손들기 → 부여/해제)
# ---------------------------------------------------------------------------


def _get_participant_in_session(sid: UUID, participant_id: str, db: DBSession) -> SessionParticipant:
    """세션에 속한 참여자 행을 조회한다(없으면 404)."""
    try:
        pid = _to_uuid(participant_id)
    except HTTPException:
        raise HTTPException(status_code=404, detail="참여자를 찾을 수 없습니다")
    participant = (
        db.query(SessionParticipant)
        .filter(SessionParticipant.id == pid, SessionParticipant.session_id == sid)
        .first()
    )
    if participant is None:
        raise HTTPException(status_code=404, detail="참여자를 찾을 수 없습니다")
    return participant


def _authorize_participant_access(
    participant: SessionParticipant,
    *,
    participant_token: str | None,
    current_user_id: str | None,
) -> None:
    """참여자 본인(로그인 회원) 또는 게스트 토큰 소유를 검증한다(아니면 403).

    - 로그인 회원 참여자: current_user_id 가 participant.user_id 와 일치해야 한다.
    - 게스트 참여자: participant_token 소유 증명(sub == participant.id) 필수.
    """
    if participant.user_id is not None:
        if current_user_id is None or _to_uuid(current_user_id) != participant.user_id:
            raise HTTPException(status_code=403, detail="본인 참여자만 요청할 수 있습니다")
        return
    from app.services.report_email_service import _decode
    try:
        claims = _decode(participant_token, "report_participant")
    except HTTPException:
        raise HTTPException(status_code=403, detail="참여자 토큰이 유효하지 않습니다")
    if claims.get("sub") != str(participant.id):
        raise HTTPException(status_code=403, detail="참여자 토큰이 유효하지 않습니다")


def raise_hand(
    session_id: str,
    participant_id: str,
    db: DBSession,
    *,
    participant_token: str | None = None,
    current_user_id: str | None = None,
) -> dict:
    """SDD-094: 참여자 손들기 — raise_hand=True 로 표시하고 호스트/본인에게 통지한다.

    참여자 본인(로그인) 또는 게스트 토큰 소유만 가능하다.
    """
    sid = _to_uuid(session_id)
    s = db.query(Session).filter(Session.id == sid).first()
    if not s:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")

    participant = _get_participant_in_session(sid, participant_id, db)
    _authorize_participant_access(
        participant, participant_token=participant_token, current_user_id=current_user_id
    )

    participant.raise_hand = True
    db.commit()
    db.refresh(participant)

    can_publish = _compute_can_publish(s, participant)
    _notify_speaking_changed(sid, participant)
    return {
        "participant_id": str(participant.id),
        "raise_hand": participant.raise_hand,
        "speaking": participant.speaking,
        "can_publish": can_publish,
    }


def set_speaking(
    session_id: str,
    host_id: str,
    participant_id: str,
    granted: bool,
    db: DBSession,
) -> dict:
    """SDD-094: 상담사 발언권 부여/해제 — speaking=granted. 호스트(상담사) 전용.

    부여(granted=True) 시 손들기(raise_hand)를 자동 해제한다.
    """
    sid = _to_uuid(session_id)
    s = db.query(Session).filter(Session.id == sid).first()
    if not s:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")
    if s.host_id != _to_uuid(host_id):
        raise HTTPException(status_code=403, detail="발언권은 상담사만 부여/해제할 수 있습니다")

    participant = _get_participant_in_session(sid, participant_id, db)

    participant.speaking = bool(granted)
    if granted:
        participant.raise_hand = False
    db.commit()
    db.refresh(participant)

    can_publish = _compute_can_publish(s, participant)
    _notify_speaking_changed(sid, participant)
    return {
        "participant_id": str(participant.id),
        "raise_hand": participant.raise_hand,
        "speaking": participant.speaking,
        "can_publish": can_publish,
    }


def _notify_speaking_changed(sid: UUID, participant: SessionParticipant) -> None:
    """speaking_changed 이벤트를 best-effort 로 발행한다(WS 루프 없으면 no-op)."""
    try:
        from app.ws import session_live_namespace as live

        live.notify_speaking_changed(
            str(sid),
            {
                "participant_id": str(participant.id),
                "raise_hand": participant.raise_hand,
                "speaking": participant.speaking,
            },
        )
    except Exception:
        # 이벤트 발행 실패가 상태 변경 성공을 되돌려서는 안 된다
        pass


# ---------------------------------------------------------------------------
# 개선 5: 무음 시그널(비언어적 상태 신호) — 발신자 검증
# ---------------------------------------------------------------------------

# 상태 신호 유형 — "잘 따라가요 / 조금 어려워요 / 잠시 쉴게요"
QUIET_SIGNAL_TYPES: tuple[str, ...] = ("following", "difficult", "resting")

# 시그널을 받을 수 있는(진행 단계) 세션 상태 — 대기실(open)·진행·일시정지
QUIET_SIGNAL_SESSION_STATUSES: tuple[str, ...] = ("open", "in_progress", "paused")


def resolve_signal_sender(
    session_id: str,
    participant_id: str | None,
    current_user_id: str | None,
    db: DBSession,
) -> dict:
    """무음 시그널 발신자를 검증한다 (SDD-026 소유 검증 규칙 재사용, EEG 동의와 무관).

    - 인증 사용자: 본인 참가자 행으로만 발신. participant_id 를 명시하면 반드시
      본인 소유여야 한다 → 타인 participant_id 대리 발신 차단(403).
    - 미인증(게스트): participant_id 로만 식별하되 반드시 게스트 행(user_id IS NULL)이어야
      한다 → 로그인 회원 참가자 사칭 차단(403).
    - 세션 없음 404 / 비참가자·미식별 403.

    반환: {"participant_id": str, "display_name": str, "status": str}
    (상태 신호는 DB 에 저장하지 않는 휘발성 값이다 — 호스트 화면 표시용 메타만 만든다.)
    """
    sid = _to_uuid(session_id)
    s = db.query(Session).filter(Session.id == sid).first()
    if not s:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")

    participant: SessionParticipant | None = None
    if current_user_id:
        uid = _to_uuid(current_user_id)
        participant = (
            db.query(SessionParticipant)
            .filter(
                SessionParticipant.session_id == sid,
                SessionParticipant.user_id == uid,
            )
            .first()
        )
        # 명시 participant_id 는 반드시 본인 참가자와 일치해야 한다(대리 발신 방지)
        if participant_id and (
            participant is None or participant.id != _to_uuid(participant_id)
        ):
            raise HTTPException(status_code=403, detail="본인 참가자로만 신호를 보낼 수 있습니다")
    elif participant_id:
        participant = (
            db.query(SessionParticipant)
            .filter(
                SessionParticipant.id == _to_uuid(participant_id),
                SessionParticipant.session_id == sid,
                SessionParticipant.user_id.is_(None),  # 게스트만 (회원 사칭 차단)
            )
            .first()
        )

    if participant is None:
        raise HTTPException(status_code=403, detail="세션 참가자만 신호를 보낼 수 있습니다")

    display_name = participant.guest_name
    if participant.user_id is not None:
        from app.models.user import User

        user = db.query(User).filter(User.id == participant.user_id).first()
        if user is not None and user.name:
            display_name = user.name

    return {
        "participant_id": str(participant.id),
        "display_name": display_name or "익명",
        "status": s.status,
    }


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

    SDD-023: LINK BAND 실연동 — EEGFeatureWindow 최신 윈도우를 조회해 두뇌휴식도
    (relaxation_index)·연결상태(device_status)·신호품질(quality)을 실값으로 반환한다.
    feature 가 없으면(미착용/미수집) 기존 placeholder(null/unknown/idle) 동작을 유지한다.
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
    # 참가자별 EEG feature 집계(최신 윈도우 + 평균 두뇌휴식도)
    stats = _aggregate_window_stats(s.id, [p.id for p in active], db)

    metrics = []
    contact_fail = 0
    device_fail = 0
    band_low = 0
    for p in active:
        display_name = names.get(p.user_id) if p.user_id else p.guest_name
        st = stats.get(p.id)
        if st is None:
            # feature 미수집 — placeholder 유지 (null 보존)
            device_status = "unknown"
            signal_quality = None
            signal_state = "unknown"
            avg_efficiency = None
            current_efficiency = None
            upload_status = "idle"
            last_eeg_at = None
        else:
            device_status = st["device_status"]
            signal_quality = st["signal_quality"]
            signal_state = st["signal_state"]
            avg_efficiency = st["avg_relaxation"]
            current_efficiency = st["current_relaxation"]
            # SDD-026: staleness(disconnected)면 업로드가 지연/중단된 상태로 표기한다.
            upload_status = "delayed" if device_status == "disconnected" else "streaming"
            last_eeg_at = st["last_eeg_at"]
            # SDD-026: 접촉 실패(lead_off)와 기기 단절(disconnected)을 분리 집계한다.
            if device_status == "lead_off":
                contact_fail += 1
            elif device_status == "disconnected":
                device_fail += 1

        # SDD-026: 배터리 전달 + 저전력 집계 (null 보존 — 미상 시 None, 0 치환 금지)
        if p.band_battery is not None and p.band_battery < _BATTERY_LOW_THRESHOLD:
            band_low += 1

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
                "device_status": device_status,
                "band_battery": p.band_battery,
                "signal_quality": signal_quality,
                "signal_state": signal_state,
                "avg_efficiency": avg_efficiency,
                "current_efficiency": current_efficiency,
                "upload_status": upload_status,
                "last_eeg_at": last_eeg_at,
                # SDD-094: 발언권 상태 — 상담사 모니터 초기 로드/새로고침 시 손들기·발언 표시용
                "raise_hand": p.raise_hand,
                "speaking": p.speaking,
            }
        )

    return {
        "session_id": str(s.id),
        "status": s.status,
        # SDD-026: 상태 계약 버전 + 시작 시각 — join snapshot/이벤트와 동일 계약
        "version": s.state_version or 0,
        "started_at": s.started_at,
        "access_code": s.access_code,
        "metrics": metrics,
        # DashboardBox 4종 집계 — 접촉/단절/저전력을 분리 파생
        "summary": {
            "participant_count": len(metrics),
            "contact_fail_count": contact_fail,
            "device_fail_count": device_fail,
            "band_low_count": band_low,
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
    band_connected = False
    band_battery = None
    latest = None
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
                band_connected = p.band_connected
                band_battery = p.band_battery
                # SDD-023/026: 게스트 명상 실데이터 — 본인 최신 EEG feature 윈도우 (없으면 null).
                # SDD-028: pause/resume 로 window_index 가 재시작하므로 created_at 기준 최신을 취하되,
                # 전체 로딩 없이 LIMIT 1 헬퍼로 최신 1건만 조회한다.
                latest = eeg_query.latest_feature_window(db, s.id, pid)

    # SDD-026: 접촉/연결(device_status)과 신호품질(signal_state)을 분리해 게스트에도 동일 계약으로 내린다.
    sq = latest.signal_quality if latest else None
    device_status = (
        _device_status_live(sq, latest.created_at, _now()) if latest else "unknown"
    )
    return {
        "session_id": str(s.id),
        "status": s.status,
        "version": s.state_version or 0,
        "in_progress": s.status == "in_progress",
        "ended": s.status in _CLOSED_STATUSES,
        "participant_state": participant_state,
        "band_connected": band_connected,
        "device_status": device_status,
        "signal_state": _signal_state_from_signal(sq),
        "band_battery": band_battery,
        "relaxation_index": latest.relaxation_index if latest else None,
        "focus_index": latest.focus_index if latest else None,
        "stress_index": latest.stress_index if latest else None,
        "signal_quality": sq,
        "last_eeg_at": latest.created_at if latest else None,
        # 클래스 실시간 채팅 활성 여부(회원 대기/명상 화면의 채팅 패널 게이트)
        "chat_enabled": bool(s.chat_enabled),
    }


# ---------------------------------------------------------------------------
# SDD-026: /session-live WS join 권한 판정 + snapshot
# ---------------------------------------------------------------------------


def _participant_live_snapshot(s: Session, participant: SessionParticipant, db: DBSession) -> dict:
    """게스트/회원 참가자 본인 전용 라이브 snapshot(민감한 타 참가자 정보 미포함)."""
    stats = _aggregate_window_stats(s.id, [participant.id], db)
    st = stats.get(participant.id)
    if st is None:
        device_status = "unknown"
        signal_quality = None
        signal_state = "unknown"
        current_efficiency = None
        avg_efficiency = None
        last_eeg_at = None
    else:
        device_status = st["device_status"]
        signal_quality = st["signal_quality"]
        signal_state = st["signal_state"]
        current_efficiency = st["current_relaxation"]
        avg_efficiency = st["avg_relaxation"]
        last_eeg_at = st["last_eeg_at"]
    return {
        "session_id": str(s.id),
        "role": "participant",
        "status": s.status,
        "version": s.state_version or 0,
        "started_at": s.started_at,
        "participant_id": str(participant.id),
        "band_connected": participant.band_connected,
        "band_battery": participant.band_battery,
        "device_status": device_status,
        "signal_quality": signal_quality,
        "signal_state": signal_state,
        "current_efficiency": current_efficiency,
        "avg_efficiency": avg_efficiency,
        "last_eeg_at": last_eeg_at,
    }


def resolve_live_join(
    session_id: str,
    user_id: str | None,
    participant_id: str | None,
    db: DBSession,
) -> dict | None:
    """/session-live join 권한을 판정하고 역할별 snapshot 을 만든다.

    - 호스트(세션 소유자): role="host" + 전체 모니터링 snapshot(허용 참가자 목록·집계).
    - 회원/게스트 참가자: role="participant" + 본인 전용 snapshot.
    - 비인가(세션 없음/비참가자/신원 불일치): None → 호출측이 room 미입장 + 거부 처리.

    게스트는 participant_id 로만 식별하되 반드시 게스트 행(user_id IS NULL)이어야 회원 사칭을 막는다.
    """
    try:
        sid = _to_uuid(session_id)
    except HTTPException:
        return None
    s = db.query(Session).filter(Session.id == sid).first()
    if not s:
        return None

    uid = None
    if user_id:
        try:
            uid = _to_uuid(user_id)
        except HTTPException:
            uid = None

    # 호스트 — 전체 수신
    if uid is not None and s.host_id == uid:
        snapshot = get_live_metrics(str(sid), str(uid), db)
        snapshot["role"] = "host"
        return {"role": "host", "participant_id": None, "snapshot": snapshot}

    # 참가자(회원/게스트)
    participant = None
    if uid is not None:
        participant = (
            db.query(SessionParticipant)
            .filter(
                SessionParticipant.session_id == sid,
                SessionParticipant.user_id == uid,
            )
            .first()
        )
    elif participant_id:
        try:
            pid = _to_uuid(participant_id)
        except HTTPException:
            pid = None
        if pid is not None:
            participant = (
                db.query(SessionParticipant)
                .filter(
                    SessionParticipant.id == pid,
                    SessionParticipant.session_id == sid,
                    SessionParticipant.user_id.is_(None),  # 게스트만
                )
                .first()
            )

    if participant is None:
        return None

    return {
        "role": "participant",
        "participant_id": str(participant.id),
        "snapshot": _participant_live_snapshot(s, participant, db),
    }


# ---------------------------------------------------------------------------
# SDD-023: LINK BAND 실연동 — EEG feature ingestion
# ---------------------------------------------------------------------------

# 신호 품질 원시값(0~1) → 윈도우 품질 문자열. 리포트 게이트(§A4.4)가 소비한다.
_SIGNAL_QUALITY_VALID = 0.7
_SIGNAL_QUALITY_DEGRADED = 0.4


def _quality_from_signal(signal_quality: float | None) -> str:
    """signal_quality(0~1) 에서 품질 문자열을 파생한다.

    값이 없으면(null) 판정 불가이므로 모델 기본값 'valid' 를 유지한다(0 치환 금지).
    """
    if signal_quality is None:
        return "valid"
    if signal_quality >= _SIGNAL_QUALITY_VALID:
        return "valid"
    if signal_quality >= _SIGNAL_QUALITY_DEGRADED:
        return "degraded"
    return "invalid"


# ---------------------------------------------------------------------------
# SDD-026: 기기·품질 정합 — 접촉/연결(device_status)과 신호품질(SQI)을 분리한다.
# ---------------------------------------------------------------------------

# 마지막 EEG 수신 이후 이 시간(초) 초과면 BLE 단절/전송 중단으로 본다.
_STALE_AFTER_SECONDS = 10
# 배터리(%) 이 값 미만이면 저전력으로 집계한다.
_BATTERY_LOW_THRESHOLD = 20


def _signal_state_from_signal(signal_quality: float | None) -> str:
    """원시 SQI(0~1) → 신호품질 상태(valid/degraded/invalid/unknown).

    null 은 판정 불가이므로 'unknown' 으로 둔다 — valid 로 승격하지 않는다(SDD-026).
    report 게이트가 쓰는 윈도우 quality 컬럼(_quality_from_signal)과 별개의 라이브 표시 축이다.
    """
    if signal_quality is None:
        return "unknown"
    if signal_quality >= _SIGNAL_QUALITY_VALID:
        return "valid"
    if signal_quality >= _SIGNAL_QUALITY_DEGRADED:
        return "degraded"
    return "invalid"


def _is_stale(last_eeg_at, now: datetime) -> bool:
    """마지막 EEG 수신 이후 staleness 판정. 시각이 없거나 비교 불가하면 stale 아님으로 본다."""
    if last_eeg_at is None:
        return False
    try:
        return (now - _ensure_aware(last_eeg_at)).total_seconds() > _STALE_AFTER_SECONDS
    except (TypeError, ValueError):
        return False


def _device_status_live(signal_quality: float | None, last_eeg_at, now: datetime) -> str:
    """접촉/연결 상태(device_status)를 원시 SQI + staleness 로 판정한다.

    - staleness 초과 → disconnected (BLE 단절/전송 중단)
    - SQI null → unknown (신호품질 판정 불가 — valid 로 승격하지 않음)
    - SQI valid → ok (접촉 양호)
    - 그 외(degraded/invalid) → lead_off (접촉 불량)
    윈도우 자체가 없으면(미착용/미수집) 호출측이 unknown 을 유지한다.
    """
    if _is_stale(last_eeg_at, now):
        return "disconnected"
    if signal_quality is None:
        return "unknown"
    if signal_quality >= _SIGNAL_QUALITY_VALID:
        return "ok"
    return "lead_off"


def _aggregate_window_stats(session_id, participant_ids: list, db: DBSession) -> dict:
    """참가자별 EEG feature 윈도우 집계.

    반환: {participant_id(UUID): {current_relaxation, avg_relaxation, device_status, last_eeg_at}}
    윈도우가 없는 참가자는 키를 포함하지 않는다(호출측에서 placeholder 처리).
    """
    if not participant_ids:
        return {}

    # SDD-028: batch key 기반 조회 헬퍼로 라우팅한다. 범위 미지정이므로 전체 스캔과 동일 결과이며
    # (session_id, participant_id, window_index) 복합 인덱스를 타 참가자별 범위 스캔이 된다.
    rows = eeg_query.feature_windows_in_range(
        db, session_id, participant_ids=participant_ids
    )

    grouped: dict = {}
    for w in rows:
        grouped.setdefault(w.participant_id, []).append(w)

    now = _now()
    result: dict = {}
    for pid, windows in grouped.items():
        # SDD-026: 실제 최신은 created_at 기준(pause/resume 로 window_index 가 재시작할 수 있으므로
        # window_index 최대값이 곧 최신이 아니다). 동률이면 window_index 로 안정 정렬.
        latest = max(windows, key=lambda w: (_ensure_aware(w.created_at) if w.created_at else now, w.window_index))
        # 평균 두뇌휴식도 — null 은 제외해 평균한다(0 치환 금지)
        rel_values = [w.relaxation_index for w in windows if w.relaxation_index is not None]
        avg_relaxation = round(sum(rel_values) / len(rel_values), 4) if rel_values else None
        result[pid] = {
            "current_relaxation": latest.relaxation_index,
            "avg_relaxation": avg_relaxation,
            # SDD-026: 접촉/연결(device_status)과 신호품질(SQI)을 분리해 반환한다.
            "signal_quality": latest.signal_quality,
            "signal_state": _signal_state_from_signal(latest.signal_quality),
            "device_status": _device_status_live(latest.signal_quality, latest.created_at, now),
            "last_eeg_at": latest.created_at,
        }
    return result


def _assert_upload_eligible(participant: SessionParticipant) -> None:
    """SDD-026: 업로드 자격(대기열·동의) 게이트.

    - 대기열(is_waitlisted) 참가자는 아직 세션에 실입장하지 않았으므로 스트리밍 불가.
    - EEG 수집 미동의(consent_eeg=False) 참가자는 업로드 불가(데이터 프라이버시 규칙).
      동의는 클래스 참여(join_session_by_code) 시 opt-in 으로 기록된다.
    """
    if participant.is_waitlisted:
        raise HTTPException(status_code=403, detail="대기열 참가자는 EEG 데이터를 업로드할 수 없습니다")
    if not participant.consent_eeg:
        raise HTTPException(status_code=403, detail="EEG 수집 동의 후 업로드할 수 있습니다")


def resolve_upload_participant(
    sid: UUID,
    participant_id: str | None,
    current_user_id: str | None,
    db: DBSession,
) -> SessionParticipant:
    """업로드 소유 참가자를 확인한다 (REST 배치 + WS 실시간 공유 로직).

    SDD-026 소유 검증 강화 — 명시 participant_id 가 소유 검증을 우회하지 못하게 한다.
    - 인증 사용자: 항상 본인 참가자 행으로만 업로드. participant_id 를 명시하면 반드시
      본인 소유(user_id 일치)여야 한다 → 타인 participant_id 대리 업로드 차단(403).
    - 미인증(게스트): participant_id 로만 식별하되, 반드시 게스트 참가자(user_id IS NULL)여야
      한다 → 로그인 회원 참가자를 사칭하는 대리 업로드 차단(403).
    비참가자·미식별은 403. 호스트는 참가자 행이 아니므로 업로드 대상이 아니다.
    """
    participant = None
    if current_user_id:
        uid = _to_uuid(current_user_id)
        participant = (
            db.query(SessionParticipant)
            .filter(
                SessionParticipant.session_id == sid,
                SessionParticipant.user_id == uid,
            )
            .first()
        )
        # 명시 participant_id 는 반드시 본인 참가자와 일치해야 한다(대리 업로드 방지)
        if participant_id and (
            participant is None or participant.id != _to_uuid(participant_id)
        ):
            raise HTTPException(
                status_code=403, detail="본인 참가자로만 EEG 데이터를 업로드할 수 있습니다"
            )
    elif participant_id:
        participant = (
            db.query(SessionParticipant)
            .filter(
                SessionParticipant.id == _to_uuid(participant_id),
                SessionParticipant.session_id == sid,
                SessionParticipant.user_id.is_(None),  # 게스트만 (회원 사칭 차단)
            )
            .first()
        )

    if participant is None:
        raise HTTPException(status_code=403, detail="세션 참가자만 EEG 데이터를 업로드할 수 있습니다")

    _assert_upload_eligible(participant)
    return participant


def persist_feature_windows(
    sid: UUID,
    participant: SessionParticipant,
    features,
    db: DBSession,
) -> int:
    """검증된 참가자의 EEG feature 윈도우를 멱등 저장한다(window_index 중복 skip).

    REST 5초 배치와 WS 1초 실시간이 동일 window_index 를 이중 저장할 수 있으므로,
    (a) 사전 조회로 기존 초 인덱스를 skip 하고
    (b) 유니크 제약 경합(동시 커밋)은 SAVEPOINT + IntegrityError 로 흡수한다.
    실제 저장한 윈도우 수를 반환한다.
    """
    # SDD-026: 멱등 키를 (play_group_id, window_index) 로 확장한다.
    # pause/resume 으로 second_offset 이 0 부터 재시작해도 실행 세그먼트(play_group_id)가 다르면
    # 별개 키가 되어 skip 되지 않는다(데이터 보존). 레거시(play_group_id=None)는 기존과 동일 동작.
    existing_keys = {
        (pg, idx)
        for (pg, idx) in db.query(
            EEGFeatureWindow.play_group_id, EEGFeatureWindow.window_index
        )
        .filter(
            EEGFeatureWindow.session_id == sid,
            EEGFeatureWindow.participant_id == participant.id,
        )
        .all()
    }

    saved = 0
    seen_in_batch: set = set()
    latest_battery = None
    for f in features:
        play_group_id = getattr(f, "play_group_id", None)
        # 배치 안에서 마지막으로 보고된 배터리값을 채택(null 보존 — 없으면 기존값 유지)
        if getattr(f, "band_battery", None) is not None:
            latest_battery = f.band_battery
        key = (play_group_id, f.second_offset)
        if key in existing_keys or key in seen_in_batch:
            continue
        seen_in_batch.add(key)
        row = EEGFeatureWindow(
            session_id=sid,
            user_id=participant.user_id,
            participant_id=participant.id,
            play_group_id=play_group_id,
            window_index=f.second_offset,
            quality=_quality_from_signal(f.signal_quality),
            device_timestamp_ms=f.timestamp,
            delta_power=f.delta_power,
            theta_power=f.theta_power,
            alpha_power=f.alpha_power,
            beta_power=f.beta_power,
            gamma_power=f.gamma_power,
            total_power=f.total_power,
            focus_index=f.focus_index,
            relaxation_index=f.relaxation_index,
            stress_index=f.stress_index,
            meditation_level=f.meditation_level,
            attention_level=f.attention_level,
            cognitive_load=f.cognitive_load,
            emotional_stability=f.emotional_stability,
            hemispheric_balance=f.hemispheric_balance,
            signal_quality=f.signal_quality,
            sdnn=f.sdnn,
            rmssd=f.rmssd,
            lf_power=f.lf_power,
            hf_power=f.hf_power,
            lf_hf_ratio=f.lf_hf_ratio,
            heart_rate=f.heart_rate,
            respiratory_rate=f.respiratory_rate,
            motion=f.motion,
        )
        try:
            # SAVEPOINT 단위 flush — 동시 저장 경합(유니크 위반)은 롤백 후 skip
            with db.begin_nested():
                db.add(row)
                db.flush()
            saved += 1
        except IntegrityError:
            # WS 1초 + REST 5초 폴백이 같은 window_index 를 거의 동시에 저장한 경우 — 멱등 skip
            continue

    # 업로드가 발생하면 밴드 연결 상태로 마킹(호스트 모니터링/게스트 화면 정합)
    became_connected = False
    if saved and not participant.band_connected:
        participant.band_connected = True
        became_connected = True
    # SDD-026: 배터리 최신값 반영(null 보존 — 보고되지 않으면 기존값 유지)
    if latest_battery is not None:
        participant.band_battery = latest_battery

    db.commit()

    # SDD-026: 밴드 연결 전이/배터리 변화는 device_status_changed 이벤트로 발행(commit 후, best-effort)
    if became_connected or latest_battery is not None:
        _notify_device_status(sid, participant)

    return saved


def _notify_device_status(sid: UUID, participant: SessionParticipant) -> None:
    """device_status_changed 이벤트를 best-effort 로 발행한다(WS 루프 없으면 no-op)."""
    try:
        from app.ws import session_live_namespace as live

        live.notify_device_status_changed(
            str(sid),
            {
                "participant_id": str(participant.id),
                "band_connected": participant.band_connected,
                "band_battery": participant.band_battery,
            },
        )
    except Exception:
        # 이벤트 발행 실패가 저장 성공을 되돌려서는 안 된다
        pass


def ingest_features(
    session_id: str,
    payload,
    db: DBSession,
    *,
    current_user_id: str | None = None,
) -> dict:
    """5초 배치 EEG feature 업로드 → EEGFeatureWindow 일괄 저장.

    참가자 검증: participant_id(게스트/명시) 또는 인증 사용자(user_id)가 세션 참가자여야 한다.
    비참가자는 403. 호스트는 참가자 행이 아니므로 업로드 대상이 아니다.
    중복 초 인덱스(재업로드)는 건너뛰고, 실제 저장한 윈도우 수만 반환한다.
    """
    sid = _to_uuid(session_id)
    s = db.query(Session).filter(Session.id == sid).first()
    if not s:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")

    participant = resolve_upload_participant(sid, payload.participant_id, current_user_id, db)
    saved = persist_feature_windows(sid, participant, payload.features, db)
    return {"session_id": str(sid), "saved": saved}
