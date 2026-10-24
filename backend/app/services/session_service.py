"""세션 관리 비즈니스 로직"""

import logging
import uuid
from datetime import date, datetime, timedelta, timezone
from uuid import UUID

from fastapi import HTTPException, status
from livekit import api as livekit_api
from sqlalchemy import case, func, or_, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DBSession, object_session, selectinload

from app.config import settings
from app.models.user import User
from app.models.client_profile import ClientProfile
from app.models.session import ReportChoiceEvent, Session, SessionParticipant
from app.models.record import SessionRecord
from app.models.class_program import Class, ClassInstructor, ClassMember
from app.models.counseling import CounselingRelationship, CounselingRelationshipCounselor
from app.models.eeg_feature import EEGFeatureWindow
from app.schemas.session import EEGFeatureItem
from app.services import class_code_service, code_service, eeg_query, reminder_service as _reminder_service
from app.services import session_terms
from app.services.session_authz import SessionAction, get_session_authorized
from app.services.session_classifier import (
    PARENT_COUNSELING_RELATIONSHIP,
    PARENT_MEDITATION_CLASS,
    PARENT_NONE,
    SessionFacts,
    classify_session,
)

logger = logging.getLogger(__name__)


# SDD-015: 일정 없는 즉석 클래스는 "ready" 상태로 생성된다.
# 기존 예약형 세션의 "scheduled" 는 그대로 유지해 하위 호환을 지킨다.
# SDD-088: "open"(오픈/대기)은 상담사가 준비를 마치고 회원 입장을 받는 상태 —
# 진행 중으로 간주해 중복 개설 방지·목록 필터에 포함한다.
ACTIVE_STATUSES = ("ready", "scheduled", "open", "in_progress")

# SDD-088: ready/scheduled → open(오픈/대기) → in_progress → completed.
# start 출발에 ready/scheduled 를 남기는 것은 과도기 하위 호환(구 클라이언트·1:1 즉석 세션).
# 오픈된 방의 정상 퇴로는 cancel(=클래스 닫기)이며, end 는 진행중에서만 가능하다.
TRANSITIONS = {
    "open": ({"ready", "scheduled"}, "open"),
    "start": ({"ready", "scheduled", "open"}, "in_progress"),
    "end": ({"in_progress"}, "completed"),
    "cancel": ({"ready", "scheduled", "open", "in_progress"}, "cancelled"),
}


def _to_uuid(value: str) -> UUID:
    try:
        return UUID(str(value))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="잘못된 ID 형식입니다")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def resolve_location_address(
    location_type: str,
    requested: str | None,
    organization_id: UUID | None,
    host_id: UUID,
    db: DBSession,
) -> str | None:
    """SDD-188(D8): 저장할 장소 주소를 결정한다.

    - 온라인 클래스는 장소 개념이 없으므로 입력이 있어도 항상 None.
    - 오프라인 + 입력 있음 → 입력값(공백 제거, 300자 절단)
    - 오프라인 + 입력 없음 → 세션 소속 기관 주소 → 상담사 프로필 주소 → None
    """
    if location_type != "offline":
        return None
    if requested is not None and requested.strip():
        return requested.strip()[:300]

    if organization_id is not None:
        from app.models.organization import Organization

        org = db.get(Organization, organization_id)
        if org is not None and org.address and org.address.strip():
            return org.address.strip()[:300]

    from app.services import agent_policy

    host = db.get(User, host_id)
    return agent_policy.counselor_address(host, db)


def _load_user_directory(db: DBSession | None, user_ids) -> dict:
    """회원 id → {name, email} 를 한 번의 쿼리로 가져온다(직렬화 N+1 방지)."""
    ids = {uid for uid in user_ids if uid}
    if not ids or db is None:
        return {}
    rows = db.query(User.id, User.name, User.email).filter(User.id.in_(ids)).all()
    return {r[0]: {"name": r[1], "email": r[2]} for r in rows}


def _list_user_directory(sessions: list[Session], db: DBSession) -> dict:
    """목록 직렬화용 — 모든 세션의 호스트·회원 참여자를 한 쿼리로 조회한다."""
    ids = set()
    for sess in sessions:
        ids.add(sess.host_id)
        ids.update(p.user_id for p in (sess.participants or []) if p.user_id)
    return _load_user_directory(db, ids)


def _serialize(
    s: Session,
    *,
    include_participant_pii: bool = False,
    users: dict | None = None,
) -> dict:
    """세션 응답 dict.

    SDD-209 B8: 참여자 PII(성별·생년월일·이메일)는 **호스트 뷰에서만** 담는다 — 기본값은 비노출이며 호스트 경로가
    ``include_participant_pii=True`` 로 명시한다. 이름(``user_name``)과 진행자 이름(``host_name``)은 공개.
    ``users`` 는 목록처럼 여러 세션을 직렬화할 때 미리 한 번에 만든 디렉터리(N+1 방지).
    """
    parts = list(s.participants or [])
    if users is None:
        users = _load_user_directory(
            object_session(s), [s.host_id, *(p.user_id for p in parts)]
        )
    host_info = users.get(s.host_id) or {}
    hide_host = not include_participant_pii and s.class_id is not None and s.host_state in ("pending_ack", "needs_reassign")
    waitlist_count = sum(1 for p in parts if p.is_waitlisted)
    return {
        "id": str(s.id),
        # SDD-028: 실행 회차 식별자. 미설정(직접 생성 등) 시 session_id 를 회차로 간주한다.
        "run_id": str(s.run_id) if s.run_id else str(s.id),
        "type": s.type,
        "custom_type_name": s.custom_type_name,
        "status": s.status,
        "host_id": None if hide_host else str(s.host_id),
        "host_name": None if hide_host else host_info.get("name"),
        "host_state": s.host_state,
        "scheduled_at": s.scheduled_at,
        "access_code": class_code_service.display_code(object_session(s), s),
        "opened_at": s.opened_at,
        "started_at": s.started_at,
        "ended_at": s.ended_at,
        "duration_min": s.duration_min,
        "title": s.title,
        "notes": s.notes,
        "max_participants": s.max_participants,
        "location_type": s.location_type,
        # SDD-188(D8): 오프라인 클래스 방문 주소 — 내담자 AI 비서 길찾기 CTA 의 원천.
        "location_address": s.location_address,
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
                # B8: 표시 이름 — 회원은 계정 이름, 비회원은 입력한 이름. 모든 뷰에 공개(이름만).
                "user_name": (users.get(p.user_id) or {}).get("name") if p.user_id else p.guest_name,
                # B8: 이메일은 호스트 뷰 전용(회원=계정 이메일, 비회원=리포트 수신 이메일).
                "user_email": (
                    ((users.get(p.user_id) or {}).get("email") if p.user_id else p.report_email)
                    if include_participant_pii
                    else None
                ),
                # AUTHZ-PARTICIPANT-PII: 생년월일/성별 등 참여자 PII 는 host(상담사)에게만 노출한다.
                #   참여자(내담자)가 GET /sessions/{id} 로 조회할 때 타인 PII 가 새지 않도록
                #   비host 뷰에서는 null 로 강등한다.
                "gender": p.gender if include_participant_pii else None,
                "birth_date": p.birth_date if include_participant_pii else None,
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
                # SDD-209(B14): 비회원 리포트 메일 발송 결과 — 호스트 뷰 전용(실패를 상담사 화면에 표시)
                "report_email_status": p.report_email_status if include_participant_pii else None,
                # SDD-209(B9/BE-11): 최초 입장 시각(호스트 뷰 전용) — 상세의 `참여함`·입장 N명 근거. 미입장/기록 이전은 null
                "entered_at": p.entered_at if include_participant_pii else None,
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
    s = get_session_authorized(db, session_id, host_id, SessionAction.SESSION_CHAT_TOGGLE)
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
    s = get_session_authorized(db, session_id, user_id, SessionAction.SESSION_CHAT_ROOM_VIEW)
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
    """클래스 코드(4자리 숫자 문자열) 발급 — 활성 클래스 사이에서 중복 없음(SDD-209 B4).

    코드 공간이 소진되면 명시적 오류(503)를 낸다.
    """
    try:
        return class_code_service.generate_class_code(db)
    except class_code_service.ClassCodeExhausted:
        raise class_code_service.exhausted_http_error()


# uq_classes_active_access_code 에서 제외되는 클래스 상태(모델 정의와 같다)
_CLASS_CODE_RELEASED_STATUSES = ("completed", "cancelled", "archived")


def _add_session_with_code_retry(session: Session, db: DBSession) -> None:
    """세션 행 삽입. 동시 발급 경합(활성 코드 부분 유니크 위반)이면 코드를 재발급해 재시도한다."""
    for attempt in range(5):
        try:
            with db.begin_nested():
                db.add(session)
                db.flush()
            break
        except IntegrityError:
            if session.access_code is None or attempt == 4:
                raise
            session.access_code = generate_access_code(db)
    # 클래스 코드는 최종 세션 코드를 복사한다(재발급 반영 위해 세션 INSERT 뒤에 한 번만 쓴다).
    if session.class_id is not None and session.access_code is not None:
        klass = db.get(Class, session.class_id)
        if klass is not None and klass.access_code != session.access_code:
            # 세션 쪽 유일성은 종료·취소 세션의 코드를 풀어 주지만 클래스 status 는 세션을 따라가지 않는다.
            # uq_classes_active_access_code 범위(숨김 아님 + 종료·취소·보관 아님)에서 같은 코드를 쥔 클래스만 비워 충돌을 막는다.
            db.query(Class).filter(
                Class.access_code == session.access_code,
                Class.id != klass.id,
                Class.hidden_at.is_(None),
                Class.status.notin_(_CLASS_CODE_RELEASED_STATUSES),
            ).update({Class.access_code: None}, synchronize_session="fetch")
            klass.access_code = session.access_code
            db.flush()


# ---------------------------------------------------------------------------
# SDD-214: 세션 생성 시 부모(명상 클래스 / 상담 관계) 동시 생성
# ---------------------------------------------------------------------------


def _sync_class_from_session(klass: Class, s: Session) -> None:
    """세션의 클래스 단위 설정을 클래스 행에 복사한다(dual-write — 엔진은 계속 세션 값을 읽는다)."""
    klass.title = s.title
    klass.description = s.notes
    klass.capacity = s.max_participants
    klass.participant_mode = s.participant_mode
    klass.linkband_mode = s.linkband_mode
    klass.location_type = s.location_type
    klass.location_address = s.location_address
    klass.default_duration_min = s.duration_min
    klass.record_audio = s.record_audio
    klass.record_video = s.record_video
    klass.chat_enabled = bool(s.chat_enabled)
    klass.sfu_enabled = bool(s.sfu_enabled)
    klass.reminder_offsets = list(s.reminder_offsets or [])


def _visible_session_count(class_id: UUID, db: DBSession) -> int:
    return (
        db.query(func.count(Session.id))
        .filter(Session.class_id == class_id, Session.hidden_at.is_(None), Session.is_template.is_(False))
        .scalar()
    )


def _sync_parent_class(s: Session, db: DBSession) -> None:
    """클래스의 가시 세션이 1개일 때만 세션 설정을 클래스에 반영한다(Phase 1 의 클래스는 세션과 1:1).

    다회차 클래스의 동기화 규칙은 Phase 3 이 다시 정한다.
    """
    if s.class_id is None:
        return
    db.flush()
    if _visible_session_count(s.class_id, db) != 1:
        return
    klass = db.get(Class, s.class_id)
    if klass is not None:
        _sync_class_from_session(klass, s)


def _hide_class_if_no_visible_sessions(s: Session, db: DBSession) -> None:
    """마지막 가시 세션이 숨겨지면 클래스도 숨긴다(가시 세션 0개의 고아 클래스 방지)."""
    if s.class_id is None:
        return
    db.flush()
    if _visible_session_count(s.class_id, db) > 0:
        return
    klass = db.get(Class, s.class_id)
    if klass is not None and klass.hidden_at is None:
        klass.hidden_at = s.hidden_at


def _get_or_create_placeholder_relationship(s: Session, db: DBSession) -> CounselingRelationship:
    """호스트별 보관용 관계(is_placeholder, 상담사당 1개)를 찾거나 만들고, 동시 생성에 대비해 행을 잠근다."""
    def _lookup() -> CounselingRelationship | None:
        return (
            db.query(CounselingRelationship)
            .execution_options(include_hidden=True)
            .filter(CounselingRelationship.counselor_id == s.host_id, CounselingRelationship.is_placeholder.is_(True))
            .with_for_update()
            .first()
        )

    rel = _lookup()
    if rel is None:
        try:
            with db.begin_nested():
                rel = CounselingRelationship(
                    organization_id=s.organization_id,
                    organization_attribution_known=True,
                    counselor_id=s.host_id,
                    is_placeholder=True,
                    modality_default=s.type if s.type in ("clinical", "hypnosis") else None,
                    status="active",
                )
                db.add(rel)
                db.flush()
        except IntegrityError:
            # 동시에 다른 요청이 먼저 만든 경우(uq_rel_placeholder) — 그 행을 쓴다.
            rel = _lookup()
            if rel is None:
                raise
    if rel.hidden_at is not None:
        rel.hidden_at = None
    link_exists = (
        db.query(CounselingRelationshipCounselor.id)
        .filter_by(relationship_id=rel.id, counselor_id=s.host_id)
        .first()
    )
    if link_exists is None:
        # sessions 의 (relationship_id, host_id) 복합 FK 참조 대상
        db.add(CounselingRelationshipCounselor(relationship_id=rel.id, counselor_id=s.host_id, status="active"))
        db.flush()
    return rel


def _attach_parent(s: Session, db: DBSession) -> None:
    """분류 함수로 부모를 정해 같은 트랜잭션에서 만들고 세션에 연결한다(세션 INSERT 전에 호출).

    CHECK(ck_sessions_one_parent) 때문에 부모가 먼저 있어야 비템플릿 세션이 들어간다.
    템플릿은 부모가 없다(T0). 분류 불가(X0)는 버그이므로 아무것도 만들지 않고 서버 오류로 끝낸다.
    """
    result = classify_session(
        SessionFacts(is_template=bool(s.is_template), type=s.type, participant_mode=s.participant_mode)
    )
    if result.parent_kind == PARENT_NONE:
        return
    if result.parent_kind == PARENT_MEDITATION_CLASS:
        klass = Class(
            organization_id=s.organization_id,
            organization_attribution_known=True,
            created_by=s.host_id,
            schedule_mode="fixed",
            planned_session_count=1,
            status="active",
        )
        _sync_class_from_session(klass, s)
        db.add(klass)
        db.flush()
        db.add(ClassInstructor(class_id=klass.id, user_id=s.host_id, role="lead", status="active", added_by=s.host_id))
        db.flush()
        s.class_id = klass.id
        s.seq = 1
    elif result.parent_kind == PARENT_COUNSELING_RELATIONSHIP:
        rel = _get_or_create_placeholder_relationship(s, db)
        last_seq = (
            db.query(func.max(Session.seq))
            .execution_options(include_hidden=True)
            .filter(Session.counseling_relationship_id == rel.id)
            .scalar()
        )
        s.counseling_relationship_id = rel.id
        s.seq = (last_seq or 0) + 1
    else:
        db.rollback()
        logger.error("[session] 분류 불가 세션 생성 중단 rule=%s type=%s mode=%s", result.rule, s.type, s.participant_mode)
        raise HTTPException(status_code=500, detail="서버 내부 오류가 발생했습니다")
    s.session_kind = "regular"
    s.host_state = "assigned"


def _ensure_aware(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _same_instant(a: datetime | None, b: datetime | None) -> bool:
    """두 시각이 같은 순간인지(tz 정규화 후) 비교한다. 둘 다 None 이면 같음."""
    if a is None or b is None:
        return a is None and b is None
    return _ensure_aware(a) == _ensure_aware(b)


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


def normalize_reminder_offsets(value) -> list[int]:
    """SDD-097: 리마인더 시점 정규화 — reminder_service 규칙 재사용(단일 진실)."""
    return _reminder_service.normalize_reminder_offsets(value)


def create_session(host_id: str, payload, db: DBSession) -> dict:
    if settings.class_scheduling_enabled and payload.type == "meditation" and not getattr(payload, "is_template", False):
        raise HTTPException(409, detail={"code": "use_class_scheduling"})
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
        # SDD-097: 예약 클래스 사전 안내(리마인더) 시점 — 시작 N분 전 정수 목록.
        reminder_offsets=normalize_reminder_offsets(getattr(payload, "reminder_offsets", None)),
        max_participants=max_p,
        location_type=payload.location_type,
        # SDD-188(D8): 오프라인이면 기관 주소 → 상담사 주소 순으로 기본값을 채운다.
        location_address=resolve_location_address(
            payload.location_type,
            getattr(payload, "location_address", None),
            org.id if org else None,
            host_uuid,
            db,
        ),
        participant_mode=payload.participant_mode,
        linkband_mode=payload.linkband_mode,
        webrtc_room_id=webrtc_room_id,
        sfu_enabled=payload.sfu_enabled,
        record_audio=payload.record_audio,
        record_video=payload.record_video,
    )
    _attach_parent(session, db)
    _add_session_with_code_retry(session, db)

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
        title=session_terms.notification_title(event_type),
        body=session.title or session_terms.notification_body_fallback(),
    )

    # SDD-097: 예약 클래스면 리마인더를 ETA 태스크로 예약한다(끔이면 아무것도 안 함).
    if scheduled_at is not None:
        _reminder_service.schedule_session_reminders(session, db)

    return _with_chat_room(_serialize(session, include_participant_pii=True), session.id, db)


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
    # SDD-188(D8): 장소 주소도 유형 설정으로 함께 복사한다(일정만 새로 정한다).
    "location_address",
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
        reminder_offsets=normalize_reminder_offsets(getattr(payload, "reminder_offsets", None)),
        max_participants=_normalized_max_participants(payload.type, payload.max_participants),
        location_type=payload.location_type,
        location_address=resolve_location_address(
            payload.location_type,
            getattr(payload, "location_address", None),
            org.id if org else None,
            host_uuid,
            db,
        ),
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
    return _serialize(template, include_participant_pii=True)


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
        webrtc_room_id=None if is_template else uuid.uuid4(),
        is_template=is_template,
    )
    _attach_parent(clone, db)
    _add_session_with_code_retry(clone, db)
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
    source = get_session_authorized(db, session_id, host_id, SessionAction.SESSION_DUPLICATE)
    _require_legacy_mutation(source, db)
    if settings.class_scheduling_enabled and source.type == "meditation":
        raise HTTPException(409, detail={"code": "use_class_scheduling"})
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
    return _with_chat_room(_serialize(clone, include_participant_pii=True), clone.id, db)


