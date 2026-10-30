"""세션 접근 판정 단일 모듈 (SDD-211 Phase 0 / TD1).

흩어져 있던 호스트 판정 헬퍼 9곳(6개 파일)을 한 곳으로 모은다. 응답(상태코드·detail·에러 우선순위)은
기존 헬퍼와 바이트 동일해야 하므로 판정은 "액션별 정책"으로 표현한다.

- 에러 우선순위: 400(ID 형식) → 404(세션 없음) → 403(권한) → 409(기관 비활성).
- role(org_admin·platform_admin) 우회는 **없다**. 호스트가 아니면 누구든 403 (권한 확대 금지).
  Phase 3 에서 "진행 강사 포함" 이 필요해지면 HOST 규칙을 이 모듈 한 곳에서만 바꾼다.
- 세션 조회는 반드시 ``db.query(Session).filter(...)`` 를 쓴다. ``db.get`` 은 ORM 전역 숨김 필터
  (``Session.hidden_at IS NULL`` 등, ``core/database.py``)를 우회할 수 있어 쓰지 않는다.
- ``session_service`` 를 import 하지 않는다(순환 방지). 기관 검사는 함수 내부 지연 import.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session as DBSession

from app.models.session import Session, SessionParticipant
from app.models.user import User


class SessionAction(str, Enum):
    """현행 호출 지점 단위 액션. 정책(문구·기관 검사)이 호출 지점마다 달라서 이 단위로 둔다."""

    # 계열 B — 호스트 전용 + 기관 활성 검사(409)
    SESSION_UPDATE = "session_update"
    SESSION_DELETE = "session_delete"
    SESSION_TRANSITION = "session_transition"
    SESSION_NEW_RUN = "session_new_run"
    SESSION_DUPLICATE = "session_duplicate"
    SESSION_SAVE_TEMPLATE = "session_save_template"
    SESSION_CHAT_TOGGLE = "session_chat_toggle"
    PARTICIPANT_INVITE = "participant_invite"
    PARTICIPANT_REMOVE = "participant_remove"
    PARTICIPANT_REMIND = "participant_remind"
    MARKER_ADD = "marker_add"
    LIVE_METRICS_READ = "live_metrics_read"
    EEG_ROLLUP_READ = "eeg_rollup_read"
    LIVEKIT_TOKEN_ISSUE = "livekit_token_issue"
    REPORT_CHOICE_SUMMARY_READ = "report_choice_summary_read"
    RESEARCH_CONSENT_SUMMARY_READ = "research_consent_summary_read"
    # 계열 A — 호스트 전용, 기관 검사 없음
    RECORD_UPDATE = "record_update"
    AUDIO_RECORD = "audio_record"
    VIDEO_RECORD = "video_record"
    REPORT_GENERATE = "report_generate"
    # 계열 C — 호스트 전용, 문구 상이(이메일 초대)
    EMAIL_INVITE_MANAGE = "email_invite_manage"
    # 계열 D — 호스트 또는 참여자
    SESSION_VIEW = "session_view"
    SESSION_CHAT_ROOM_VIEW = "session_chat_room_view"
    SESSION_JOIN = "session_join"
    RECORD_VIEW = "record_view"
    TRANSCRIPT_VIEW = "transcript_view"
    REPORT_STATUS_VIEW = "report_status_view"
    RECORD_SUBSCRIBE = "record_subscribe"


class Rule(str, Enum):
    HOST = "host"
    HOST_OR_PARTICIPANT = "host_or_participant"


@dataclass(frozen=True)
class ActionPolicy:
    rule: Rule
    deny_detail: str
    require_active_org: bool = False
    # 이메일 초대 헬퍼만 세션 조회 전에 요청자 id 형식(400)까지 검사했다 — 그 순서를 보존한다.
    validate_actor_before_lookup: bool = False


DENY_HOST_ONLY = "host 코치만 가능합니다"
DENY_EMAIL_INVITE = "호스트만 초대할 수 있습니다"
DENY_NO_ACCESS = "접근 권한이 없습니다"

_HOST_ORG = ActionPolicy(Rule.HOST, DENY_HOST_ONLY, require_active_org=True)
_HOST = ActionPolicy(Rule.HOST, DENY_HOST_ONLY)
_MEMBER = ActionPolicy(Rule.HOST_OR_PARTICIPANT, DENY_NO_ACCESS)

POLICIES: dict[SessionAction, ActionPolicy] = {
    SessionAction.SESSION_UPDATE: _HOST_ORG,
    SessionAction.SESSION_DELETE: _HOST_ORG,
    SessionAction.SESSION_TRANSITION: _HOST_ORG,
    SessionAction.SESSION_NEW_RUN: _HOST_ORG,
    SessionAction.SESSION_DUPLICATE: _HOST_ORG,
    SessionAction.SESSION_SAVE_TEMPLATE: _HOST_ORG,
    SessionAction.SESSION_CHAT_TOGGLE: _HOST_ORG,
    SessionAction.PARTICIPANT_INVITE: _HOST_ORG,
    SessionAction.PARTICIPANT_REMOVE: _HOST_ORG,
    SessionAction.PARTICIPANT_REMIND: _HOST_ORG,
    SessionAction.MARKER_ADD: _HOST_ORG,
    SessionAction.LIVE_METRICS_READ: _HOST_ORG,
    SessionAction.EEG_ROLLUP_READ: _HOST_ORG,
    SessionAction.LIVEKIT_TOKEN_ISSUE: _HOST_ORG,
    SessionAction.REPORT_CHOICE_SUMMARY_READ: _HOST_ORG,
    SessionAction.RESEARCH_CONSENT_SUMMARY_READ: _HOST_ORG,
    SessionAction.RECORD_UPDATE: _HOST,
    SessionAction.AUDIO_RECORD: _HOST,
    SessionAction.VIDEO_RECORD: _HOST,
    SessionAction.REPORT_GENERATE: _HOST,
    SessionAction.EMAIL_INVITE_MANAGE: ActionPolicy(
        Rule.HOST, DENY_EMAIL_INVITE, validate_actor_before_lookup=True
    ),
    SessionAction.SESSION_VIEW: _MEMBER,
    SessionAction.SESSION_CHAT_ROOM_VIEW: _MEMBER,
    SessionAction.SESSION_JOIN: _MEMBER,
    SessionAction.RECORD_VIEW: _MEMBER,
    SessionAction.TRANSCRIPT_VIEW: _MEMBER,
    SessionAction.REPORT_STATUS_VIEW: _MEMBER,
    SessionAction.RECORD_SUBSCRIBE: _MEMBER,
}


def _to_uuid(value: str | UUID) -> UUID:
    try:
        return UUID(str(value))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="잘못된 ID 형식입니다")


def authorize_session(
    db: DBSession, user_id: str | UUID, session: Session, action: SessionAction
) -> Session:
    """이미 로드한 세션에 대해 판정만 한다. 통과하면 같은 세션을 돌려준다."""
    policy = POLICIES[action]
    uid = _to_uuid(user_id)
    actor = db.query(User).filter(User.id==uid).first()
    if actor and (actor.status!="active" or actor.role=="org_admin"):
        raise HTTPException(403,detail=policy.deny_detail)
    if session.class_id:
        from app.models.class_program import Class
        from app.services.class_access_service import can_read_team_material
        from app.services.class_instructor_service import validate_instructor
        cls=db.query(Class).filter(Class.id==session.class_id).first()
        if session.host_id!=uid and action in (SessionAction.RECORD_VIEW,SessionAction.REPORT_STATUS_VIEW):
            if can_read_team_material(db,uid,session):
                return session
        if session.host_id==uid and cls and cls.recurrence_rule:
            historical_read=session.status=="completed" and action in (
                SessionAction.RECORD_VIEW,SessionAction.TRANSCRIPT_VIEW,SessionAction.REPORT_STATUS_VIEW,
                SessionAction.SESSION_VIEW)
            if not historical_read:
                validate_instructor(db,cls,uid,session.id)
                if session.host_state=="needs_reassign":
                    raise HTTPException(409,detail={"code":"host_reassignment_required"})
    if session.host_id != uid:
        if policy.rule is Rule.HOST:
            raise HTTPException(status_code=403, detail=policy.deny_detail)
        is_participant = (
            db.query(SessionParticipant)
            .filter(SessionParticipant.session_id == session.id, SessionParticipant.user_id == uid)
            .first()
        )
        if not is_participant:
            raise HTTPException(status_code=403, detail=policy.deny_detail)
        return session
    if policy.require_active_org:
        _require_active_host_org(db, session)
    return session


def get_session_authorized(
    db: DBSession, session_id: str | UUID, user_id: str | UUID, action: SessionAction
) -> Session:
    """세션 로드(400/404) + 판정(403/409). 기존 `_get_*` 헬퍼 1:1 대체."""
    policy = POLICIES[action]
    sid = _to_uuid(session_id)
    if policy.validate_actor_before_lookup:
        _to_uuid(user_id)
    session = db.query(Session).filter(Session.id == sid).first()
    if not session:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")
    return authorize_session(db, user_id, session, action)


def _require_active_host_org(db: DBSession, session: Session) -> None:
    """계열 B 전용 — 호스트 소속 기관과 세션 기관이 활성인지 확인한다(비활성이면 409, 기관 행 잠금)."""
    from app.services.org_management_service import require_active_org, require_active_user_org

    host = db.get(User, session.host_id)
    if host:
        require_active_user_org(host, db)
    if session.organization_id:
        require_active_org(session.organization_id, db)
