"""SDD-188: 내담자 AI 비서 예약 사전 노티 — 대상 선정·메시지 구성·정정 안내.

기존 SDD-097 리마인더(참여코드·준비물 안내, 인앱+이메일)와는 **병행**한다(D7). 이쪽은
대화형 CTA 를 붙인 AI 비서 메시지이며 목적이 다르다.

발송 시점 규칙 (plan.md 설계 결정표)
- 기본 offset: 180분 전, 60분 전
- 정상 창: 남은 시간 ∈ (offset-2분, offset] 이면 발송
- 보정(서버 중단 복구): 창을 놓쳤으면 offset 이후에도 한 번만 발송.
  단 바닥선 아래로는 보내지 않는다 — 60분 노티는 시작 10분 전까지, 180분 노티는
  60분 노티가 담당하는 구간(남은 60분 이내)에 들어오면 중단한다(이중 안내 방지).
- 멱등: `agent_delivery_logs` UNIQUE(kind, ref_id, offset_min, user_id)
- 변경/취소: 발송 직전 상태·일정을 재조회. 이미 안내한 시각이 바뀌면 정정 안내 1회.

사실 정보(시각·장소·상담사 이름)는 모두 DB 값을 템플릿에 그대로 채운다. LLM 을 쓰지 않는다.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy.orm import Session as DBSession

from app.models.session import Session, SessionParticipant
from app.models.user import User
from app.services import agent_policy, agent_service

logger = logging.getLogger(__name__)

# 기본 사전 안내 시점(분). 180 = 3시간 전, 60 = 1시간 전.
DEFAULT_OFFSETS: tuple[int, ...] = (180, 60)

# 정상 발송 창 폭(분) — 매 1분 cron 이 한 틱을 놓쳐도 잡히도록 2분으로 둔다.
WINDOW_WIDTH_MIN = 2

# offset 별 보정 발송 바닥선(남은 분). 이 값 이하로 임박하면 해당 노티는 보내지 않는다.
CATCHUP_FLOOR_MIN: dict[int, int] = {180: 60, 60: 10}

# 노티 kind ↔ offset 매핑 (AgentMessage.kind 계약)
OFFSET_KINDS: dict[int, str] = {180: "reminder_3h", 60: "reminder_1h"}

# 스윕 대상 세션 조회 범위·상한
SWEEP_LOOKAHEAD_HOURS = 48
SWEEP_LIMIT = 200

# 사전 안내를 보내는 세션 상태
ELIGIBLE_STATUSES: tuple[str, ...] = ("scheduled", "ready", "open")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _ensure_aware(dt: datetime) -> datetime:
    """naive 입력을 UTC 로 간주한다 — reminder_service._ensure_aware 와 동일 규약."""
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def _minute_epoch(dt: datetime) -> int:
    """분 단위 epoch — 정정 안내의 멱등 키(같은 변경에 1회)로 쓴다."""
    return int(_ensure_aware(dt).timestamp() // 60)


# ---------------------------------------------------------------------------
# 대상 선정
# ---------------------------------------------------------------------------


def is_eligible_session(session: Session) -> bool:
    """사전 안내 대상 세션인지 — 1:1 예약 세션만."""
    if session.is_template:
        return False
    if session.scheduled_at is None:
        return False
    if session.status not in ELIGIBLE_STATUSES:
        return False
    # 그룹 세션은 본 SDD 범위 밖(타 참가자 노출 위험·묶음 알림은 후속).
    if session.participant_mode == "group":
        return False
    return True


def target_users(session: Session, db: DBSession) -> list[User]:
    """알림 대상 — active 참여자(대기열 제외) 중 활성 내담자 계정.

    같은 내담자가 중복 참여 행을 가져도 1명으로 모은다.
    """
    rows = (
        db.query(User)
        .join(SessionParticipant, SessionParticipant.user_id == User.id)
        .filter(
            SessionParticipant.session_id == session.id,
            SessionParticipant.user_id.is_not(None),
            SessionParticipant.is_waitlisted.is_(False),
            User.role == "client",
            User.status == "active",
        )
        .all()
    )
    seen: set[UUID] = set()
    users: list[User] = []
    for user in rows:
        if user.id in seen:
            continue
        seen.add(user.id)
        users.append(user)
    return users


def due_offsets(session: Session, now: datetime | None = None) -> list[int]:
    """지금 발송해야 할 offset 목록 — 정상 창 또는 보정 구간에 든 것."""
    if session.scheduled_at is None:
        return []
    now = now or _now()
    remaining_min = (_ensure_aware(session.scheduled_at) - now).total_seconds() / 60.0

    due: list[int] = []
    for offset in DEFAULT_OFFSETS:
        floor_min = CATCHUP_FLOOR_MIN.get(offset, 0)
        # 정상 창: (offset - 2, offset]
        in_window = (offset - WINDOW_WIDTH_MIN) < remaining_min <= offset
        # 보정 구간: 창을 놓친 뒤 바닥선까지. 로그 UNIQUE 로 1회만 나간다.
        in_catchup = floor_min < remaining_min <= (offset - WINDOW_WIDTH_MIN)
        if in_window or in_catchup:
            due.append(offset)
    return due


# ---------------------------------------------------------------------------
# 메시지 본문 — DB 값만 사용
# ---------------------------------------------------------------------------


def _offset_label(offset_min: int) -> str:
    if offset_min % 60 == 0:
        return f"{offset_min // 60}시간"
    return f"{offset_min}분"


def build_reminder_content(facts: dict, offset_min: int) -> str:
    """사전 안내 본문 — 상담사 이름·시각·장소를 DB 값 그대로 담는다.

    주소가 없으면 장소 문장 자체를 생략한다(TS5: "정보 없음" 문구를 쓰지 않는다).
    """
    lines = [
        f"{facts['counselor_name']} 선생님과의 {facts['type_label']} 일정이 "
        f"{_offset_label(offset_min)} 뒤에 있어요.",
        "",
        f"· 일시: {facts['scheduled_text']} (약 {facts['duration_min']}분)",
    ]
    if facts.get("location_type") == "online":
        lines.append("· 진행: 온라인 (시간에 맞춰 입장해 주세요)")
    elif facts.get("location_address"):
        lines.append(f"· 장소: {facts['location_address']}")

    if facts.get("linkband_mode") == "required":
        lines.append("· LINK BAND 를 미리 착용하고 전원을 켜 주세요.")
    elif facts.get("linkband_mode") == "optional":
        lines.append("· LINK BAND 는 선택이에요. 착용하지 않아도 상담은 그대로 진행돼요.")

    lines.append("")
    lines.append("준비가 어려우시면 아래에서 알려 주세요.")
    return "\n".join(lines)


def build_schedule_changed_content(facts: dict, previous_text: str | None) -> str:
    """일정 정정 안내 — 이전에 안내한 시각이 바뀌었음을 알린다."""
    lines = [
        f"{facts['counselor_name']} 선생님과의 {facts['type_label']} 일정이 변경되었어요.",
        "",
    ]
    if previous_text:
        lines.append(f"· 변경 전: {previous_text}")
    lines.append(f"· 변경 후: {facts['scheduled_text']} (약 {facts['duration_min']}분)")
    if facts.get("location_type") == "online":
        lines.append("· 진행: 온라인")
    elif facts.get("location_address"):
        lines.append(f"· 장소: {facts['location_address']}")
    lines.append("")
    lines.append("앞서 보낸 안내는 지난 일정 기준이었어요. 새 일정으로 확인해 주세요.")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# 발송
# ---------------------------------------------------------------------------


def send_reminder(
    session: Session, user: User, offset_min: int, db: DBSession
) -> bool:
    """한 수신자에게 특정 시점 사전 안내 1건 발송. 중복이면 False."""
    kind = OFFSET_KINDS.get(offset_min)
    if kind is None:
        return False

    facts = agent_policy.session_facts(session, db)
    scheduled_at = facts["scheduled_at"]
    # 로그를 먼저 선점한 실행만 발송한다(동시 실행 방어).
    claimed = agent_service.claim_delivery(
        db,
        kind=kind,
        ref_id=session.id,
        offset_min=offset_min,
        user_id=user.id,
        payload={"announced_at": scheduled_at.isoformat() if scheduled_at else None},
    )
    if not claimed:
        return False

    agent_service.post_agent_message(
        db,
        user.id,
        kind=kind,
        content=build_reminder_content(facts, offset_min),
        cta=agent_service.build_session_ctas(db, facts, user.id),
        ref_type="session",
        ref_id=session.id,
        commit=True,
    )
    return True


def send_schedule_changed(session: Session, user: User, db: DBSession) -> bool:
    """일정 변경 정정 안내 — 이미 안내를 받은 수신자에게만, 같은 변경에 1회."""
    if session.scheduled_at is None:
        return False

    announced = _announced_at(db, session, user)
    if announced is None:
        # 아직 안내를 받지 않은 수신자에게는 정정할 것이 없다.
        return False
    if _same_instant(announced, session.scheduled_at):
        return False

    facts = agent_policy.session_facts(session, db)
    # 멱등 키 = 새 예약 시각(분 epoch). 다시 변경되면 새 키로 한 번 더 안내한다.
    claimed = agent_service.claim_delivery(
        db,
        kind="schedule_changed",
        ref_id=session.id,
        offset_min=_minute_epoch(session.scheduled_at),
        user_id=user.id,
        payload={"announced_at": _ensure_aware(session.scheduled_at).isoformat()},
    )
    if not claimed:
        return False

    agent_service.post_agent_message(
        db,
        user.id,
        kind="schedule_changed",
        content=build_schedule_changed_content(facts, agent_policy.format_schedule(announced)),
        cta=agent_service.build_session_ctas(db, facts, user.id),
        ref_type="session",
        ref_id=session.id,
        commit=True,
    )
    return True


def _announced_at(db: DBSession, session: Session, user: User) -> datetime | None:
    """이 수신자에게 **마지막으로 안내한** 예약 시각 — 발송 로그 payload 에서 읽는다."""
    from app.models.agent import AgentDeliveryLog

    rows = (
        db.query(AgentDeliveryLog)
        .filter(
            AgentDeliveryLog.ref_id == session.id,
            AgentDeliveryLog.user_id == user.id,
            AgentDeliveryLog.kind.in_(["reminder_3h", "reminder_1h", "schedule_changed"]),
        )
        .order_by(AgentDeliveryLog.created_at.desc(), AgentDeliveryLog.id.desc())
        .all()
    )
    for row in rows:
        raw = (row.payload or {}).get("announced_at")
        if not raw:
            continue
        try:
            return _ensure_aware(datetime.fromisoformat(raw))
        except (TypeError, ValueError):
            continue
    return None


def _same_instant(left: datetime | None, right: datetime | None) -> bool:
    if left is None or right is None:
        return left is right
    return abs((_ensure_aware(left) - _ensure_aware(right)).total_seconds()) < 60


# ---------------------------------------------------------------------------
# 스윕 (매 1분 cron 진입점이 호출)
# ---------------------------------------------------------------------------


def sweep(db: DBSession, *, now: datetime | None = None, limit: int = SWEEP_LIMIT) -> dict:
    """예약 사전 노티 + 일정 정정 안내 스윕 1회.

    취소·종료된 세션, 그룹 세션, 일정 없는 즉석 세션은 후보 쿼리에서 제외된다.
    """
    now = now or _now()
    horizon = now + timedelta(hours=SWEEP_LOOKAHEAD_HOURS)

    candidates = (
        db.query(Session)
        .filter(
            Session.is_template.is_(False),
            Session.scheduled_at.is_not(None),
            Session.scheduled_at <= horizon,
            Session.scheduled_at >= now - timedelta(hours=1),
            Session.status.in_(list(ELIGIBLE_STATUSES)),
            Session.participant_mode != "group",
        )
        .order_by(Session.scheduled_at.asc())
        .limit(limit)
        .all()
    )

    scanned = sent = corrected = 0
    for session in candidates:
        # 발송 직전 재검증 — 후보 조회 이후 취소/변경됐을 수 있다.
        db.refresh(session)
        if not is_eligible_session(session):
            continue
        scanned += 1
        users = target_users(session, db)
        if not users:
            continue

        offsets = due_offsets(session, now)
        for user in users:
            # 일정이 바뀐 경우 정정 안내를 먼저 보낸다.
            try:
                if send_schedule_changed(session, user, db):
                    corrected += 1
            except Exception:  # noqa: BLE001 — 한 건 실패가 스윕 전체를 멈추지 않는다
                db.rollback()
                logger.exception(
                    "[agent_reminder] 정정 안내 실패 (session=%s, user=%s)", session.id, user.id
                )
            for offset in offsets:
                try:
                    if send_reminder(session, user, offset, db):
                        sent += 1
                except Exception:  # noqa: BLE001
                    db.rollback()
                    logger.exception(
                        "[agent_reminder] 사전 안내 실패 (session=%s, user=%s, offset=%s)",
                        session.id,
                        user.id,
                        offset,
                    )

    summary = {"scanned": scanned, "sent": sent, "corrected": corrected}
    if sent or corrected:
        logger.info("[agent_reminder] %s", summary)
    return summary