def save_as_template(
    session_id: str,
    host_id: str,
    db: DBSession,
    *,
    title: str | None = None,
) -> dict:
    """SDD-095: 기존 클래스의 유형 설정을 재사용 가능한 템플릿으로 저장한다(복제 + is_template)."""
    source = get_session_authorized(db, session_id, host_id, SessionAction.SESSION_SAVE_TEMPLATE)
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
    return _serialize(template, include_participant_pii=True)


def _sorted_session_query(base, *, page: int | None, limit: int | None):
    """목록 쿼리에 DB 정렬·페이지 창을 적용한다.

    정렬 키는 scheduled_at 우선, 없으면 created_at 이며, ORDER BY/LIMIT/OFFSET 을
    DB 로 내려 무제한 로드와 후처리 슬라이스를 없앤다.
    """
    activity = func.coalesce(Session.scheduled_at, Session.created_at)
    query = base.order_by(activity.desc(), Session.created_at.desc())
    if page is not None and limit is not None:
        query = query.offset((page - 1) * limit).limit(limit)
    return query


def list_templates(
    user_id: str,
    db: DBSession,
    *,
    page: int | None = None,
    limit: int | None = None,
) -> tuple[list[dict], int]:
    """호스트가 저장한 클래스 템플릿 목록 (최신순) — 생성 폼의 '내 템플릿에서 시작' 용."""
    uid = _to_uuid(user_id)
    base = db.query(Session).filter(Session.host_id == uid, Session.is_template.is_(True))
    total = base.count()
    # participants 를 selectinload 로 즉시 로딩해 직렬화 N+1 을 제거한다.
    rows = (
        _sorted_session_query(base, page=page, limit=limit)
        .options(selectinload(Session.participants))
        .all()
    )
    # 창 적용 시 DB 순서를, 미적용 시 기존 파이썬 정렬과 동일한 순서를 보장한다.
    rows = sorted(rows, key=_sort_key, reverse=True)
    users = _list_user_directory(rows, db)
    return [_serialize(s, include_participant_pii=True, users=users) for s in rows], total


def list_sessions(
    user_id: str,
    db: DBSession,
    *,
    page: int | None = None,
    limit: int | None = None,
) -> tuple[list[dict], int]:
    """내 클래스 목록 — 템플릿(is_template=True)은 제외한다(별도 /sessions/templates)."""
    uid = _to_uuid(user_id)
    actor=db.query(User).filter_by(id=uid).first()
    if actor and actor.role=="org_admin":
        # 관리자 일정 메타는 /classes·/counseling DTO로 조회한다.
        return [],0
    # host 이거나 참여자인 세션을 단일 쿼리로 모은다(중복 제거 포함).
    participates = (
        db.query(SessionParticipant.id)
        .filter(
            SessionParticipant.session_id == Session.id,
            SessionParticipant.user_id == uid,
        )
        .exists()
    )
    base = db.query(Session).filter(
        Session.is_template.is_(False),
        or_(Session.host_id == uid, participates),
    )
    total = base.count()
    rows = (
        _sorted_session_query(base, page=page, limit=limit)
        .options(selectinload(Session.participants))
        .all()
    )
    rows = sorted(rows, key=_sort_key, reverse=True)
    users = _list_user_directory(rows, db)
    # B8: 참여자 PII 는 본인이 호스트인 클래스에서만 — 참여한 클래스 목록에서는 타인 개인정보를 가린다.
    return [_serialize(s, include_participant_pii=(s.host_id == uid), users=users) for s in rows], total


def get_session(session_id: str, user_id: str, db: DBSession) -> dict:
    s = get_session_authorized(db, session_id, user_id, SessionAction.SESSION_VIEW)
    # AUTHZ-PARTICIPANT-PII: 호스트만 참여자 PII(생년월일·성별)를 본다. 참여자 본인 조회에서는 제외.
    is_host = s.host_id == _to_uuid(user_id)
    return _with_chat_room(
        _serialize(s, include_participant_pii=is_host), s.id, db
    )


def _require_legacy_mutation(session,db):
    if session.class_id:
        parent=db.query(Class).filter_by(id=session.class_id).first()
        if parent and parent.recurrence_rule:
            raise HTTPException(409,detail={"code":"use_class_scheduling_api"})


def update_session(session_id: str, host_id: str, payload, db: DBSession) -> dict:
    s = get_session_authorized(db, session_id, host_id, SessionAction.SESSION_UPDATE)
    _require_legacy_mutation(s,db)
    # SDD-214: 동시 PUT 이 같은 클래스에 서로의 변경을 덮어쓰지 않도록 세션 행을 잠그고 최신 값을 다시 읽는다.
    s = _lock_session_for_capacity(s.id, db) or s
    if s.status in ("completed", "cancelled"):
        raise HTTPException(status_code=400, detail="종료된 세션은 수정할 수 없습니다")

    # FUNC-01: 변경 전 예약 시각·리마인더 시점을 보관 — 변경 후 옛 ETA 태스크를 취소한다.
    _old_scheduled_at = s.scheduled_at
    _old_reminder_offsets = normalize_reminder_offsets(s.reminder_offsets)

    _current_scheduled = _ensure_aware(s.scheduled_at) if s.scheduled_at else None
    new_scheduled_at = _ensure_aware(payload.scheduled_at) if payload.scheduled_at else _current_scheduled
    new_duration = payload.duration_min if payload.duration_min is not None else s.duration_min

    # FUNC-08: 생성(create_session)과 동일하게 과거 일시 수정을 차단한다.
    #   payload.scheduled_at 이 실제로 전달된 경우에만 검증한다(부분 수정 보존).
    if payload.scheduled_at is not None and new_scheduled_at is not None:
        if new_scheduled_at < _now() - timedelta(minutes=1):
            raise HTTPException(status_code=400, detail="과거 일시로는 세션을 수정할 수 없습니다")

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
    promoted_by_capacity: list[SessionParticipant] = []
    if payload.max_participants is not None:
        s.max_participants = payload.max_participants
        # B6: 정원이 늘면 대기열을 순번 순으로 승격한다(세션 행 잠금 하에서 취소·입장과 직렬화).
        db.flush()  # populate_existing 이 미반영 변경을 덮지 않도록 먼저 flush
        _lock_session_for_capacity(s.id, db)
        promoted_by_capacity = _promote_waitlist_all(s, db)
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

    # SDD-188(D8): 장소 주소 반영.
    #   - 주소를 명시하면 그 값으로 교체(빈 문자열이면 비운다).
    #   - 주소를 안 주고 장소유형만 오프라인으로 바꿨으면 기본값을 다시 채운다.
    #   - 온라인으로 바뀌면 항상 null 로 정리한다.
    _address_given = getattr(payload, "location_address", None) is not None
    if _address_given or payload.location_type is not None:
        if s.location_type != "offline":
            s.location_address = None
        elif _address_given:
            _cleaned = payload.location_address.strip()
            s.location_address = _cleaned[:300] if _cleaned else None
        elif not s.location_address:
            s.location_address = resolve_location_address(
                s.location_type, None, s.organization_id, s.host_id, db
            )

    # SDD-097: 리마인더 시점 재설정 — 주어졌을 때만 교체.
    reminders_changed = False
    if getattr(payload, "reminder_offsets", None) is not None:
        s.reminder_offsets = normalize_reminder_offsets(payload.reminder_offsets)
        reminders_changed = True

    _sync_parent_class(s, db)
    db.commit()
    db.refresh(s)
    if promoted_by_capacity:
        _notify_promoted(s, promoted_by_capacity, db)
        _notify_participant_changed(s, db)

    # SDD-097 / FUNC-01: 일정 또는 리마인더 시점이 바뀌면 옛 ETA 를 취소하고 다시 예약한다.
    # (이미 지난 시점은 예약되지 않고, 발송 로그가 중복 발송을 막는다. 남은 옛 ETA 가 잘못된
    #  시각에 발송하는 것은 run_reminder 의 offset/ETA due 게이트가 추가로 차단한다.)
    if reminders_changed or payload.scheduled_at is not None:
        _scheduled_changed = not _same_instant(s.scheduled_at, _old_scheduled_at)
        if _scheduled_changed:
            # 일정이 바뀌면 옛 일정 기준 task_id 전체가 새 예약과 겹치지 않는다.
            _reminder_service.revoke_session_reminders(
                s.id, _old_reminder_offsets, _old_scheduled_at
            )
        elif reminders_changed:
            # 일정은 그대로, 시점만 바뀐 경우 — 제거된 시점의 옛 ETA 만 취소한다.
            _new_offsets = normalize_reminder_offsets(s.reminder_offsets)
            _removed = [o for o in _old_reminder_offsets if o not in _new_offsets]
            _reminder_service.revoke_session_reminders(s.id, _removed, _old_scheduled_at)
        _reminder_service.schedule_session_reminders(s, db)

    # SDD-093: S02 세션 변경 알림
    _notify_participants_event(
        s, "session_updated", db,
        title=session_terms.notification_title("session_updated"),
        body=s.title or session_terms.notification_body_fallback(),
    )

    return _with_chat_room(_serialize(s, include_participant_pii=True), s.id, db)


_DELETABLE_STATUSES = frozenset({"ready", "scheduled", "cancelled"})


def delete_session(session_id: str, host_id: str, db: DBSession) -> None:
    """클래스 삭제 = 숨김(보존 전환) (SDD-209 B1 / RV1-4).

    행을 지우면 ORM/FK CASCADE 로 참가자·기록·EEG·리포트·청크가 즉시 사라진다. 일반 삭제는
    ``hidden_at`` 만 기록해 모든 조회·접근에서 제외하고, 원본(음성·영상·EEG raw)은 보관 스위프나
    플랫폼 관리자 삭제(original_deletion_service)로만 지운다.
    """
    s = get_session_authorized(db, session_id, host_id, SessionAction.SESSION_DELETE)
    _require_legacy_mutation(s,db)
    # SDD-209(B8 / BE-13): 준비·예정·취소 상태만 삭제할 수 있다. 열림(대기실 개방)·진행 중·완료는 거부 —
    # 열린 클래스는 먼저 취소(닫기)해야 하고, 완료된 기록은 삭제 대상이 아니다. 거부 시 알림·숨김 없음.
    if s.status not in _DELETABLE_STATUSES:
        raise HTTPException(
            status_code=409,
            detail="진행 중이거나 종료된 클래스는 삭제할 수 없어요. 열린 클래스는 먼저 닫아 주세요",
        )
    # SDD-093: S13 세션 삭제 알림 (숨김 전 발화 — participants 접근 필요)
    _notify_participants_event(
        s, "session_deleted", db,
        include_waitlisted=True,
        title=session_terms.notification_title("session_deleted"),
        body=s.title or session_terms.notification_body_fallback(),
    )
    s.hidden_at = datetime.now(timezone.utc)
    _hide_class_if_no_visible_sessions(s, db)
    db.commit()


def _close_out_media_on_cancel(s: Session, db: DBSession) -> None:
    """cancel 시 진행 중이던 녹음·영상을 마감해 고아(orphan) 데이터를 막는다(BUG-4).

    - 음성: recording → failed(중단), recording_ended_at 기록.
    - 영상: recording → completed(종료), video_recording_ended_at 기록.
    (실제 데이터 폐기·상담사 확인 플로우는 SDD-101 Phase D 에서 별도 처리.)
    """
    record = db.query(SessionRecord).filter(SessionRecord.session_id == s.id).first()
    if record is None:
        return
    if record.status == "recording":
        record.status = "failed"
        record.recording_ended_at = _now()
    if record.video_status == "recording":
        record.video_status = "completed"
        record.video_recording_ended_at = _now()
    db.commit()


def transition_status(session_id: str, host_id: str, action: str, db: DBSession,
                      *, restrict_from: set[str] | None = None, force: bool = False, confirmed_conflict_fingerprint: str | None = None) -> dict:
    if action not in TRANSITIONS:
        raise HTTPException(status_code=400, detail="알 수 없는 액션입니다")
    s = get_session_authorized(db, session_id, host_id, SessionAction.SESSION_TRANSITION)
    parent=None
    if s.class_id:
        from app.services.class_write_service import lock_class_session,check_conflicts
        from app.services.session_authz import authorize_session
        parent,s=lock_class_session(db,s,host_id)
        authorize_session(db,host_id,s,SessionAction.SESSION_TRANSITION)
        if parent and parent.recurrence_rule and action in ("open","start"):
            from app.schemas.class_scheduling import ScheduleRow,WriteCommand
            row=ScheduleRow.model_construct(client_key=str(s.id),session_id=s.id,seq=s.seq,
                scheduled_at=_ensure_aware(s.scheduled_at) if s.scheduled_at else _now(),
                duration_min=s.duration_min,host_id=s.host_id,location_type=s.location_type,location_address=s.location_address)
            actor=db.query(User).filter_by(id=_to_uuid(host_id)).one()
            check_conflicts(db,[row],actor,WriteCommand(operation_key="transition",force=force,
                confirmed_conflict_fingerprint=confirmed_conflict_fingerprint),{s.id},class_id=s.class_id)
            from app.models.class_scheduling import SessionHostRequest
            for pending in db.query(SessionHostRequest).filter(SessionHostRequest.session_id==s.id,
                    SessionHostRequest.status.in_(("requested","pending_ack"))).all():
                pending.status="expired";pending.resolved_at=_now()
            s.host_state="assigned"

    # SDD-217: 같은 클래스 회차 종료의 응답 유실·동시 재시도는 읽기로 끝낸다.
    # 권한 재검사와 공통 잠금 이후이므로 제거된 진행자에게 재응답하지 않는다.
    if parent and action == "end" and s.status == "completed" and restrict_from is None:
        db.commit()
        return _with_chat_room(_serialize(s, include_participant_pii=True), s.id, db)

    allowed_from, target = TRANSITIONS[action]
    # STATE-SWEEP-TOCTOU: 호출부가 전이 출발 상태를 더 좁힐 수 있다(예: 스윕은 open 에서만
    #   cancel). effective_from 을 사전 검사와 CAS WHERE 절 양쪽에 사용해, 조회 이후 다른
    #   전이로 상태가 바뀐 경우에도 원자적으로 취소되지 않게 한다(rowcount==0 → 409).
    effective_from = set(allowed_from) & set(restrict_from) if restrict_from is not None else set(allowed_from)
    if s.status not in effective_from:
        raise HTTPException(status_code=400, detail="잘못된 상태 전이입니다")

    # SDD-021: 1.0 "클래스 시작" 패리티 — 그룹 수업은 active 참가자(대기열 제외) 1명 이상이어야
    # 시작할 수 있다. 1:1 세션은 내담자가 암묵적으로 지정되므로 기존 상태전이 동작을 유지한다.
    # SDD-101(Brian 요청): 참여자 0명이어도 상담사가 단독으로 클래스를 시작·종료하고
    # 상담사 리포트를 생성할 수 있도록 그룹 시작 제약을 완화한다(단독 리허설·테스트·보고용).
    if action == "start" and s.participant_mode == "group":
        active = [p for p in (s.participants or []) if not p.is_waitlisted]
        if len(active) < 1:
            logger.info(
                "[session] 참여자 0명 그룹 클래스 단독 시작 허용(SDD-101): session=%s host=%s",
                s.id,
                s.host_id,
            )

    # SDD-026: 상태 계약 버전 — 전이마다 정확히 +1 증가(계약: SDD-026).
    # STATE-01: 인메모리 선반영(s.state_version += 1) 후 CAS values 에서 다시 +1 을
    # 계산해 DB 에 +2 가 반영되던 문제를 제거한다. 원본 값을 스냅샷해 1회만 증가시킨다.
    # (인메모리 속성을 건드리지 않으므로 commit flush 가 CAS 결과를 덮어쓰지 않는다.)
    prev_state_version = s.state_version or 0

    # SDD-101 B1: CAS(compare-and-set) — read-modify-write 대신 조건부 UPDATE로
    # 동시 전이 경합(이중 finalize·이벤트 발행)을 원자적으로 막는다.
    # 동일 시점 두 요청이 같은 상태를 읽어 둘 다 통과하던 버그(BUG-3) 해결.
    now = _now()
    values = {
        "status": target,
        "state_version": prev_state_version + 1,
    }
    if action == "open":
        values["opened_at"] = case((Session.opened_at.is_(None), now), else_=Session.opened_at)
    elif action == "start":
        values["started_at"] = case((Session.started_at.is_(None), now), else_=Session.started_at)
    elif action == "end":
        values["ended_at"] = now

    try:
        result = db.execute(
            update(Session)
            .where(Session.id == s.id, Session.status.in_(effective_from))
            .values(**values)
        )
        if result.rowcount == 0:
            raise HTTPException(status_code=409, detail="상태가 이미 변경되었습니다")
        if parent and action == "end":
            from app.services.class_attendance_service import finalize_attendance
            finalize_attendance(db, parent, s)
        if parent and action == "end" and s.session_kind == "regular":
            from app.services.class_rolling_service import finish_class_if_due
            finish_class_if_due(db,parent,now)
        if parent and action == "cancel" and s.session_kind == "regular":
            # 즉석 클래스의 유일한 회차가 취소되면 부모·멤버도 닫는다(회원 '참여 중' 고착 방지).
            from app.services.class_rolling_service import close_cancelled_instant_class
            close_cancelled_instant_class(db,parent,now)
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(s)
    if parent and action == "end":
        _notify_participant_changed(s, db)

    # 클래스 오픈 시점에 세션 채팅방을 보장한다(생성 시 개설이 기본 — 기존 세션 대상 멱등 보완).
    # 입장한 회원이 곧바로 room_id 를 받아 채팅에 참여할 수 있게 한다.
    if action == "open":
        ensure_session_chat_room(s.id, db)

    if action == "end":
        # SDD-088 후속: 영상 종료를 먼저 수행해 audio finalize 가 video_merge_needed()
        # 로 병합 필요 여부를 판별할 수 있게 한다(종료 응답은 비동기 체인이라 지연 없음).
        try:
            from app.services import video_service
            video_service.finalize_on_session_end(s.id, db)
        except Exception as exc:
            # MB-ERR-002: 영상 finalize 실패도 무음 삼키지 않는다(audio 경로와 대칭).
            # best-effort 이므로 종료 API 는 계속 진행하되, 실패 트랜잭션은 정리한다.
            logger.exception("[session] video finalize failed (best-effort): %s", exc)
            db.rollback()
        try:
            from app.services import audio_service
            audio_service.finalize_on_session_end(s.id, db)
        except Exception as exc:
            # SDD-101: finalize는 best-effort(종료 API 500 방지)이나 예외를 삼키지 않고 로그로 남긴다.
            logger.exception("[session] audio finalize failed (best-effort): %s", exc)
        # SDD-209(B13): 종료 후 연구 동의 건을 내보내기 큐에 올린다(번들 생성·업로드는 cron 이 이어받는다, best-effort).
        from app.services import research_export_service

        research_export_service.on_session_completed(s.id, db)
        # SDD-086: 세션 종료 시 리포트 자동 생성 — counselor 1건 + participant별 client.
        # 리포트 생성은 audio_service.finalize_on_session_end 의 Celery chain(STT→요약→리포트)에서
        # 비동기 처리된다. 여기서는 동기 생성하지 않아 세션 종료 API 응답을 지연시키지 않는다.
    elif action == "cancel":
        # SDD-101 B3: cancel 시 진행 중이던 녹음·영상을 마감해 고아(orphan)를 막는다.
        _close_out_media_on_cancel(s, db)

    # SDD-026: 상태전이는 session_state_changed 이벤트로 발행(commit 후, best-effort)
    _notify_session_state(s)

    # SDD-093: S03/S05~S09 상태 전이 알림 발화 (대기열은 시작/일시정지/재개/종료 제외)
    _action_event = {
        "open": "session_opened",
        "start": "session_started",
        "end": "session_completed",
        "cancel": "session_cancelled",
    }
    event_type = _action_event.get(action)
    if event_type:
        _notify_participants_event(
            s, event_type, db,
            include_waitlisted=(action == "cancel"),
            title=session_terms.notification_title(event_type),
            body=s.title or session_terms.notification_body_fallback(),
        )

    return _with_chat_room(_serialize(s, include_participant_pii=True), s.id, db)


# SDD-100: open 상태 방치 세션 자동 취소 — 스테일 클래스 정리.
STALE_OPEN_SESSION_MAX_AGE_HOURS = 24


def sweep_stale_open_sessions(
    db: DBSession,
    *,
    max_age_hours: int = STALE_OPEN_SESSION_MAX_AGE_HOURS,
) -> list[str]:
    """open 상태로 일정 시간 방치된 세션을 자동 cancel 처리한다.

    - 대상: status == 'open' and is_template == False and opened_at <= now - max_age_hours
    - 전이: transition_status(..., 'cancel', db) 재사용 → 참가자 알림·이벤트·state_version 일관성 유지
    - 개별 세션 실패(host 삭제 등)는 try/except 로 격리해 스윕 전체를 중단시키지 않는다.

    반환: 취소 처리된 세션 id 목록.
    """
    now = _now()
    cutoff = now - timedelta(hours=max_age_hours)
    cancelled: list[str] = []

    candidates = (
        db.query(Session)
        .filter(
            Session.is_template.is_(False),
            Session.status == "open",
            Session.opened_at.is_not(None),
            Session.opened_at <= cutoff,
        )
        .all()
    )

    for s in candidates:
        try:
            # STATE-SWEEP-TOCTOU: 조회(open)와 전이 사이에 세션이 in_progress 등으로
            #   바뀌었을 수 있다. restrict_from={"open"} 로 출발 상태를 재검증해 CAS 에서
            #   차단되면(409) 취소하지 않는다 — 진행중 클래스를 잘못 취소하지 않도록.
            transition_status(str(s.id), str(s.host_id), "cancel", db, restrict_from={"open"})
            cancelled.append(str(s.id))
        except Exception as exc:
            # 호스트 삭제·동시 전이 등으로 실패한 건은 건너뛰고 다음 세션을 처리한다.
            # MB-ERR-011: 개별 실패를 조용히 삼키지 않고 로그로 남겨 스윕 누락을 진단 가능하게 한다.
            db.rollback()
            logger.warning(
                "[STALE-OPEN-SESSION] 세션 취소 실패 — 건너뜀: session_id=%s (%s)",
                s.id,
                exc,
            )
            continue

    return cancelled


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
    s = get_session_authorized(db, session_id, host_id, SessionAction.SESSION_NEW_RUN)
    _require_legacy_mutation(s,db)
    if s.status in _NON_RESTARTABLE_STATUSES:
        raise HTTPException(
            status_code=400,
            detail="완료·취소된 세션은 즉시 재시작할 수 없습니다. 새 세션을 생성하세요",
        )
    s.run_id = uuid.uuid4()
    db.commit()
    db.refresh(s)
    return _serialize(s, include_participant_pii=True)


def _notify_participants_event(
    s: Session,
    event_type: str,
    db: DBSession,
    *,
    recipient_ids: list | None = None,
    include_waitlisted: bool = False,
    title: str,
    body: str | None = None,
    params: dict | None = None,
) -> list[dict]:
    """세션 참여자에게 인앱 알림을 best-effort 로 발화하고 수신자별 **요청 결과**를 돌려준다.

    SDD-093 노티피케이션 재설계 — 이벤트 카탈로그(33종)의 세션 이벤트 발화 일원화.
    수신자 기본값: 호스트 제외 + (include_waitlisted=False 시) 대기열 제외.
    결과(SDD-209 B7): ``in_app`` = queued(알림 행·WS outbox 기록)/skipped(사용자 설정 꺼짐)/failed,
    ``email`` = queued(이메일 선호 켜짐 → outbox 요청)/not_requested/failed. **전달·수신 확인이 아니다.**
    """
    results: list[dict] = []
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
            if uid is None:
                continue  # 비회원은 계정이 없어 알림 대상이 아니다
            email_on = False
            try:
                email_on = notification_service.email_requested(event_type, uid, db)
                notif = notification_service.notify_event(
                    event_type,
                    uid,
                    {
                        "title": title,
                        "body": body,
                        "extra": build_standard_extra(
                            event_type,
                            target_type,
                            str(s.id),
                            params=params,
                            legacy={"session_id": str(s.id)},
                        ),
                    },
                    db,
                )
                results.append(
                    {
                        "user_id": str(uid),
                        "in_app": "queued" if notif is not None else "skipped",
                        "email": "queued" if email_on else "not_requested",
                    }
                )
            except Exception as exc:
                # MB-ERR-003: 알림 1건 실패를 무음 삼키지 않고 로깅 + 실패 트랜잭션 정리.
                logger.warning(
                    "[session] notify_event failed event=%s user=%s: %s", event_type, uid, exc
                )
                db.rollback()
                results.append(
                    {"user_id": str(uid), "in_app": "failed", "email": "failed" if email_on else "not_requested"}
                )
    except Exception as exc:
        # MB-ERR-003: best-effort 알림 발행 전체 실패도 로그로 남긴다.
        logger.warning("[session] notify participants event failed event=%s: %s", event_type, exc)
    return results


def _notify_session_state(s: Session) -> None:
    """session_state_changed 이벤트를 best-effort 로 발행한다(WS 루프 없으면 no-op).

    개선 10: 클래스가 진행 단계를 벗어나면(완료·취소) 재생 중인 가이드·BGM 을 회원 화면에서도
    멈춘다 — 상담사 브라우저가 닫혀 stop 명령이 오지 못한 경우의 안전망이다(재생 상태도 정리).
    """
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

        if s.status not in AUDIO_SYNC_SESSION_STATUSES:
            stop_payload = live.build_audio_sync_payload(str(s.id), "stop", None, 0.0)
            live.record_audio_state(str(s.id), stop_payload)
            live.notify_audio_sync(str(s.id), stop_payload)
    except Exception as exc:
        # MB-ERR-003: best-effort 이벤트 발행 실패를 로그로 남긴다(상태 변경은 유지).
        logger.warning("[session] session_state_changed 발행 실패 session=%s: %s", s.id, exc)


def _notify_participant_changed(s: Session, db: DBSession | None = None) -> None:
    """participant_changed 이벤트를 best-effort 로 발행한다(호스트 룸 전용).

    LIVE-05: 프론트(ClassPlayerPage/SessionDetailPage)가 event.participants 를 기대하므로
    활성 참여자 식별 정보 배열을 함께 실어 보낸다. 배열이 없으면 프론트 실시간 목록 갱신이
    죽은 코드가 되므로, participantsToMetrics 폴백과 동일한 SessionLiveMetric 형태로 채운다.
    """
    try:
        from app.ws import session_live_namespace as live

        participation = None
        if db is not None:
            from app.services.class_participation_service import lock_context, _expire, _now, build_snapshot
            s, locked_participants = lock_context(db, s.id)
            now = _now()
            _expire(db, s, now)
            participation = build_snapshot(db, s, locked_participants, now)
        active = [p for p in (s.participants or []) if not p.is_waitlisted]
        names: dict = {}
        if db is not None:
            from app.models.user import User

            uids = [p.user_id for p in active if p.user_id]
            if uids:
                for u in db.query(User).filter(User.id.in_(uids)).all():
                    names[u.id] = u.name

        participants = []
        for p in active:
            if p.user_id:
                display_name = names.get(p.user_id) or "참여자"
            else:
                display_name = p.guest_name or "게스트"
            participants.append(
                {
                    "participant_id": str(p.id),
                    "member_id": str(p.member_id) if p.member_id else None,
                    "attendance_status": p.attendance_status,
                    "entered_at": p.entered_at.isoformat() if p.entered_at else None,
                    "user_id": str(p.user_id) if p.user_id else None,
                    "display_name": display_name,
                    "is_guest": p.user_id is None,
                    "band_connected": p.band_connected,
                    "device_status": None,
                    "band_battery": p.band_battery,
                    "avg_efficiency": None,
                    "current_efficiency": None,
                    "upload_status": None,
                    "last_eeg_at": None,
                    "raise_hand": p.raise_hand,
                    "speaking": p.speaking,
                }
            )

        if participation is not None:
            by_id = {p['participant_id']: p for p in participation['participants']}
            participants = [{**p, **by_id[p['participant_id']]} for p in participants if p['participant_id'] in by_id]
        # 커밋으로 ORM이 만료되기 전에 식별자·본문·버전을 모두 같은 잠금에서 확정한다.
        session_id = str(s.id)
        payload = {
            "version": s.state_version or 0,
            "participation_version": participation['participation_version'] if participation else (s.participation_version or 0),
            "participant_count": len(participants),
            "waitlist_count": sum(1 for p in (s.participants or []) if p.is_waitlisted),
            "participants": participants,
        }
        if participation is not None:
            payload.update({key: participation[key] for key in ('generated_at', 'presence_ttl_seconds')})
            db.commit()
        live.notify_participant_changed(session_id, payload)
    except Exception as exc:
        # MB-ERR-003: best-effort 이벤트 발행 실패를 로그로 남긴다.
        logger.warning("[session] participant_changed 발행 실패 session=%s: %s", s.id, exc)


def _next_waitlist_position(s: Session, db: DBSession) -> int:
    """대기열 다음 순번 — DB 기준으로 조회해 캐시된 컬렉션 오염을 피한다."""
    rows = (
        db.query(SessionParticipant.waitlist_position)
        .filter(
            SessionParticipant.session_id == s.id,
            SessionParticipant.is_waitlisted.is_(True),
        )
        .all()
    )
    positions = [row[0] or 0 for row in rows]
    return (max(positions) + 1) if positions else 1


def _active_participant_count(s: Session, db: DBSession) -> int:
    """정원 판정용 active(대기열 제외) 인원 — 로드된 컬렉션 대신 DB 카운트로 센다."""
    return (
        db.query(func.count(SessionParticipant.id))
        .filter(
            SessionParticipant.session_id == s.id,
            SessionParticipant.is_waitlisted.is_(False),
        )
        .scalar()
        or 0
    )


def _has_capacity(s: Session, db: DBSession) -> bool:
    """FUNC-03: active(대기열 제외) 인원이 정원(max_participants) 미만인지 판정한다.

    정원 미설정(0/None)은 제한 없음으로 본다.
    """
    if not s.max_participants:
        return True
    return _active_participant_count(s, db) < s.max_participants


def _lock_session_for_capacity(s_id: UUID, db: DBSession) -> Session | None:
    """정원 검사~참여자 삽입 사이를 직렬화하기 위해 세션 행을 잠근다(CONC-CAPACITY-RACE).

    PostgreSQL 은 SELECT ... FOR UPDATE 로 같은 세션으로의 동시 입장을 직렬화한다.
    SQLite(테스트)는 FOR UPDATE 를 지원하지 않으므로 일반 조회로 폴백한다(단일 커넥션).
    """
    query = db.query(Session).filter(Session.id == s_id)
    bind = db.get_bind()
    if bind is not None and bind.dialect.name == "postgresql":
        query = query.with_for_update()
    return query.populate_existing().first()


def _waiting_participants(s: Session, db: DBSession) -> list[SessionParticipant]:
    """대기열(취소 제외 — ORM 필터가 거른다)을 순번 순으로 DB 에서 조회한다."""
    return (
        db.query(SessionParticipant)
        .filter(SessionParticipant.session_id == s.id, SessionParticipant.is_waitlisted.is_(True))
        .order_by(SessionParticipant.waitlist_position.asc().nulls_last(), SessionParticipant.joined_at.asc())
        .all()
    )


def _renumber_waitlist(s: Session, db: DBSession) -> None:
    """대기열 순번을 1..n 으로 다시 매긴다(취소·승격·제거 뒤 정렬)."""
    for idx, p in enumerate(_waiting_participants(s, db), start=1):
        if p.waitlist_position != idx:
            p.waitlist_position = idx
    db.flush()


def _can_join_active(s: Session, db: DBSession) -> bool:
    """신규/재입장자가 바로 활성이 될 수 있는지 — 정원 여유가 있고 앞선 대기자가 없을 때만(새치기 방지)."""
    return _has_capacity(s, db) and not _waiting_participants(s, db)


def _promote_waitlist_all(s: Session, db: DBSession) -> list[SessionParticipant]:
    """정원에 여유가 있는 만큼 대기열을 순번 순으로 승격하고 승격된 참여자 목록을 돌려준다(SDD-209 B6).

    취소자는 ORM 필터로 이미 제외된다. 호출 전에 세션 행 잠금을 잡아 취소·입장·정원 변경과 직렬화한다.
    """
    promoted: list[SessionParticipant] = []
    while _has_capacity(s, db):
        waiting = _waiting_participants(s, db)
        if not waiting:
            break
        head = waiting[0]
        head.is_waitlisted = False
        head.waitlist_position = None
        db.flush()
        promoted.append(head)
    if promoted:
        _renumber_waitlist(s, db)
    return promoted


def _notify_promoted(s: Session, promoted: list[SessionParticipant], db: DBSession) -> None:
    """승격 알림 — WS ``participant_promoted`` 는 대상 본인 룸에만, 회원에게는 인앱 알림도 보낸다(best-effort)."""
    if not promoted:
        return
    try:
        from app.ws import session_live_namespace as live

        for p in promoted:
            live.notify_participant_promoted(str(s.id), str(p.id), {"participant_id": str(p.id)})
    except Exception as exc:
        logger.warning("[session] participant_promoted 발행 실패 session=%s: %s", s.id, exc)
    member_ids = [p.user_id for p in promoted if p.user_id]
    if member_ids:
        _notify_participants_event(
            s, "session_waitlist_promoted", db,
            recipient_ids=member_ids,
            title=session_terms.notification_title("session_waitlist_promoted"),
            body=s.title or session_terms.notification_body_fallback(),
        )


def _reactivate_cancelled_or_removed(
    s: Session, p: SessionParticipant, db: DBSession
) -> SessionParticipant:
    """제거(removed_at)·대기 취소(waitlist_cancelled_at)된 행을 되살리고 입장 상태를 새로 계산한다.

    자리가 있고 앞선 대기자가 없을 때만 활성, 아니면 대기열 **끝** 순번(재대기).
    """
    p.removed_at = None
    p.waitlist_cancelled_at = None
    p.is_waitlisted = False
    p.waitlist_position = None
    db.flush()
    if not _can_join_active(s, db):
        p.is_waitlisted = True
        p.waitlist_position = _next_waitlist_position(s, db)
        db.flush()
    return p


def _revive_removed_participant(s: Session, uid: UUID, db: DBSession) -> SessionParticipant | None:
    """제거(removed_at)·대기 취소된 회원 참여자를 다시 입장/초대할 때 같은 행을 되살린다 (SDD-209 B1·B6).

    unique(session_id, user_id) 때문에 숨김 행이 남아 있으면 새 행을 만들 수 없다. 이력의 원본(EEG raw 등)은
    같은 행에 붙어 있으므로 행을 재사용하고 입장 상태는 새로 계산한다(재대기는 끝 순번). 되살릴 행이 없으면 None.
    """
    hidden = (
        db.query(SessionParticipant)
        .filter(
            SessionParticipant.session_id == s.id,
            SessionParticipant.user_id == uid,
            or_(
                SessionParticipant.removed_at.is_not(None),
                SessionParticipant.waitlist_cancelled_at.is_not(None),
            ),
        )
        .execution_options(include_removed=True)
        .first()
    )
    if hidden is None:
        return None
    return _reactivate_cancelled_or_removed(s, hidden, db)


def _invite_result(target_uuid: UUID, results: list[dict]) -> dict:
    """초대 응답의 ``invite_result`` — 참여자 등록(registered)과 알림 요청 결과(channels)를 분리한다.

    channels 값은 요청 결과일 뿐 전달·수신을 뜻하지 않는다(queued/skipped/failed/not_requested).
    """
    mine = next((r for r in results if r["user_id"] == str(target_uuid)), None)
    return {
        "registered": True,
        "user_id": str(target_uuid),
        "channels": {
            "in_app": mine["in_app"] if mine else "failed",
            "email": mine["email"] if mine else "not_requested",
        },
    }


def invite_participant(session_id: str, host_id: str, user_id: str, db: DBSession) -> dict:
    s = get_session_authorized(db, session_id, host_id, SessionAction.PARTICIPANT_INVITE)
    if s.status in ("completed", "cancelled"):
        raise HTTPException(status_code=400, detail="종료된 세션에는 초대할 수 없습니다")

    target_uuid = _to_uuid(user_id)

    # CONC-CAPACITY-RACE: 정원 검사~삽입 사이를 세션 행 잠금으로 직렬화한다.
    locked = _lock_session_for_capacity(s.id, db)
    if locked is not None:
        s = locked

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

    # SDD-209(B1): 제거된 참여자를 다시 초대하면 새 행 대신 제거 행을 되살린다(unique 충돌 방지).
    revived = _revive_removed_participant(s, target_uuid, db)
    if revived is not None:
        db.commit()
        db.refresh(s)
        results = _notify_participants_event(
            s, "session_invited", db,
            recipient_ids=[target_uuid],
            include_waitlisted=True,
            title=session_terms.notification_title("session_invited"),
            body=s.title or session_terms.notification_body_fallback(),
        )
        return {**_serialize(s, include_participant_pii=True), "invite_result": _invite_result(target_uuid, results)}

    # FUNC-03: 정원이 차 있으면(또는 앞선 대기자가 있으면) 대기열에 등록한다.
    if not _can_join_active(s, db):
        position = _next_waitlist_position(s, db)
        new_participant = SessionParticipant(
            session_id=s.id,
            user_id=target_uuid,
            is_waitlisted=True,
            waitlist_position=position,
        )
    else:
        new_participant = SessionParticipant(session_id=s.id, user_id=target_uuid)

    # CONC-DUP-JOIN-INVITE: 동시 초대 경합 — unique(session_id, user_id) 위반 시
    # IntegrityError(500) 대신 기존과 동일하게 409 로 멱등 응답한다.
    try:
        with db.begin_nested():
            db.add(new_participant)
    except IntegrityError:
        raise HTTPException(status_code=409, detail="이미 초대된 참여자입니다")

    db.commit()
    db.refresh(s)

    # SDD-093: S10 세션 초대 알림 — B7: 등록 성공과 알림 요청 결과를 분리해 응답한다.
    results = _notify_participants_event(
        s, "session_invited", db,
        recipient_ids=[target_uuid],
        include_waitlisted=True,
        title=session_terms.notification_title("session_invited"),
        body=s.title or session_terms.notification_body_fallback(),
    )

    return {**_serialize(s, include_participant_pii=True), "invite_result": _invite_result(target_uuid, results)}


def remove_participant(session_id: str, host_id: str, user_id: str, db: DBSession) -> dict:
    s = get_session_authorized(db, session_id, host_id, SessionAction.PARTICIPANT_REMOVE)
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
    # SDD-209(B1): 행 삭제는 FK CASCADE 로 EEG raw·지표·리포트를 영구 삭제한다 → 제거 시각만 기록한다.
    # 이후 모든 ORM 조회에서 제외되어 접근·정원·대기열 계산에서 빠진다.
    participant.removed_at = datetime.now(timezone.utc)
    participant.is_waitlisted = False
    participant.waitlist_position = None
    participant.speaking = False
    participant.raise_hand = False
    db.flush()
    db.refresh(s)

    promoted: list[SessionParticipant] = []
    if was_waitlisted and removed_position is not None:
        # 대기열에서 빠진 경우, 뒤 순번 당기기
        _renumber_waitlist(s, db)
    else:
        promoted = _promote_waitlist_all(s, db)

    db.commit()
    db.refresh(s)

    # SDD-093: S12 제거 알림
    _notify_participants_event(
        s, "session_participant_removed", db,
        recipient_ids=[target_uuid],
        include_waitlisted=True,
        title=session_terms.notification_title("session_participant_removed"),
        body=s.title or session_terms.notification_body_fallback(),
    )
    # SDD-093: S11 대기열 승격 알림 (+ B6: 대상에게만 WS participant_promoted)
    _notify_promoted(s, promoted, db)
    if promoted:
        _notify_participant_changed(s, db)

    return _serialize(s, include_participant_pii=True)


def add_marker(session_id: str, host_id: str, timestamp_sec: float, note: str, db: DBSession) -> dict:
    s = get_session_authorized(db, session_id, host_id, SessionAction.MARKER_ADD)
    if s.status != "in_progress":
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


def _session_not_open_detail(s: Session) -> dict:
    """SDD-231: 화면이 남은 시간을 보여 줄 수 있게 시작 예정 시각을 함께 싣는다(상태 코드·code 는 그대로)."""
    detail: dict = {"code": "session_not_open"}
    if s.scheduled_at is not None:
        detail["scheduled_at"] = s.scheduled_at.isoformat()
    return detail


def join_session(session_id: str, user_id: str, user_name: str, db: DBSession) -> dict:
    """세션 참여자 입장 처리 — 상태 전이 + WebRTC 룸 ID 생성 + LiveKit 토큰 발급"""
    s = get_session_authorized(db, session_id, user_id, SessionAction.SESSION_JOIN)
    if s.class_id:
        from app.services.class_write_service import lock_class_session
        from app.services.class_attendance_service import mark_entered, require_eligible
        parent, s = lock_class_session(db, s, user_id)
        if parent and parent.recurrence_rule and s.status not in ("open", "in_progress"):
            raise HTTPException(409, detail=_session_not_open_detail(s))
        entered = db.query(SessionParticipant).filter_by(session_id=s.id, user_id=_to_uuid(user_id)).first()
        if entered is not None:
            if s.status != "in_progress":
                raise HTTPException(400, detail="현재 세션에 입장할 수 없는 상태입니다")
            require_eligible(db, entered)
            from app.services.recording_consent_service import require_recording_consent
            require_recording_consent(entered)  # SDD-220(F1): 구 join 경로도 같은 동의 검증을 거친다
            if not s.webrtc_room_id:
                s.webrtc_room_id = uuid.uuid4()
            token = generate_livekit_token(str(s.webrtc_room_id), user_name, user_id)
            mark_entered(db, s, entered, _now())
            db.commit()
            _notify_participant_changed(s, db)
            result = _serialize(s)
            result["livekit_token"] = token
            return result

    # webrtc_room_id가 없으면 생성 (상태 전이와 분리해 먼저 확정)
    if not s.webrtc_room_id:
        s.webrtc_room_id = uuid.uuid4()
        db.commit()
        db.refresh(s)

    # SDD-101 B2: scheduled → in_progress 전이를 직접 대입(s.status=...) 대신 CAS UPDATE로.
    # 직접 대입은 started_at·state_version 기록을 우회해 종료 시 has_data 판정이 깨졌다(BUG-2).
    if s.status == "scheduled" and s.host_id == _to_uuid(user_id):
        now = _now()
        result = db.execute(
            update(Session)
            .where(Session.id == s.id, Session.status == "scheduled")
            .values(
                status="in_progress",
                state_version=(s.state_version or 0) + 1,
                started_at=case((Session.started_at.is_(None), now), else_=Session.started_at),
            )
        )
        if result.rowcount == 0:
            db.rollback()
            raise HTTPException(status_code=409, detail="상태가 이미 변경되었습니다")
        db.commit()
        db.refresh(s)
    elif s.status != "in_progress":
        raise HTTPException(status_code=400, detail="현재 세션에 입장할 수 없는 상태입니다")

    # SDD-209(B9): 로그인 회원이 이 경로로 들어오면 입장 시각도 남긴다(호스트는 참여자가 아니라 해당 없음).
    entered = (
        db.query(SessionParticipant)
        .filter(SessionParticipant.session_id == s.id, SessionParticipant.user_id == _to_uuid(user_id))
        .first()
    )
    if entered is not None:
        from app.services.recording_consent_service import require_recording_consent
        require_recording_consent(entered)  # SDD-220(F1)
    if entered is not None and entered.entered_at is None:
        entered.entered_at = _now()
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
    # SDD-209(B4): 4자리 숫자 코드만, 입장 가능한 활성 클래스만. 없는/형식오류/종료/취소/숨김은
    # 사유를 구분하지 않는 동일한 404 로 응답한다(정보 비노출). 과거 6자리 값은 입장되지 않는다.
    s = class_code_service.find_enterable_session(db, code)
    if not s:
        raise HTTPException(status_code=404, detail="클래스를 찾을 수 없습니다")
    return s


# ---------------------------------------------------------------------------
# SDD-209(B5a): 로그인 없는 4자리 코드 입장 + 입장 자격
# ---------------------------------------------------------------------------


def verify_entry_code(code: str, db: DBSession) -> dict:
    """코드 확인만 한다(참여자 생성 없음). 성공해도 제목·시각·진행자명 외에는 노출하지 않는다.

    없는/형식오류/종료/취소/숨김 코드는 사유 구분 없는 동일한 404 다.
    """
    s = _get_session_by_code(code, db)
    host = db.query(User).filter(User.id == s.host_id).first()
    return {"title": s.title, "scheduled_at": s.scheduled_at, "host_name": host.name if host else None}


def _enter_response(s: Session, participant: SessionParticipant | None, db: DBSession, *, is_guest: bool) -> dict:
    from app.services import entry_credential_service

    credential = expires_at = None
    if participant is not None:
        credential, expires_at = entry_credential_service.issue(participant)
    return {
        "entry_credential": credential,
        "expires_at": expires_at,
        "participant_id": str(participant.id) if participant is not None else None,
        "is_guest": is_guest,
        "is_waitlisted": bool(participant.is_waitlisted) if participant is not None else False,
        "eeg_collection_consented": participant.eeg_collection_consented if participant is not None else None,
        # 참여자 PII(성별·생년월일)는 입장 응답에 싣지 않는다.
        "session": _with_chat_room(_serialize(s, include_participant_pii=False), s.id, db),
    }


def _member_profile_pii(user_id: UUID, db: DBSession) -> tuple[str | None, date | None]:
    profile = db.query(ClientProfile).filter(ClientProfile.user_id == user_id).first()
    return (profile.gender, profile.birth_date) if profile else (None, None)


def _mark_entered(participant: SessionParticipant) -> None:
    """SDD-209(B9/BE-11): 최초 입장 시각을 한 번만 기록한다(재입장·복귀로 덮어쓰지 않는다)."""
    db = object_session(participant)
    session = db.get(Session, participant.session_id)
    from app.services.class_attendance_service import mark_entered
    mark_entered(db, session, participant, _now())


def _precheck_recording_consent(
    s: Session,
    db: DBSession,
    *,
    member_uid: UUID | None,
    entry_credential: str | None,
    granted: bool,
) -> None:
    """SDD-220(F1): 입장 처리(참여자 생성·멤버십·입장 자격) 이전에 회차별 녹음·녹화 동의를 확인한다.

    이번 요청에서 동의했거나, 이 회차의 본인 참여자 행에 동의가 이미 저장돼 있으면 통과한다.
    아니면 아무것도 쓰기 전에 403 RECORDING_CONSENT_REQUIRED 로 거부한다(다음 단계·자격·토큰 0).
    """
    from app.services import entry_credential_service
    from app.services.recording_consent_service import is_recorded, recording_required

    if granted:
        return
    existing: SessionParticipant | None = None
    if member_uid is not None:
        existing = (
            db.query(SessionParticipant)
            .filter(SessionParticipant.session_id == s.id, SessionParticipant.user_id == member_uid)
            .first()
        )
    elif entry_credential:
        try:
            existing = entry_credential_service.resolve_participant(db, entry_credential, s.id, include_cancelled=True)
        except HTTPException:
            existing = None
    if not is_recorded(existing):
        raise recording_required()


def _apply_entry_consents(
    db: DBSession,
    participant: SessionParticipant,
    *,
    recording_consent: bool | None,
    recording_notice_version: str | None,
    eeg_collection_consent: bool | None,
    eeg_notice_version: str | None,
) -> None:
    """입장 요청에 실린 동의를 참여자 행에 저장한다(커밋은 호출자). 뇌파 수집은 리포트/연구 선택과 별개로 기록한다."""
    from app.services import recording_consent_service as rcs

    if recording_consent and not rcs.is_recorded(participant):
        rcs.apply_recording_consent(participant, recording_notice_version)
    if eeg_collection_consent is not None:
        rcs.apply_eeg_choice(participant, eeg_collection_consent, eeg_notice_version)
    elif participant.eeg_collection_consented is None:
        # 첫 입장에서 따로 고르지 않았다 — 회원은 계정 설정값, 비회원은 미동의(true 로 추정하지 않는다).
        rcs.apply_eeg_choice(participant, rcs.account_eeg_consent(db, participant.user_id), None)


def _enter_resolved(
    s: Session,
    db: DBSession,
    *,
    user_id: str | None,
    name: str | None = None,
    gender: str | None = None,
    birth_date: date | None = None,
    email: str | None = None,
    entry_credential: str | None = None,
    require_invite: bool = False,
    recording_consent: bool | None = None,
    recording_notice_version: str | None = None,
    eeg_collection_consent: bool | None = None,
    eeg_notice_version: str | None = None,
) -> dict:
    """확인된 활성 클래스에 참여자를 만들거나 되살려 입장 자격과 함께 돌려준다."""
    from app.services import entry_credential_service

    member_uid = _to_uuid(user_id) if user_id else None
    if not (member_uid is not None and s.host_id == member_uid):
        _precheck_recording_consent(
            s, db, member_uid=member_uid, entry_credential=entry_credential, granted=bool(recording_consent)
        )
    consent_kwargs = dict(
        recording_consent=recording_consent,
        recording_notice_version=recording_notice_version,
        eeg_collection_consent=eeg_collection_consent,
        eeg_notice_version=eeg_notice_version,
    )
    membership=None
    pre_open=False  # SDD-231: 열리기 전 대기실 입장이면 출석(entered_at)을 남기지 않는다
    if s.class_id:
        parent=db.query(Class).filter_by(id=s.class_id).first()
        if parent and parent.recurrence_rule:
            from app.services.class_write_service import lock_class_session
            from app.services.session_authz import authorize_session
            from app.services.class_membership_service import invite_members
            parent,s=lock_class_session(db,s,member_uid)
            # SDD-231: 열리기 전이라도 허용 구간이면 대기실 입장은 받는다(미디어·출석은 열린 뒤).
            pre_open = s.status not in ("open","in_progress") and class_code_service.pre_open_entry_allowed(s)
            if s.status not in ("open","in_progress") and not pre_open:
                raise HTTPException(409,detail=_session_not_open_detail(s))
            if member_uid==s.host_id:
                authorize_session(db,member_uid,s,SessionAction.SESSION_JOIN)
            elif member_uid:
                actor=db.query(User).filter_by(id=member_uid).first()
                if not actor or actor.role!="client" or actor.status!="active":
                    raise HTTPException(403,detail={"code":"use_observation_endpoint"})
                invited_makeup=(parent.status=="completed" and s.session_kind=="makeup" and require_invite and
                    db.query(SessionParticipant).filter_by(session_id=s.id,user_id=member_uid).first() is not None)
                if require_invite and not invited_makeup:
                    # 직접 링크는 기존 초대 자격만 사용한다. 코드 가입보다 먼저 검사한다.
                    invited = db.query(SessionParticipant).filter_by(
                        session_id=s.id, user_id=member_uid
                    ).first()
                    existing_member = db.query(ClassMember).filter_by(
                        class_id=parent.id, user_id=member_uid, status="active"
                    ).first()
                    if invited is None or existing_member is None:
                        raise HTTPException(
                            status_code=403,
                            detail="초대받은 클래스가 아니에요. 클래스 코드로 입장해 주세요",
                        )
                if not invited_makeup:
                    membership=invite_members(db,parent,[member_uid],member_uid,_now(),via="code")[0]
    if s.class_id:
        from app.services.class_access_service import queue_live_reconcile
        queue_live_reconcile(db, s.class_id)
    promoted: list[SessionParticipant] = []
    if member_uid is not None and s.host_id == member_uid:
        if require_invite:
            raise HTTPException(status_code=403, detail="호스트는 참여자로 입장할 수 없어요")
        return _enter_response(s, None, db, is_guest=False)

    # CONC-CAPACITY-RACE: 정원 검사~삽입은 세션 행 잠금 하에서 직렬화한다.
    locked = _lock_session_for_capacity(s.id, db)
    if locked is not None:
        s = locked

    if member_uid is not None:
        _revive_removed_participant(s, member_uid, db)
        participant = (
            db.query(SessionParticipant)
            .filter(SessionParticipant.session_id == s.id, SessionParticipant.user_id == member_uid)
            .first()
        )
        if participant is None:
            if require_invite:
                raise HTTPException(
                    status_code=403,
                    detail="초대받은 클래스가 아니에요. 클래스 코드로 입장해 주세요",
                )
            has_room = _can_join_active(s, db)
            pii_gender, pii_birth = _member_profile_pii(member_uid, db)
            participant = SessionParticipant(
                session_id=s.id,
                user_id=member_uid,
                gender=pii_gender,
                birth_date=pii_birth,
                consent_eeg=True,
                is_waitlisted=not has_room,
                waitlist_position=_next_waitlist_position(s, db) if not has_room else None,
            )
            try:
                with db.begin_nested():
                    db.add(participant)
            except IntegrityError:  # 동시 입장 경합 — 먼저 커밋된 행을 재사용
                participant = (
                    db.query(SessionParticipant)
                    .filter(SessionParticipant.session_id == s.id, SessionParticipant.user_id == member_uid)
                    .first()
                )
                if participant is None:
                    raise
        if participant.is_waitlisted:
            # 재입장이 순번을 앞지르지 못한다 — 정원 여유가 있으면 대기열 앞에서부터 순서대로 승격한다.
            promoted = _promote_waitlist_all(s, db)
        if membership is not None:
            participant.member_id=membership.id
        _apply_entry_consents(db, participant, **consent_kwargs)
        if not pre_open:
            _mark_entered(participant)
        db.commit()
        db.refresh(s)
        _notify_participant_changed(s, db)
        _notify_promoted(s, [p for p in promoted if p.id != participant.id], db)
        return _enter_response(s, participant, db, is_guest=False)

    # ── 비회원: 개인정보 필수 ──
    clean_name = (name or "").strip()
    if not (clean_name and gender and birth_date and email):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="이름, 성별, 생년월일, 이메일을 모두 입력해 주세요",
        )
    clean_email = email.strip().lower()

    # 복귀: 입장 자격이 가리키는 본인 참여자만 되돌려 받는다(이름 일치로는 인계하지 않는다).
    participant = None
    if entry_credential:
        try:
            candidate = entry_credential_service.resolve_participant(
                db, entry_credential, s.id, include_cancelled=True
            )
        except HTTPException:
            candidate = None  # 만료·폐기·타 클래스 자격은 무시하고 새 참여자로 입장
        if candidate is not None:
            participant = candidate

    if participant is not None and participant.waitlist_cancelled_at is not None:
        # 대기 취소 후 재대기 — 같은 행을 되살려 대기열 끝에 둔다(B6).
        _reactivate_cancelled_or_removed(s, participant, db)
    if participant is None:
        has_room = _can_join_active(s, db)
        participant = SessionParticipant(
            session_id=s.id,
            user_id=None,
            guest_name=clean_name[:100],
            gender=gender,
            birth_date=birth_date,
            report_email=clean_email,
            consent_eeg=True,
            is_waitlisted=not has_room,
            waitlist_position=_next_waitlist_position(s, db) if not has_room else None,
        )
        db.add(participant)
    else:
        if participant.user_id is None:
            participant.guest_name = clean_name[:100]
            participant.gender = gender
            participant.birth_date = birth_date
            participant.report_email = clean_email
    db.flush()
    _apply_entry_consents(db, participant, **consent_kwargs)
    if participant.is_waitlisted:
        promoted = _promote_waitlist_all(s, db)
    if not pre_open:
        _mark_entered(participant)
    db.commit()
    db.refresh(s)
    _notify_participant_changed(s, db)
    _notify_promoted(s, [p for p in promoted if p.id != participant.id], db)
    return _enter_response(s, participant, db, is_guest=participant.user_id is None)


def enter_session(
    code: str,
    db: DBSession,
    *,
    user_id: str | None = None,
    name: str | None = None,
    gender: str | None = None,
    birth_date: date | None = None,
    email: str | None = None,
    entry_credential: str | None = None,
    recording_consent: bool | None = None,
    recording_notice_version: str | None = None,
    eeg_collection_consent: bool | None = None,
    eeg_notice_version: str | None = None,
) -> dict:
    """코드로 입장 — 로그인·초대 행 없이 가능. 성공 시 클래스/참여자 범위의 입장 자격을 발급한다."""
    s = _get_session_by_code(code, db)
    return _enter_resolved(
        s, db, user_id=user_id, name=name, gender=gender, birth_date=birth_date,
        email=email, entry_credential=entry_credential,
        recording_consent=recording_consent, recording_notice_version=recording_notice_version,
        eeg_collection_consent=eeg_collection_consent, eeg_notice_version=eeg_notice_version,
    )


def enter_session_as_invited(
    session_id: str,
    user_id: str,
    db: DBSession,
    *,
    recording_consent: bool | None = None,
    recording_notice_version: str | None = None,
    eeg_collection_consent: bool | None = None,
    eeg_notice_version: str | None = None,
) -> dict:
    """초대받은 로그인 회원의 편의 경로 — 초대 행이 있을 때만 코드 없이 입장한다(입장 조건이 아님)."""
    sid = _to_uuid(session_id)
    s = db.query(Session).filter(Session.id == sid, Session.is_template.is_(False)).first()
    if not s:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")
    if s.status in _CLOSED_STATUSES:
        raise HTTPException(status_code=409, detail="종료된 클래스에는 입장할 수 없어요")
    return _enter_resolved(
        s, db, user_id=user_id, require_invite=True,
        recording_consent=recording_consent, recording_notice_version=recording_notice_version,
        eeg_collection_consent=eeg_collection_consent, eeg_notice_version=eeg_notice_version,
    )


def revoke_entry_credential(entry_credential: str | None, db: DBSession) -> None:
    """로그아웃/폐기 — 이 참여자의 기존 입장 자격을 모두 무효화한다."""
    from app.services import entry_credential_service

    participant = entry_credential_service.resolve_participant(db, entry_credential)
    entry_credential_service.revoke(db, participant)


def participant_livekit_token(
    session_id: str,
    db: DBSession,
    *,
    entry_credential: str | None = None,
    current_user_id: str | None = None,
    participant_id: str | None = None,
) -> dict:
    """회원/비회원 참여자의 LiveKit 토큰 발급 (SDD-209 B5b — 코드가 아니라 입장 자격/로그인으로 소유 검증).

    can_publish 규칙: 온라인 세션이면서 1:1 이거나, 그룹이면 max_participants ≤ 20 일 때만 송신 허용.
    그 외(오프라인, 온라인 그룹 20명 초과)는 구독 전용(can_publish=False).
    호스트는 ``POST /{session_id}/livekit-token`` 을 쓴다(참가자 자격으로는 호스트 토큰을 못 받는다).
    """
    sid = _to_uuid(session_id)
    s = db.query(Session).filter(Session.id == sid).first()
    if not s:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")
    participant = resolve_participant_actor(
        sid, db, entry_credential=entry_credential, current_user_id=current_user_id,
        participant_id=participant_id,
    )
    from app.services.class_attendance_service import require_eligible
    require_eligible(db, participant, allow_excused=False)
    # SDD-220(F1): 회차 녹음·녹화 동의가 저장된 참여자에게만 토큰을 발급한다.
    from app.services.recording_consent_service import require_recording_consent
    require_recording_consent(participant)
    # LIVE-04: 완료/취소된 세션에서는 토큰을 발급하지 않는다.
    if s.status in _CLOSED_STATUSES:
        raise HTTPException(status_code=400, detail="종료된 세션입니다")
    # SDD-231: 열리기 전 대기실 입장자는 회차가 열릴 때까지 미디어 토큰을 받지 못한다.
    if s.class_id and s.status in ("ready", "scheduled"):
        raise HTTPException(status_code=409, detail=_session_not_open_detail(s))
    if not s.webrtc_room_id:
        raise HTTPException(status_code=400, detail="아직 상담사 화상이 시작되지 않았습니다")

    # AUTHZ-WAITLIST-SPEAKING: 대기열(waitlisted) 참여자는 아직 입장 허용되지 않았으므로
    #   LiveKit(음성 송수신) 토큰을 발급하지 않는다 — 정원 초과 대기자의 매체 접근 차단.
    if participant.is_waitlisted:
        raise HTTPException(status_code=403, detail="대기 중인 참여자입니다")

    name = participant.guest_name
    if not name and participant.user_id:
        user = db.query(User).filter(User.id == participant.user_id).first()
        name = user.name if user else None
    name = name or "참여자"

    # SDD-094: 발언권 기반 송신 규칙 — 온라인 + (1:1 상시 또는 그룹≤20 & speaking=True).
    can_publish = _compute_can_publish(s, participant)

    # SDD-231: 열리기 전 사전 입장자는 입장 시각·출석이 비어 있다 — 실제 라이브 입장(토큰 발급)에서 최초 1회 기록한다.
    if s.class_id and participant.entered_at is None:
        from app.services.class_attendance_service import mark_entered
        mark_entered(db, s, participant, _now())
        db.commit()
        _notify_participant_changed(s, db)

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


def get_entry_state(
    session_id: str,
    db: DBSession,
    *,
    entry_credential: str | None = None,
    current_user_id: str | None = None,
) -> dict:
    """참여자 본인의 클래스 상태 (SDD-209 B5b / BE-9) — 입장 자격/로그인으로 소유 검증.

    대기→진행 전이 감지, 본인 밴드 상태·최신 지표, 채팅 가능 여부, 대기열 여부, 본인 리포트 선택을 돌려준다.
    종료·취소 클래스도 읽을 수 있다(FM09/FM10). 타인 정보와 참가자 목록은 포함하지 않는다.
    """
    sid = _to_uuid(session_id)
    s = db.query(Session).filter(Session.id == sid).first()
    if not s:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")
    p = resolve_participant_actor(
        sid, db, entry_credential=entry_credential, current_user_id=current_user_id,
        allow_completed=True
    )
    # SDD-023/026: 본인 최신 EEG feature 윈도우 (없으면 null). LIMIT 1 헬퍼로 최신 1건만 조회.
    latest = eeg_query.latest_feature_window(db, s.id, p.id)
    sq = latest.signal_quality if latest else None
    device_status = _device_status_live(sq, latest.created_at, _now()) if latest else "unknown"
    return {
        "session_id": str(s.id),
        "participant_id": str(p.id),
        "status": s.status,
        "guest_state": (
            "meditation" if s.status == "in_progress"
            else "complete" if s.status == "completed"
            else "cancelled" if s.status == "cancelled"
            else "waiting"
        ),
        "version": s.state_version or 0,
        "in_progress": s.status == "in_progress",
        "ended": s.status in _CLOSED_STATUSES,
        "participant_state": _participant_log_state(s.status),
        "is_waitlisted": bool(p.is_waitlisted),
        "report_included": bool(p.report_included),
        "started_at": s.started_at,
        "ended_at": s.ended_at,
        "band_connected": p.band_connected,
        "device_status": device_status,
        "signal_state": _signal_state_from_signal(sq),
        "band_battery": p.band_battery,
        "relaxation_index": latest.relaxation_index if latest else None,
        "focus_index": latest.focus_index if latest else None,
        "stress_index": latest.stress_index if latest else None,
        "signal_quality": sq,
        "last_eeg_at": latest.created_at if latest else None,
        "chat_enabled": bool(s.chat_enabled),
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


_WAITLIST_CANCELLED_DETAIL = "대기를 취소했어요. 다시 대기하려면 코드로 입장해 주세요"


def _find_cancelled_participant(
    sid: UUID,
    db: DBSession,
    *,
    entry_credential: str | None,
    current_user_id: str | None,
) -> SessionParticipant | None:
    """본인이 대기 취소한 참여자 행(취소 멱등 처리·접근 거부 사유 구분용). 없으면 None."""
    from app.services import entry_credential_service

    if current_user_id:
        row = (
            db.query(SessionParticipant)
            .filter(
                SessionParticipant.session_id == sid,
                SessionParticipant.user_id == _to_uuid(current_user_id),
                SessionParticipant.waitlist_cancelled_at.is_not(None),
                SessionParticipant.removed_at.is_(None),
            )
            .execution_options(include_removed=True)
            .first()
        )
        if row is not None:
            return row
    if entry_credential:
        try:
            row = entry_credential_service.resolve_participant(
                db, entry_credential, sid, include_cancelled=True
            )
        except HTTPException:
            return None
        if row.waitlist_cancelled_at is not None:
            return row
    return None


def cancel_waitlist(
    session_id: str,
    db: DBSession,
    *,
    entry_credential: str | None = None,
    current_user_id: str | None = None,
) -> dict:
    """대기 취소(SDD-209 B6 / BE-6) — 본인만, 멱등, 행 삭제 없음.

    - 정원 변경 경로(입장·승격·정원 증가)와 **같은 세션 행 잠금**을 먼저 잡고 처리한다.
    - 활성 참가자의 요청은 대기 취소로 처리하지 않는다(409). 종료·취소 클래스도 409.
    - 취소자는 ORM 필터로 정원·순번·승격·토큰·상태 접근에서 제외되고, 뒤 순번은 한 칸씩 당겨진다.
    - 같은 요청 재호출은 changed=False 로 200(멱등).
    """
    sid = _to_uuid(session_id)
    s = db.query(Session).filter(Session.id == sid).first()
    if not s:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")
    if s.status in _CLOSED_STATUSES:
        raise HTTPException(status_code=409, detail="종료된 클래스에서는 대기를 취소할 수 없어요")
    locked = _lock_session_for_capacity(s.id, db)
    if locked is not None:
        s = locked

    try:
        participant = resolve_participant_actor(
            sid, db, entry_credential=entry_credential, current_user_id=current_user_id
        )
    except HTTPException as exc:
        participant = _find_cancelled_participant(
            sid, db, entry_credential=entry_credential, current_user_id=current_user_id
        )
        if participant is None:
            raise exc

    if participant.waitlist_cancelled_at is not None:
        return {"participant_id": str(participant.id), "cancelled": True, "changed": False}
    if not participant.is_waitlisted:
        raise HTTPException(status_code=409, detail="이미 입장한 참여자는 대기 취소를 할 수 없어요")

    participant.waitlist_cancelled_at = _now()
    participant.waitlist_position = None
    participant.raise_hand = False
    participant.speaking = False
    db.flush()
    _renumber_waitlist(s, db)
    db.commit()
    db.refresh(s)
    _notify_participant_changed(s, db)
    return {"participant_id": str(participant.id), "cancelled": True, "changed": True}


def resolve_participant_actor(
    sid: UUID,
    db: DBSession,
    *,
    entry_credential: str | None,
    current_user_id: str | None,
    participant_id: str | None = None,
    allow_completed: bool = False,
) -> SessionParticipant:
    """소유권 통합(SDD-209 B5b) — 요청 주체의 본인 참여자 행을 확정한다.

    우선순위: ① 로그인 회원(access 토큰) → 이 클래스의 본인 행 ② 입장 자격(헤더/페이로드).
    ``participant_id`` 를 함께 주면 확정된 본인 행과 같아야 한다(대리 요청 403).
    아무 증명이 없으면 401 — **코드·participant_id 단독은 인증 수단이 아니다**(AZ8).
    로그인했지만 이 클래스 참여자가 아니면 403(호스트는 참여자 행이 없어 거부된다).
    """
    from app.services import entry_credential_service

    participant = None
    if current_user_id:
        participant = (
            db.query(SessionParticipant)
            .filter(
                SessionParticipant.session_id == sid,
                SessionParticipant.user_id == _to_uuid(current_user_id),
            )
            .first()
        )
    if participant is None and entry_credential:
        try:
            participant = entry_credential_service.resolve_participant(db, entry_credential, sid)
        except HTTPException as exc:
            if exc.status_code == 401 and _find_cancelled_participant(
                sid, db, entry_credential=entry_credential, current_user_id=current_user_id
            ):
                raise HTTPException(status_code=403, detail=_WAITLIST_CANCELLED_DETAIL)
            raise
    if participant is None:
        if current_user_id and _find_cancelled_participant(
            sid, db, entry_credential=None, current_user_id=current_user_id
        ):
            raise HTTPException(status_code=403, detail=_WAITLIST_CANCELLED_DETAIL)
        if current_user_id:
            raise HTTPException(status_code=403, detail="세션 참가자만 요청할 수 있습니다")
        raise HTTPException(
            status_code=401, detail="입장 자격이 필요해요. 코드를 다시 입력해 주세요."
        )
    if participant_id:
        try:
            explicit = _to_uuid(participant_id)
        except HTTPException:
            raise HTTPException(status_code=403, detail="본인 참여자만 요청할 수 있습니다")
        if participant.id != explicit:
            raise HTTPException(status_code=403, detail="본인 참여자만 요청할 수 있습니다")
    from app.services.class_attendance_service import require_eligible
    require_eligible(db, participant, allow_completed=allow_completed)
    return participant


def _authorize_participant_access(
    participant: SessionParticipant,
    db: DBSession,
    *,
    entry_credential: str | None,
    current_user_id: str | None,
) -> None:
    """이미 조회한 참여자 행의 소유자(로그인 회원 또는 입장 자격 보유자)만 통과시킨다."""
    resolve_participant_actor(
        participant.session_id,
        db,
        entry_credential=entry_credential,
        current_user_id=current_user_id,
        participant_id=str(participant.id),
    )


def set_report_choice(
    session_id: str,
    participant_id: str,
    report_included: bool,
    db: DBSession,
    *,
    notice_acknowledged: bool = False,
    notice_version: str | None = None,
    entry_credential: str | None = None,
    current_user_id: str | None = None,
) -> dict:
    """SDD-209(B2/BE-2): 리포트 반영 선택(포함/제외)을 기록한다.

    - 본인 참여자만(회원 로그인 / 입장 자격). 호스트·타인은 403, 자격 없으면 401.
    - 종료·취소 클래스는 409. 같은 값 재요청은 멱등(이력 추가 없음).
    - 고지 확인(notice_acknowledged)은 선택 이력과 분리해 참여자 행에 시각/버전으로 남긴다.
    - 입장·업로드·리포트 생성은 이 선택의 성공 여부와 무관하다(기본 제외로 진행).
    """
    sid = _to_uuid(session_id)
    from app.services.class_member_consent_service import lock_session_choice
    s = lock_session_choice(db,sid,current_user_id)
    if not s:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")
    if s.status in ("completed", "cancelled"):
        raise HTTPException(status_code=409, detail="종료된 클래스에서는 리포트 반영 선택을 바꿀 수 없습니다")

    participant = _get_participant_in_session(sid, participant_id, db)
    _authorize_participant_access(
        participant, db, entry_credential=entry_credential, current_user_id=current_user_id
    )

    if notice_acknowledged and (notice_version not in ("r5-1", "class-team-v1") or
            (notice_version=="class-team-v1" and s.type!="meditation")):
        raise HTTPException(422,detail={"code":"invalid_notice_version"})

    if s.class_id:
        participant.report_consent_override = True
    previous = bool(participant.report_included)
    changed = previous != report_included
    if changed:
        db.add(
            ReportChoiceEvent(
                session_id=sid,
                participant_id=participant.id,
                previous_included=previous,
                new_included=report_included,
                actor_kind="self",
                actor_user_id=participant.user_id,
            )
        )
        participant.report_included = report_included
    if notice_acknowledged:
        participant.report_notice_ack_at = _now()
        participant.report_notice_version = notice_version
    if s.class_id:
        from app.services.class_access_service import queue_live_reconcile
        queue_live_reconcile(db, s.class_id)
    db.commit()
    db.refresh(participant)
    if changed:
        # SDD-209(B3): 이미 만들어진 리포트 산출물(스냅샷)을 새 반영 범위로 재생성/무효화한다.
        from app.services import report_service

        report_service.refresh_reports_after_choice_change(sid, participant.id, db)
    return {
        "participant_id": str(participant.id),
        "report_included": participant.report_included,
        "report_notice_ack_at": participant.report_notice_ack_at,
        "report_notice_version": participant.report_notice_version,
        "changed": changed,
    }


def raise_hand(
    session_id: str,
    participant_id: str,
    db: DBSession,
    *,
    entry_credential: str | None = None,
    current_user_id: str | None = None,
) -> dict:
    """SDD-094: 참여자 손들기 — raise_hand=True 로 표시하고 호스트/본인에게 통지한다.

    참여자 본인(로그인) 또는 입장 자격 소유자만 가능하다.
    """
    sid = _to_uuid(session_id)
    s = db.query(Session).filter(Session.id == sid).first()
    if not s:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")
    # LIVE-04: 완료/취소된 세션에서는 발언권 상태를 변경할 수 없다.
    if s.status in ("completed", "cancelled"):
        raise HTTPException(status_code=400, detail="종료된 세션입니다")

    participant = _get_participant_in_session(sid, participant_id, db)
    _authorize_participant_access(
        participant, db, entry_credential=entry_credential, current_user_id=current_user_id
    )

    # AUTHZ-WAITLIST-SPEAKING: 대기열 참여자는 아직 좌석이 없어 발언 요청(손들기)을 할 수 없다.
    if participant.is_waitlisted:
        raise HTTPException(status_code=403, detail="대기 중인 참여자는 손을 들 수 없습니다")

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


def lower_hand(
    session_id: str,
    participant_id: str,
    db: DBSession,
    *,
    entry_credential: str | None = None,
    current_user_id: str | None = None,
) -> dict:
    """참여자 손 내리기(손들기 취소) — raise_hand=False 로 바꾸고 호스트/본인에게 통지한다.

    raise_hand 와 같은 인가(본인 로그인 또는 입장 자격)·종료 세션 검사를 적용한다.
    이미 내려가 있으면 멱등 성공(통지 없음). 발언 중(speaking) 상태는 건드리지 않는다.
    """
    sid = _to_uuid(session_id)
    s = db.query(Session).filter(Session.id == sid).first()
    if not s:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")
    if s.status in ("completed", "cancelled"):
        raise HTTPException(status_code=400, detail="종료된 세션입니다")

    participant = _get_participant_in_session(sid, participant_id, db)
    # SDD-235: 진행자(set_speaking 과 같은 인가)는 다른 참여자의 손도 내릴 수 있다.
    #   진행자가 아니면 기존 본인(로그인/입장 자격) 인가로 폴백 — 타인·비진행자는 403.
    if _is_speaking_manager(s, current_user_id, db):
        lowered_by = "host"
    else:
        _authorize_participant_access(
            participant, db, entry_credential=entry_credential, current_user_id=current_user_id
        )
        lowered_by = "self"

    if participant.raise_hand:
        participant.raise_hand = False
        db.commit()
        db.refresh(participant)
        _notify_speaking_changed(sid, participant)

    return {
        "participant_id": str(participant.id),
        "raise_hand": participant.raise_hand,
        "speaking": participant.speaking,
        "can_publish": _compute_can_publish(s, participant),
        "lowered_by": lowered_by,
    }


def _is_speaking_manager(s: Session, user_id: str | None, db: DBSession) -> bool:
    """set_speaking 과 같은 진행자 판정 — 세션 호스트 + LIVE_METRICS_READ 인가 통과.

    호스트가 아니면 False. 호스트인데 인가 거부면 authorize_session 의 예외를 그대로 올린다.
    """
    if not user_id or s.host_id != _to_uuid(user_id):
        return False
    from app.services.session_authz import authorize_session

    authorize_session(db, user_id, s, SessionAction.LIVE_METRICS_READ)
    return True


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
    # LIVE-04: 완료/취소된 세션에서는 발언권을 부여/해제할 수 없다.
    if s.status in ("completed", "cancelled"):
        raise HTTPException(status_code=400, detail="종료된 세션입니다")
    if s.host_id != _to_uuid(host_id):
        raise HTTPException(status_code=403, detail="발언권은 상담사만 부여/해제할 수 있습니다")

    from app.services.session_authz import authorize_session
    authorize_session(db,host_id,s,SessionAction.LIVE_METRICS_READ)
    participant = _get_participant_in_session(sid, participant_id, db)

    # AUTHZ-WAITLIST-SPEAKING: 대기열 참여자는 아직 입장 전이므로 발언권을 부여할 수 없다
    #   (입장 허용 전에 speaking=True 로 송출 권한이 새는 것을 막는다).
    if participant.is_waitlisted:
        raise HTTPException(status_code=409, detail="대기 중인 참여자에게는 발언권을 부여할 수 없습니다")

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
    except Exception as exc:
        # MB-ERR-003: 이벤트 발행 실패가 상태 변경 성공을 되돌려서는 안 되지만, 무음 삼키지 않는다.
        logger.warning("[session] speaking_changed 발행 실패 session=%s: %s", sid, exc)


# ---------------------------------------------------------------------------
# 개선 5: 무음 시그널(비언어적 상태 신호) — 발신자 검증
# ---------------------------------------------------------------------------

# 상태 신호 유형 — "잘 따라가요 / 조금 어려워요 / 잠시 쉴게요"
QUIET_SIGNAL_TYPES: tuple[str, ...] = ("following", "difficult", "resting")

# 시그널을 받을 수 있는(진행 단계) 세션 상태 — 대기실(open)·진행·일시정지
QUIET_SIGNAL_SESSION_STATUSES: tuple[str, ...] = ("open", "in_progress")


def resolve_signal_sender(
    session_id: str,
    participant_id: str | None,
    current_user_id: str | None,
    db: DBSession,
    *,
    entry_credential: str | None = None,
) -> dict:
    """무음 시그널 발신자를 검증한다 (EEG 동의와 무관, SDD-209 B5b: 입장 자격 소유권 통합).

    - 로그인 회원은 본인 참가자 행으로만, 비로그인은 입장 자격으로만 발신한다.
    - participant_id 단독(자격 없음)은 인증 수단이 아니다(401). 타인 participant_id 는 403.
    - 세션 없음 404.

    반환: {"participant_id": str, "display_name": str, "status": str}
    (상태 신호는 DB 에 저장하지 않는 휘발성 값이다 — 호스트 화면 표시용 메타만 만든다.)
    """
    sid = _to_uuid(session_id)
    s = db.query(Session).filter(Session.id == sid).first()
    if not s:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")

    participant = resolve_participant_actor(
        sid, db, entry_credential=entry_credential, current_user_id=current_user_id,
        participant_id=participant_id,
    )

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
# 개선 10: 명상 가이드·BGM 재생 제어 발신자 검증 (class:audio_sync)
# ---------------------------------------------------------------------------

# 재생 제어를 허용하는(진행 단계) 세션 상태 — 대기실(open)·진행·일시정지
AUDIO_SYNC_SESSION_STATUSES: tuple[str, ...] = ("open", "in_progress")


def resolve_audio_sync_host(
    session_id: str,
    current_user_id: str | None,
    db: DBSession,
) -> dict:
    """class:audio_sync 발신자를 검증한다 — 재생 제어는 세션 호스트(상담사)만 가능하다.

    회원·게스트가 올린 재생 제어는 브로드캐스트하면 안 되므로(아무나 남의 클래스
    가이드·BGM 을 멈추거나 바꾸는 것을 차단), 여기서 호스트 여부를 서버가 판정한다.

    - 세션 없음 404 / 미인증 403 / 호스트 아님 403.

    반환: {"session_id": str, "status": str}
    """
    sid = _to_uuid(session_id)
    s = db.query(Session).filter(Session.id == sid).first()
    if not s:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")
    if not current_user_id:
        raise HTTPException(status_code=403, detail="상담사만 재생을 제어할 수 있습니다")
    if s.host_id != _to_uuid(current_user_id):
        raise HTTPException(status_code=403, detail="상담사만 재생을 제어할 수 있습니다")
    from app.services.session_authz import authorize_session
    authorize_session(db,current_user_id,s,SessionAction.AUDIO_RECORD)
    return {"session_id": str(sid), "status": s.status}


# ---------------------------------------------------------------------------
# SDD-021: 클래스 시작 프로세스 1.0 패리티
# ---------------------------------------------------------------------------


def _participant_log_state(status: str) -> str:
    """세션 상태에서 참가자 진행 상태(1.0 SessionLog 상태)를 파생한다.

    참가자 단위 상태 저장은 Phase 2 이므로, 현재는 세션 상태를 그대로 매핑한다.
    """
    if status == "completed":
        return "COMPLETED"
    if status == "in_progress":
        return "STARTED"
    return "READY"


def get_live_metrics(session_id: str, host_id: str, db: DBSession) -> dict:
    """호스트 전용 실시간 모니터링 데이터.

    SDD-023: LINK BAND 실연동 — EEGFeatureWindow 최신 윈도우를 조회해 두뇌휴식도
    (relaxation_index)·연결상태(device_status)·신호품질(quality)을 실값으로 반환한다.
    feature 가 없으면(미착용/미수집) 기존 placeholder(null/unknown/idle) 동작을 유지한다.
    band_connected 는 기존 SessionParticipant 필드를 그대로 사용한다.
    """
    s = get_session_authorized(db, session_id, host_id, SessionAction.LIVE_METRICS_READ)
    # 모니터링 대상은 active 참가자만 (대기열 제외)
    active = [p for p in (s.participants or []) if not p.is_waitlisted]

    # 로그인 참가자 표시 이름을 한 번의 쿼리로 확보 (게스트는 guest_name 사용)
    from app.models.user import User

    user_ids = [p.user_id for p in active if p.user_id]
    names: dict = {}
    profiles: dict[UUID, ClientProfile] = {}
    if user_ids:
        for u in db.query(User).filter(User.id.in_(user_ids)).all():
            names[u.id] = u.name
        profiles = {
            profile.user_id: profile
            for profile in db.query(ClientProfile).filter(ClientProfile.user_id.in_(user_ids)).all()
        }

    log_state = _participant_log_state(s.status)
    # 참가자별 EEG feature 집계(최신 윈도우 + 평균 두뇌휴식도)
    stats = _aggregate_window_stats(s.id, [p.id for p in active], db)

    metrics = []
    contact_fail = 0
    device_fail = 0
    band_low = 0
    for p in active:
        display_name = names.get(p.user_id) if p.user_id else p.guest_name
        profile = profiles.get(p.user_id) if p.user_id else None
        gender = p.gender or (profile.gender if profile else None)
        birth_date = p.birth_date or (profile.birth_date if profile else None)
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
            heart_rate = None
            respiratory_rate = None
            rmssd = None
        else:
            device_status = st["device_status"]
            signal_quality = st["signal_quality"]
            signal_state = st["signal_state"]
            avg_efficiency = st["avg_relaxation"]
            current_efficiency = st["current_relaxation"]
            # SDD-026: staleness(disconnected)면 업로드가 지연/중단된 상태로 표기한다.
            upload_status = "delayed" if device_status == "disconnected" else "streaming"
            last_eeg_at = st["last_eeg_at"]
            heart_rate = st["heart_rate"]
            respiratory_rate = st["respiratory_rate"]
            rmssd = st["rmssd"]
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
                "gender": gender,
                # REST와 호스트 소켓 스냅샷 모두 JSON으로 전달한다.
                "birth_date": birth_date.isoformat() if birth_date else None,
                "concerns": list(profile.concerns or []) if profile else [],
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
                # SDD-xxx: 몸 지표(BPM·호흡수·HRV) 최신값 — 호스트 4초 폴링이 WS 패치를 덮지 않도록 포함.
                "heart_rate": heart_rate,
                "respiratory_rate": respiratory_rate,
                "rmssd": rmssd,
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
        "access_code": class_code_service.display_code(object_session(s), s),
        # WS-SNAPSHOT-METRICS-KEY: join 스냅샷 소비자 계약이 'metrics'(백엔드 내부 핸들러)와
        #   'participants'(프론트 SessionLiveJoinSnapshot)로 갈려 있어 둘 다 노출한다.
        #   REST(/live-metrics)는 response_model 이 'metrics' 만 남기므로 무영향.
        "metrics": metrics,
        "participants": metrics,
        # DashboardBox 4종 집계 — 접촉/단절/저전력을 분리 파생
        "summary": {
            "participant_count": len(metrics),
            "contact_fail_count": contact_fail,
            "device_fail_count": device_fail,
            "band_low_count": band_low,
        },
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


def completed_participant_state(session_id, user_id, participant_id, db, *, entry_credential=None):
    """수료로 활동 자격이 끝난 본인에게만 종료·오디오 정리용 최소 상태를 반환한다."""
    from app.services import entry_credential_service

    session = db.query(Session).filter_by(id=_to_uuid(session_id)).first()
    if session is None or session.status not in _CLOSED_STATUSES or not session.class_id:
        return None
    participant = None
    if user_id:
        actor = db.query(User).filter_by(id=_to_uuid(user_id), status="active").first()
        if actor is None:
            return None
        participant = db.query(SessionParticipant).filter_by(
            session_id=session.id, user_id=actor.id, id=_to_uuid(participant_id)
        ).first()
    elif entry_credential:
        try:
            participant = entry_credential_service.resolve_participant(db, entry_credential, session.id)
        except HTTPException:
            return None
        if str(participant.id) != str(participant_id):
            return None
    if (participant is None or not participant.member_id or participant.is_waitlisted
            or participant.entered_at is None or participant.removed_at
            or participant.waitlist_cancelled_at or participant.superseded_by_participant_id
            or participant.attendance_status == "withdrawn"):
        return None
    member = db.get(ClassMember, participant.member_id)
    canonical = db.get(ClassMember, member.canonical_member_id or member.id) if member else None
    parent = db.get(Class, session.class_id)
    if canonical is None or canonical.status != "completed" or parent is None or parent.status != "completed":
        return None
    return {
        "session_id": str(session.id), "status": session.status,
        "version": session.state_version or 0,
        "started_at": session.started_at.isoformat() if session.started_at else None,
        "ended_at": session.ended_at.isoformat() if session.ended_at else None,
    }


def resolve_live_join(
    session_id: str,
    user_id: str | None,
    participant_id: str | None,
    db: DBSession,
    *,
    entry_credential: str | None = None,
) -> dict | None:
    """/session-live join 권한을 판정하고 역할별 snapshot 을 만든다.

    - 호스트(세션 소유자): role="host" + 전체 모니터링 snapshot(허용 참가자 목록·집계).
    - 회원/게스트 참가자: role="participant" + 본인 전용 snapshot.
    - 비인가(세션 없음/비참가자/신원 불일치/자격 없음·만료·폐기): None → 호출측이 거부 처리.

    SDD-209(B5b): 비회원은 **입장 자격**으로만 증명한다(participant_id 단독 불가). participant_id 를 함께
    주면 자격이 가리키는 본인과 같아야 한다.
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

    if uid is not None:
        from app.services.class_access_service import can_observe,observer_snapshot
        if can_observe(db,uid,s):
            return {"role":"observer","participant_id":None,"snapshot":observer_snapshot(s)}

    # 참가자(회원/비회원)
    try:
        participant = resolve_participant_actor(
            sid, db, entry_credential=entry_credential,
            current_user_id=str(uid) if uid is not None else None,
            participant_id=participant_id,
        )
    except HTTPException:
        participant = None

    from app.services.class_attendance_service import eligible_participant
    if participant is None or not eligible_participant(db, participant, allow_excused=False):
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

    값이 없으면(null) 판정 불가이므로 'unknown' 으로 둔다 — 'valid' 로 승격하지 않는다.
    report 게이트(report_task)가 quality == 'valid' 개수로 reliability/coverage 를
    계산하므로, null 을 valid 로 세면 품질이 과대평가된다(0 치환 금지).
    """
    if signal_quality is None:
        return "unknown"
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

    SDD-138: 매 4초 폴링마다 세션 전체 윈도우를 Python 으로 로드하던 것을 DB 집계로 이관한다.
    - 평균 두뇌휴식도는 SQL AVG(참가자별 GROUP BY)로 구하고,
    - MB2-ORM-N1-02: 최신 윈도우는 참가자마다 LIMIT 1 을 개별 호출(N회 쿼리)하지 않고
      창 함수(ROW_NUMBER PARTITION BY participant_id) 단일 쿼리로 참가자 전체의 최신 1건을
      한 번에 뽑아 참가자 수와 무관하게 쿼리 수를 상수로 고정한다.
    """
    if not participant_ids:
        return {}

    from sqlalchemy import func

    from app.models.eeg_feature import EEGFeatureWindow

    # (1) 참가자별 평균 두뇌휴식도 — null 제외 평균은 SQL AVG 와 동일 의미
    avg_rows = {
        pid: avg
        for pid, avg in db.query(
            EEGFeatureWindow.participant_id, func.avg(EEGFeatureWindow.relaxation_index)
        )
        .filter(
            EEGFeatureWindow.session_id == session_id,
            EEGFeatureWindow.participant_id.in_(participant_ids),
            EEGFeatureWindow.relaxation_index.isnot(None),
        )
        .group_by(EEGFeatureWindow.participant_id)
        .all()
    }

    # (2) 참가자 전체의 최신 윈도우 1건씩을 단일 쿼리로 일괄 조회.
    #     정렬은 latest_feature_window 와 동일(created_at DESC, window_index DESC).
    latest_by_participant = eeg_query.feature_windows_chronological_for_participants(
        db, session_id, participant_ids, limit=1, newest_first=True,
    )

    now = _now()
    result: dict = {}
    for pid in participant_ids:
        windows = latest_by_participant.get(pid)
        if not windows:
            continue
        latest = windows[0]
        raw_avg = avg_rows.get(pid)
        avg_relaxation = round(float(raw_avg), 4) if raw_avg is not None else None
        result[pid] = {
            "current_relaxation": latest.relaxation_index,
            "avg_relaxation": avg_relaxation,
            # SDD-026: 접촉/연결(device_status)과 신호품질(SQI)을 분리해 반환한다.
            "signal_quality": latest.signal_quality,
            "signal_state": _signal_state_from_signal(latest.signal_quality),
            "device_status": _device_status_live(latest.signal_quality, latest.created_at, now),
            "last_eeg_at": latest.created_at,
            # SDD-xxx: 몸 지표(BPM·호흡수·HRV) 최신값 — 호스트 4초 폴링이 WS 패치를 덮지 않도록 포함.
            "heart_rate": latest.heart_rate,
            "respiratory_rate": latest.respiratory_rate,
            "rmssd": latest.rmssd,
        }
    return result


def _assert_upload_eligible(participant: SessionParticipant) -> None:
    """업로드 자격 게이트 — 소유 참여자 + 대기열 여부만 본다.

    - 대기열(is_waitlisted) 참가자는 아직 세션에 실입장하지 않았으므로 스트리밍 불가.
    - SDD-209(B2/P2): 업로드는 ``consent_eeg`` 에 의존하지 않는다. 거부(리포트 제외)는 원본 수집
      중지가 아니라 리포트 반영 제외이므로, 소유 참여자라면 리포트 선택·동의 값과 무관하게 업로드한다.
      ``consent_audio/consent_eeg`` 컬럼과 그 의미는 그대로 유지된다(내보내기 게이트 등).
    """
    if participant.is_waitlisted:
        raise HTTPException(status_code=403, detail="대기열 참가자는 EEG 데이터를 업로드할 수 없습니다")


def resolve_upload_participant(
    sid: UUID,
    participant_id: str | None,
    current_user_id: str | None,
    db: DBSession,
    *,
    entry_credential: str | None = None,
) -> SessionParticipant:
    """업로드 소유 참가자를 확인한다 (REST 배치 + WS 실시간 공유 로직).

    SDD-209(B5b) 소유권 통합 — 로그인 회원은 본인 행으로, 비회원은 **입장 자격**으로만 업로드한다.
    - 명시 participant_id 는 확정된 본인 행과 같아야 한다 → 타인 대리 업로드 403.
    - 자격 없이 participant_id 만 보내면 401(코드/식별자 단독은 인증 수단이 아니다).
    호스트는 참가자 행이 아니므로 업로드 대상이 아니다(403).
    """
    participant = resolve_participant_actor(
        sid, db, entry_credential=entry_credential, current_user_id=current_user_id,
        participant_id=participant_id,
    )
    _assert_upload_eligible(participant)
    # SDD-220: 뇌파 수집을 거부한 참여자는 리포트 반영과 무관하게 EEG 업로드(REST·WS)를 받지 않는다.
    from app.services.recording_consent_service import assert_eeg_upload_allowed
    assert_eeg_upload_allowed(participant)
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
    return len(_persist_feature_items(sid, participant, features, db))


def _persist_feature_items(
    sid: UUID,
    participant: SessionParticipant,
    features: list[EEGFeatureItem],
    db: DBSession,
) -> list[EEGFeatureItem]:
    """저장에 성공한 항목만 반환해 중복 입력의 미저장 값이 라이브로 발행되지 않게 한다."""
    # SDD-026: 멱등 키를 (play_group_id, window_index) 로 확장한다.
    # pause/resume 으로 second_offset 이 0 부터 재시작해도 실행 세그먼트(play_group_id)가 다르면
    # 별개 키가 되어 skip 되지 않는다(데이터 보존). 레거시(play_group_id=None)는 기존과 동일 동작.
    # SDD-111: 참가자 누적 전체 키 로드(O(T²)) 대신 현재 배치 window_index만 조회한다.
    # dedup 키 (play_group_id, second_offset) 검사는 현재 배치 second_offset에만 필요하므로
    # (session_id, participant_id, window_index) 복합 인덱스를 타는 범위 조회로 O(배치)로 줄인다.
    batch_offsets = {f.second_offset for f in features}
    existing_keys = {
        (pg, idx)
        for (pg, idx) in db.query(
            EEGFeatureWindow.play_group_id, EEGFeatureWindow.window_index
        )
        .filter(
            EEGFeatureWindow.session_id == sid,
            EEGFeatureWindow.participant_id == participant.id,
            EEGFeatureWindow.window_index.in_(batch_offsets),
        )
        .all()
    }

    saved: list[EEGFeatureItem] = []
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
            total_neural_activity=getattr(f, "total_neural_activity", None),
            faa=getattr(f, "faa", None),
            source_feature_alias=getattr(f, "source_feature_alias", None),
            algorithm_version=getattr(f, "algorithm_version", None),
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
            saved.append(f)
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
        # WS-CONTRACT-DEVICE-VERSION: 프론트 DeviceStatusChangedEvent 는 version(number, 필수)을
        #   요구한다. 세션 상태 버전을 함께 실어 보낸다(누락 시 프론트 파서가 이벤트를 버린다).
        state_version = (
            db.query(Session.state_version).filter(Session.id == sid).scalar() or 0
        )
        _notify_device_status(sid, participant, version=state_version)

    return saved


def _notify_device_status(
    sid: UUID, participant: SessionParticipant, *, version: int | None = None
) -> None:
    """device_status_changed 이벤트를 best-effort 로 발행한다(WS 루프 없으면 no-op)."""
    try:
        from app.ws import session_live_namespace as live

        live.notify_device_status_changed(
            str(sid),
            {
                "participant_id": str(participant.id),
                "band_connected": participant.band_connected,
                "band_battery": participant.band_battery,
                # WS-CONTRACT-DEVICE-VERSION: 상태 계약 버전 — 프론트 필수 필드.
                "version": version if version is not None else 0,
            },
        )
    except Exception as exc:
        # MB-ERR-003: 이벤트 발행 실패가 저장 성공을 되돌려서는 안 되지만, 무음 삼키지 않는다.
        logger.warning("[session] device_status_changed 발행 실패 session=%s: %s", sid, exc)


def _has_newer_feature(
    sid: UUID,
    participant_id,
    latest: EEGFeatureItem,
    db: DBSession,
) -> bool:
    """주어진 feature(방금 저장했거나 재전송된 값)보다 더 새로운 EEGFeatureWindow 가 이미 있는가.

    REST 5초 배치와 WS 1초 실시간이 공유하는 '과거값 되돌림 방지' 가드.
    더 새로운 창이 이미 저장돼 있으면 실시간 발행을 생략해, 뒤늦게 도착한 과거 feature 가
    상담사 화면을 과거 값으로 되돌리지 않게 한다.
    """
    newer = db.query(EEGFeatureWindow.id).filter(
        EEGFeatureWindow.session_id == sid,
        EEGFeatureWindow.participant_id == participant_id,
    )
    if latest.timestamp is not None:
        newer = newer.filter(EEGFeatureWindow.device_timestamp_ms > latest.timestamp)
    else:
        # 레거시 입력은 실행 세그먼트 내 순서만 비교할 수 있다.
        newer = newer.filter(
            EEGFeatureWindow.play_group_id == latest.play_group_id,
            EEGFeatureWindow.window_index > latest.second_offset,
        )
    return newer.first() is not None


def ingest_features(
    session_id: str,
    payload,
    db: DBSession,
    *,
    current_user_id: str | None = None,
    entry_credential: str | None = None,
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

    participant = resolve_upload_participant(
        sid, payload.participant_id, current_user_id, db, entry_credential=entry_credential
    )
    saved_features = _persist_feature_items(sid, participant, payload.features, db)
    saved = len(saved_features)
    # WS가 끊겨 REST 폴백만 성공해도 상담사의 참가자 카드와 그룹 집계를 갱신한다.
    # WS로 이미 저장된 재전송은 발행하지 않아 과거 배치로 실시간 표시가 되돌아가지 않게 한다.
    if saved:
        from app.ws import session_live_namespace as live

        latest = max(
            saved_features,
            key=lambda feature: (feature.timestamp is not None, feature.timestamp or 0, feature.second_offset),
        )
        # 더 새로운 창이 이미 있으면(WS가 앞서 저장) 발행을 생략 — 과거 배치로 실시간 표시가
        # 되돌아가지 않게 한다(WS on_feature 와 동일한 newer 가드).
        if not _has_newer_feature(sid, participant.id, latest, db):
            live.notify_session_eeg(
                str(sid),
                {
                    "participant_id": str(participant.id),
                    "feature": latest.model_dump(),
                    "saved": saved,
                },
            )
    return {"session_id": str(sid), "saved": saved}


def report_choice_summary(session_id: str, host_id: str, db: DBSession) -> dict:
    """SDD-209(B9/BE-12): 시작 확인 시트용 익명 집계 — 리포트 제외 인원 수만(개별 선택·이름 비노출). 호스트 전용.

    대기열 밖 참여자 중 입장 기록(entered_at)이 있는 클래스에서는 입장한 참여자만 센다(report_scope 와 같은 규칙).
    녹음 시작을 막는 값이 아니라 표시용이다.
    """
    from app.services import report_scope

    s = get_session_authorized(db, session_id, host_id, SessionAction.REPORT_CHOICE_SUMMARY_READ)
    scope = report_scope.scope_for_session(s.id, db)
    return {
        "included": len(scope.included_ids),
        "excluded": len(scope.excluded_ids),
        "total": len(scope.included_ids) + len(scope.excluded_ids),
    }
