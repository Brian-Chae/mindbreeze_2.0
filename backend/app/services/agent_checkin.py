"""SDD-191: 안부 대화(체크인) — 대상 선정 · 아웃리치 스윕 · 대화 · 마무리 요약.

D5=② 결정이 이 모듈의 전제다: **상담사가 내담자별로 켠 경우에만** AI 가 먼저 안부를
건넨다. 내담자는 켜는 주체가 아니라 "일시 중지"만 할 수 있다.

대상 조건(전부 충족해야 한다)
- `AgentCheckinEnablement.enabled` (상담사가 켬)
- `ClientCounselorLink.status == "active"` (담당 유지)
- `AgentCheckinPref.paused` 아님 (내담자가 중지하지 않음)
- AI 비서 이용 동의함 · 계정 활성

아웃리치 제한
- 하루 1회(`agent_delivery_logs` UNIQUE 로 멱등: kind="checkin", ref_id=내담자, offset_min=KST 날짜)
- 주당 4회
- 무응답 간격 점증 1→2→4일
- 방해금지 22:00~08:00 KST (**위험 알림은 이 규칙을 따르지 않는다**)
- 열린 체크인이 있으면 새로 시작하지 않는다

대화는 경청·공감·열린 질문만 한다. 사실 정보를 만들지 않으므로 LLM 이 없어도 템플릿으로
완결되고(TS16), 생성 결과는 `agent_guard` 를 통과해야 저장된다.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DBSession

from app.models.agent import (
    AgentCheckin,
    AgentCheckinEnablement,
    AgentCheckinPref,
    AgentConversation,
    AgentMessage,
    AgentRiskSignal,
)
from app.models.user import User
from app.services import agent_guard, agent_llm, agent_policy, agent_profile, agent_service

logger = logging.getLogger(__name__)

KST = agent_policy.KST

# 메시지 kind — Contract(AgentMessageKind) 확장분.
KIND_CHECKIN = "checkin"
KIND_CHECKIN_CLOSING = "checkin_closing"

# 푸시 비식별 문구 — 이름·감정·대화 내용을 담지 않는다(TS15).
PUSH_BODY_CHECKIN = "루시가 안부를 물었어요"

# 발송 로그 kind — ref_id = 내담자 id, offset_min = KST 날짜의 ordinal(하루 1회 보장).
DELIVERY_KIND = "checkin"

# 아웃리치 제한
WEEKLY_LIMIT = 4
QUIET_HOUR_START = 22  # 22:00 KST 부터 금지
QUIET_HOUR_END = 8  # 08:00 KST 부터 허용
# 무응답(턴 0)이 쌓일 때 다음 아웃리치까지 비워야 하는 일수 — 1→2→4.
BACKOFF_DAYS: tuple[int, int, int] = (1, 2, 4)
# 무응답 트리거 기준 — 내담자 발화가 이 일수 이상 없을 때.
NO_RESPONSE_DAYS = 3
# "평소 응답 시간대" 트리거에 필요한 과거 발화 수와 허용 오차(시간).
USUAL_TIME_MIN_SAMPLES = 3
USUAL_TIME_TOLERANCE_HOUR = 1

# 체크인 길이 — 내담자 턴 기준. 기본 6턴에서 마무리하고 10턴을 넘기지 않는다.
CLOSE_TURN_COUNT = 6
MAX_TURN_COUNT = 10

# 한 번의 스윕에서 검사할 내담자 수 상한.
SWEEP_LIMIT = 500

# 트리거 식별자 — AgentCheckin.trigger
TRIGGER_HARD_FEELING = "hard_feeling"
TRIGGER_AFTER_SESSION = "after_session"
TRIGGER_NO_RESPONSE = "no_response"
TRIGGER_USUAL_TIME = "usual_time"

# 트리거별 첫 인사 — 사실을 만들지 않는 고정 템플릿(LLM 미사용).
OUTREACH_TEMPLATES: dict[str, str] = {
    TRIGGER_HARD_FEELING: (
        "지난번에 마음이 무거워 보여서 계속 생각이 났어요. "
        "그 뒤로 어떻게 지내셨는지 들려주실 수 있을까요?"
    ),
    TRIGGER_AFTER_SESSION: (
        "어제 상담 이후 하루를 어떻게 보내셨는지 궁금했어요. "
        "지금 마음은 어떤 편인지 편하게 적어 주셔도 괜찮아요."
    ),
    TRIGGER_NO_RESPONSE: (
        "며칠 소식이 없어서 안부가 궁금했어요. "
        "요즘은 어떻게 지내고 계신지 한두 줄만 들려주실 수 있을까요?"
    ),
    TRIGGER_USUAL_TIME: (
        "잠깐 안부를 묻고 싶어서 왔어요. "
        "오늘 하루는 어떤 마음으로 보내고 계신가요?"
    ),
}

# 대화 응답 폴백 — 따뜻한 공감 한 문장 + 열린 질문 하나. 조언·해석을 담지 않는다.
REPLY_FALLBACKS: tuple[str, ...] = (
    "그런 마음이 들었군요. 들려주셔서 고마워요. 오늘은 어떤 일이 있었는지 조금 더 듣고 싶어요.",
    "그렇게 느끼실 만한 시간이었겠어요. 그 마음이 가장 크게 느껴지는 순간은 언제인가요?",
    "말씀해 주셔서 고마워요. 요즘 하루 중에 조금이라도 편안한 순간이 있다면 언제인가요?",
    "듣고 있어요. 그 일을 떠올리면 지금 어떤 생각이 먼저 드나요?",
    "조금 더 들어 보고 싶어요. 그 마음을 편하게 말씀해 주셔도 괜찮아요.",
)

# 마무리 — 상담사 연결 방향으로 닫는다(AI 의존·애착 방지).
CLOSING_TEMPLATE = (
    "오늘 이야기 나눠 주셔서 고맙습니다. 들려주신 이야기는 제가 정리해 상담사님께 전해 드릴게요.\n"
    "더 깊은 이야기는 상담사님과 나누시면 좋겠어요. 다음에 또 안부 물을게요."
)

# 요약 폴백에서 쓰는 변화 방향 라벨 — 숫자 척도를 쓰지 않는다.
MOOD_LABELS: dict[str, str] = {"better": "좋아짐", "same": "비슷함", "watch": "주의"}

# 변화 방향 키워드 폴백.
_BETTER_WORDS = ("나아졌", "좋아졌", "괜찮아졌", "편해졌", "잘 지냈", "잘지냈", "홀가분")
_WATCH_WORDS = (
    "힘들", "지쳤", "지쳐", "불안", "우울", "눈물", "못 자", "못자", "답답", "무기력", "외롭",
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _kst_date(moment: datetime) -> date:
    return moment.astimezone(KST).date()


# ---------------------------------------------------------------------------
# 설정 — 상담사 스위치 · 내담자 일시 중지
# ---------------------------------------------------------------------------


def get_enablement(
    db: DBSession, counselor_id: UUID, client_id: UUID
) -> AgentCheckinEnablement | None:
    return (
        db.query(AgentCheckinEnablement)
        .filter(
            AgentCheckinEnablement.counselor_id == counselor_id,
            AgentCheckinEnablement.client_id == client_id,
        )
        .first()
    )


def set_enabled(
    db: DBSession, counselor_id: UUID, client_id: UUID, enabled: bool
) -> AgentCheckinEnablement:
    """상담사의 내담자별 안부 켜기/끄기 — 행이 없으면 만든다(멱등)."""
    existing = get_enablement(db, counselor_id, client_id)
    if existing is None:
        existing = AgentCheckinEnablement(
            counselor_id=counselor_id, client_id=client_id, enabled=bool(enabled)
        )
        try:
            with db.begin_nested():
                db.add(existing)
            db.flush()
        except IntegrityError:
            existing = get_enablement(db, counselor_id, client_id)
            existing.enabled = bool(enabled)
    else:
        existing.enabled = bool(enabled)
    db.commit()
    db.refresh(existing)
    return existing


def get_prefs(db: DBSession, client_id: UUID) -> AgentCheckinPref | None:
    return (
        db.query(AgentCheckinPref)
        .filter(AgentCheckinPref.client_id == client_id)
        .first()
    )


def is_paused(db: DBSession, client_id: UUID) -> bool:
    prefs = get_prefs(db, client_id)
    return bool(prefs and prefs.paused)


def set_paused(db: DBSession, client_id: UUID, paused: bool) -> AgentCheckinPref:
    """내담자 일시 중지 — 아웃리치만 멈춘다. 대화는 계속 가능하다(Edge Case)."""
    prefs = get_prefs(db, client_id)
    if prefs is None:
        prefs = AgentCheckinPref(client_id=client_id, paused=bool(paused))
        try:
            with db.begin_nested():
                db.add(prefs)
            db.flush()
        except IntegrityError:
            prefs = get_prefs(db, client_id)
            prefs.paused = bool(paused)
    else:
        prefs.paused = bool(paused)
    db.commit()
    db.refresh(prefs)
    return prefs


def enabled_counselor_ids(db: DBSession, client_id: UUID) -> list[UUID]:
    """이 내담자에게 안부를 켠 **활성 담당** 상담사 — 최근 매칭 순."""
    from app.models.client_counselor_link import ClientCounselorLink

    rows = (
        db.query(AgentCheckinEnablement.counselor_id)
        .join(
            ClientCounselorLink,
            (ClientCounselorLink.counselor_id == AgentCheckinEnablement.counselor_id)
            & (ClientCounselorLink.client_id == AgentCheckinEnablement.client_id),
        )
        .join(User, User.id == AgentCheckinEnablement.counselor_id)
        .filter(
            AgentCheckinEnablement.client_id == client_id,
            AgentCheckinEnablement.enabled.is_(True),
            ClientCounselorLink.status == "active",
            User.status == "active",
        )
        .order_by(ClientCounselorLink.matched_at.desc())
        .all()
    )
    result: list[UUID] = []
    for row in rows:
        if row[0] not in result:
            result.append(row[0])
    return result


def active_counselor_ids(db: DBSession, client_id: UUID) -> list[UUID]:
    """활성 담당 상담사 — 안부 스위치와 무관하게 감정 대화를 연다(SDD-193 결정 1).

    `enabled_counselor_ids` 가 "상담사가 안부를 켠" 조건을 요구하는 것과 달리,
    여기서는 담당 링크(active)만 본다. 그래서 상담사가 안부를 켜지 않아도
    내담자가 말을 걸면 감정 대화(체크인)가 열린다.
    """
    from app.models.client_counselor_link import ClientCounselorLink

    rows = (
        db.query(ClientCounselorLink.counselor_id)
        .join(User, User.id == ClientCounselorLink.counselor_id)
        .filter(
            ClientCounselorLink.client_id == client_id,
            ClientCounselorLink.status == "active",
            User.status == "active",
        )
        .order_by(ClientCounselorLink.matched_at.desc())
        .all()
    )
    result: list[UUID] = []
    for row in rows:
        if row[0] not in result:
            result.append(row[0])
    return result


def is_available(db: DBSession, client_id: UUID) -> bool:
    """내담자 화면에 "안부 일시 중지" 토글을 보일지 — 상담사가 켰는지 여부(Contract.available)."""
    return bool(enabled_counselor_ids(db, client_id))


def prefs_payload(db: DBSession, client_id: UUID) -> dict:
    """Contract(CheckinPrefs) — 감지·위험 관련 정보를 담지 않는다."""
    return {"available": is_available(db, client_id), "paused": is_paused(db, client_id)}


# ---------------------------------------------------------------------------
# 체크인 생애주기
# ---------------------------------------------------------------------------


def open_checkin(db: DBSession, client_id: UUID) -> AgentCheckin | None:
    """열린 체크인(closed_at null) 1건 — 있으면 아웃리치를 새로 시작하지 않는다."""
    return (
        db.query(AgentCheckin)
        .filter(AgentCheckin.client_id == client_id, AgentCheckin.closed_at.is_(None))
        .order_by(AgentCheckin.started_at.desc())
        .first()
    )


def last_checkin(db: DBSession, client_id: UUID) -> AgentCheckin | None:
    return (
        db.query(AgentCheckin)
        .filter(AgentCheckin.client_id == client_id)
        .order_by(AgentCheckin.started_at.desc())
        .first()
    )


def _weekly_count(db: DBSession, client_id: UUID, now: datetime) -> int:
    return (
        db.query(AgentCheckin.id)
        .filter(
            AgentCheckin.client_id == client_id,
            AgentCheckin.started_at >= now - timedelta(days=7),
        )
        .count()
    )


def _consecutive_no_response(db: DBSession, client_id: UUID) -> int:
    """최근부터 연속된 무응답(turn_count == 0) 체크인 수 — 간격 점증의 입력값."""
    rows = (
        db.query(AgentCheckin.turn_count)
        .filter(AgentCheckin.client_id == client_id)
        .order_by(AgentCheckin.started_at.desc())
        .limit(10)
        .all()
    )
    count = 0
    for row in rows:
        if (row[0] or 0) > 0:
            break
        count += 1
    return count


def in_quiet_hours(now: datetime) -> bool:
    """22:00~07:59 KST 는 아웃리치 금지. 08:00 과 21:59 는 허용(TS2)."""
    hour = now.astimezone(KST).hour
    return hour >= QUIET_HOUR_START or hour < QUIET_HOUR_END


# ---------------------------------------------------------------------------
# 트리거 판정
# ---------------------------------------------------------------------------


def _client_conversation(db: DBSession, client_id: UUID) -> AgentConversation | None:
    return (
        db.query(AgentConversation)
        .filter(
            AgentConversation.user_id == client_id,
            AgentConversation.channel == agent_service.CHANNEL_CLIENT,
        )
        .first()
    )


def _last_user_message_at(db: DBSession, client_id: UUID) -> datetime | None:
    conversation = _client_conversation(db, client_id)
    if conversation is None:
        return None
    row = (
        db.query(AgentMessage.created_at)
        .filter(
            AgentMessage.conversation_id == conversation.id,
            AgentMessage.sender == "user",
        )
        .order_by(AgentMessage.created_at.desc())
        .first()
    )
    return agent_service._ensure_aware(row[0]) if row and row[0] else None


def _usual_hours(db: DBSession, client_id: UUID) -> set[int]:
    """내담자가 평소 응답하던 KST 시각(시 단위) 집합 — 과거 발화에서만 뽑는다."""
    conversation = _client_conversation(db, client_id)
    if conversation is None:
        return set()
    rows = (
        db.query(AgentMessage.created_at)
        .filter(
            AgentMessage.conversation_id == conversation.id,
            AgentMessage.sender == "user",
        )
        .order_by(AgentMessage.created_at.desc())
        .limit(30)
        .all()
    )
    moments = [agent_service._ensure_aware(row[0]) for row in rows if row and row[0]]
    if len(moments) < USUAL_TIME_MIN_SAMPLES:
        return set()
    counts: dict[int, int] = {}
    for moment in moments:
        hour = moment.astimezone(KST).hour
        counts[hour] = counts.get(hour, 0) + 1
    top = max(counts.values())
    return {hour for hour, value in counts.items() if value == top}


def _completed_session_yesterday(
    db: DBSession, client_id: UUID, counselor_id: UUID, now: datetime
) -> bool:
    """상담 완료 다음 날 트리거 — 담당 상담사가 host 인 완료 세션만 본다."""
    from app.models.session import Session, SessionParticipant

    yesterday = _kst_date(now) - timedelta(days=1)
    start, end = agent_policy.kst_day_bounds(yesterday)
    return (
        db.query(Session.id)
        .join(SessionParticipant, SessionParticipant.session_id == Session.id)
        .filter(
            Session.host_id == counselor_id,
            Session.is_template.is_(False),
            Session.status == "completed",
            Session.scheduled_at >= start,
            Session.scheduled_at < end,
            SessionParticipant.user_id == client_id,
            SessionParticipant.is_waitlisted.is_(False),
        )
        .first()
        is not None
    )


def pick_trigger(
    db: DBSession, client_id: UUID, counselor_id: UUID, now: datetime
) -> str | None:
    """아웃리치 트리거 — 우선순위대로 첫 번째 것. 아무것도 없으면 None(TS3)."""
    previous = last_checkin(db, client_id)

    # 1) 직전 대화가 힘든 감정으로 끝남 — 하루 이상 지난 뒤에 한 번 더 묻는다.
    if (
        previous is not None
        and previous.mood_direction == "watch"
        and previous.closed_at is not None
        and agent_service._ensure_aware(previous.closed_at) <= now - timedelta(days=1)
    ):
        return TRIGGER_HARD_FEELING

    # 2) 상담 완료 다음 날
    if _completed_session_yesterday(db, client_id, counselor_id, now):
        return TRIGGER_AFTER_SESSION

    last_user_at = _last_user_message_at(db, client_id)
    silent_days = (
        (now - last_user_at).total_seconds() / 86400.0 if last_user_at is not None else None
    )

    # 3) 무응답 3일 이상 (한 번도 말한 적 없는 내담자도 포함)
    if silent_days is None or silent_days >= NO_RESPONSE_DAYS:
        return TRIGGER_NO_RESPONSE

    # 4) 평소 응답 시간대 — 마지막 체크인이 충분히 지난 경우에만.
    hours = _usual_hours(db, client_id)
    if hours and now.astimezone(KST).hour in _expanded_hours(hours):
        if previous is None or agent_service._ensure_aware(
            previous.started_at
        ) <= now - timedelta(days=NO_RESPONSE_DAYS):
            return TRIGGER_USUAL_TIME
    return None


def _expanded_hours(hours: set[int]) -> set[int]:
    """평소 시간대 ±허용 오차."""
    expanded: set[int] = set()
    for hour in hours:
        for delta in range(-USUAL_TIME_TOLERANCE_HOUR, USUAL_TIME_TOLERANCE_HOUR + 1):
            expanded.add((hour + delta) % 24)
    return expanded


# ---------------------------------------------------------------------------
# 아웃리치 1건
# ---------------------------------------------------------------------------


def eligible_client_ids(db: DBSession, *, limit: int = SWEEP_LIMIT) -> list[UUID]:
    """안부 대상 내담자 id — 상담사가 켬 ∧ 담당 활성 ∧ 계정 활성 ∧ 중지 아님.

    동의 여부는 건별로 확인한다(동의 테이블 조회가 사용자 단위라 조인이 무거워진다).
    """
    from app.models.client_counselor_link import ClientCounselorLink

    rows = (
        db.query(AgentCheckinEnablement.client_id)
        .join(User, User.id == AgentCheckinEnablement.client_id)
        .join(
            ClientCounselorLink,
            (ClientCounselorLink.counselor_id == AgentCheckinEnablement.counselor_id)
            & (ClientCounselorLink.client_id == AgentCheckinEnablement.client_id),
        )
        .outerjoin(
            AgentCheckinPref, AgentCheckinPref.client_id == AgentCheckinEnablement.client_id
        )
        .filter(
            AgentCheckinEnablement.enabled.is_(True),
            ClientCounselorLink.status == "active",
            User.role == "client",
            User.status == "active",
            (AgentCheckinPref.paused.is_(None)) | (AgentCheckinPref.paused.is_(False)),
        )
        .order_by(AgentCheckinEnablement.client_id)
        .limit(limit)
        .all()
    )
    result: list[UUID] = []
    for row in rows:
        if row[0] not in result:
            result.append(row[0])
    return result


def start_outreach(
    db: DBSession, client_id: UUID, *, now: datetime | None = None
) -> AgentCheckin | None:
    """내담자 1명에게 안부 1건 — 제한·트리거를 모두 통과했을 때만 만든다.

    하루 1회는 `agent_delivery_logs` UNIQUE 선점으로 보장하므로 스윕이 겹쳐도 멱등하다.
    """
    now = now or _now()

    if in_quiet_hours(now):
        return None
    if open_checkin(db, client_id) is not None:
        return None
    if not agent_service.has_consent(db, client_id):
        return None

    counselor_ids = enabled_counselor_ids(db, client_id)
    if not counselor_ids:
        return None
    # 여러 상담사가 켰다면 가장 최근 매칭 상담사 기준으로 1건만 만든다.
    counselor_id = counselor_ids[0]

    if _weekly_count(db, client_id, now) >= WEEKLY_LIMIT:
        return None

    previous = last_checkin(db, client_id)
    no_response = _consecutive_no_response(db, client_id)
    if previous is not None and no_response > 0:
        required_gap = BACKOFF_DAYS[min(no_response - 1, len(BACKOFF_DAYS) - 1)]
        if agent_service._ensure_aware(previous.started_at) > now - timedelta(
            days=required_gap
        ):
            return None

    trigger = pick_trigger(db, client_id, counselor_id, now)
    if trigger is None:
        return None

    # 하루 1회 선점 — offset_min 에 KST 날짜 ordinal 을 넣어 날짜별 1건만 허용한다.
    claimed = agent_service.claim_delivery(
        db,
        kind=DELIVERY_KIND,
        ref_id=client_id,
        offset_min=_kst_date(now).toordinal(),
        user_id=client_id,
        payload={"trigger": trigger},
    )
    if not claimed:
        return None

    checkin = AgentCheckin(
        client_id=client_id,
        counselor_id=counselor_id,
        trigger=trigger,
        started_at=now,
        turn_count=0,
    )
    db.add(checkin)
    db.flush()

    content = agent_guard.sanitize(
        OUTREACH_TEMPLATES[trigger], fallback=OUTREACH_TEMPLATES[TRIGGER_USUAL_TIME]
    )
    agent_service.post_agent_message(
        db,
        client_id,
        kind=KIND_CHECKIN,
        content=content,
        push_body=PUSH_BODY_CHECKIN,
        commit=False,
    )
    db.commit()
    db.refresh(checkin)
    # 로그에 대화 내용·이름을 남기지 않는다 — 트리거만 기록한다.
    logger.info("[agent_checkin] 안부 생성 (client=%s, trigger=%s)", client_id, trigger)
    return checkin


def sweep(db: DBSession, *, now: datetime | None = None, limit: int = SWEEP_LIMIT) -> dict:
    """안부 아웃리치 스윕 1회(매 5분 cron). 한 건 실패가 전체를 멈추지 않는다."""
    now = now or _now()
    client_ids = eligible_client_ids(db, limit=limit)

    created = skipped = 0
    for client_id in client_ids:
        try:
            if start_outreach(db, client_id, now=now) is not None:
                created += 1
            else:
                skipped += 1
        except Exception:  # noqa: BLE001
            db.rollback()
            skipped += 1
            logger.exception("[agent_checkin] 안부 생성 실패 (client=%s)", client_id)

    summary = {"scanned": len(client_ids), "created": created, "skipped": skipped}
    if created:
        logger.info("[agent_checkin] %s", summary)
    return summary


# ---------------------------------------------------------------------------
# 대화 — 내담자 자유 메시지 응답
# ---------------------------------------------------------------------------


def ensure_checkin_for_conversation(
    db: DBSession, client_id: UUID, *, started_at: datetime | None = None
) -> AgentCheckin | None:
    """열린 체크인을 돌려주고, 없으면 "담당 상담사가 있는 내담자" 에 한해 새로 시작한다.

    아웃리치(AI 선발화) 없이 내담자가 먼저 말을 건 경우에도 안부 대화로 묶어 요약을
    남기기 위한 경로다. 담당 상담사가 없으면 None — 기존 응답 경로를 그대로 쓴다.

    started_at 을 넘기면 그 시각을 체크인 시작으로 삼는다 — 사용자 메시지가 이미
    저장된 뒤 체크인을 열 때(created_at < started_at 이 되지 않게) 그 메시지를
    체크인 구간에 포함시키기 위함이다(회귀 방지).
    """
    existing = open_checkin(db, client_id)
    if existing is not None:
        return existing

    # SDD-193 결정 1: 안부를 "켠" 상담사가 없어도 담당 링크(active)만 있으면 감정 대화를
    # 연다. 단 프로파일 전달 대상을 바꾸지 않도록, 안부를 켠 상담사가 있으면 그 상담사 우선,
    # 없으면 활성 담당 상담사로 폴백한다(기존 "체크인 유발 상담사에게 프로파일" 동작 유지).
    counselor_ids = enabled_counselor_ids(db, client_id) or active_counselor_ids(db, client_id)
    if not counselor_ids:
        return None

    checkin = AgentCheckin(
        client_id=client_id,
        counselor_id=counselor_ids[0],
        trigger=TRIGGER_USUAL_TIME,
        started_at=started_at or _now(),
        turn_count=0,
    )
    db.add(checkin)
    db.flush()
    return checkin


def respond(
    db: DBSession, client_id: UUID, checkin: AgentCheckin, user_text: str
) -> tuple[str, str]:
    """(응답 본문, kind) — 턴을 올리고, 마무리 턴에 도달하면 체크인을 닫는다.

    조언·진단·점수 표현은 `agent_llm.generate` → `agent_guard` 경로에서 걸러진다.
    """
    checkin.turn_count = (checkin.turn_count or 0) + 1
    db.flush()

    if checkin.turn_count >= CLOSE_TURN_COUNT:
        # 마무리 시점의 요약·프로파일 저장을 즉시 커밋한다. commit=False 로 두면
        # 사용자 요청 경로의 후속 커밋에 묶이는데, LLM 응답 생성 등이 끼면 flush 된
        # 프로파일 항목이 커밋되지 않고 유실될 수 있어 명시적으로 커밋한다.
        close(db, checkin, commit=True)
        return CLOSING_TEMPLATE, KIND_CHECKIN_CLOSING

    fallback = REPLY_FALLBACKS[(checkin.turn_count - 1) % len(REPLY_FALLBACKS)]
    task = (
        "내담자의 이야기를 깊이 이해하고, 그 마음을 짚어 따뜻하게 위로하거나 공감하세요. "
        "질문을 받으면 자신의 생각을 먼저 진솔하게 나누고, 그걸 통해 주제를 이끌어 가세요. "
        "공감·위로 후에는 대화가 끊기지 않도록 자연스럽게 이어갈 질문이나 주제를 하나 던지세요. "
        "조언·해석·진단·처방을 하지 마세요. 상태를 숫자나 점수로 표현하지 마세요. "
        "'항상 곁에 있겠다' 같은 약속을 하지 마세요. 2~3문장을 넘기지 마세요."
    )
    prompt = agent_llm.build_prompt("(안부 대화 — 참고 자료 없음)", user_text=user_text, task=task)
    reply = agent_llm.generate(prompt, fallback)
    return agent_guard.sanitize(reply, fallback=fallback), KIND_CHECKIN


# ---------------------------------------------------------------------------
# 마무리 — 요약 · 변화 방향 · 프로파일
# ---------------------------------------------------------------------------


def _checkin_user_texts(db: DBSession, checkin: AgentCheckin) -> list[tuple[str, str]]:
    """해당 체크인 구간의 내담자 발화 [(message_id, text)]."""
    conversation = _client_conversation(db, checkin.client_id)
    if conversation is None:
        return []
    query = db.query(AgentMessage.id, AgentMessage.content).filter(
        AgentMessage.conversation_id == conversation.id,
        AgentMessage.sender == "user",
        AgentMessage.created_at >= agent_service._ensure_aware(checkin.started_at),
    )
    rows = query.order_by(AgentMessage.created_at.asc()).all()
    return [(str(row[0]), row[1] or "") for row in rows]


def _mood_direction(db: DBSession, checkin: AgentCheckin, texts: list[str]) -> str:
    """변화 방향 — 숫자 척도 없이 좋아짐/비슷함/주의 셋 중 하나.

    구간에 위험 신호가 있었다면 무조건 "주의"다(상담사가 먼저 봐야 한다).
    """
    has_risk = (
        db.query(AgentRiskSignal.id)
        .filter(
            AgentRiskSignal.client_id == checkin.client_id,
            AgentRiskSignal.created_at >= agent_service._ensure_aware(checkin.started_at),
        )
        .first()
        is not None
    )
    if has_risk:
        return "watch"

    joined = " ".join(texts)
    if any(word in joined for word in _WATCH_WORDS):
        return "watch"
    if any(word in joined for word in _BETTER_WORDS):
        return "better"
    return "same"


def _fallback_summary(texts: list[str], mood: str) -> str:
    """LLM 없이 쓰는 요약 — 카테고리 라벨만 모아 전달한다(원문 인용 없음, D1)."""
    categories: list[str] = []
    for candidate in agent_profile.extract_candidates([("", text) for text in texts]):
        label = agent_profile.CATEGORY_LABELS.get(candidate["category"])
        if label and label not in categories:
            categories.append(label)
    if categories:
        return (
            f"안부 대화에서 {', '.join(categories)} 관련 이야기가 있었어요. "
            f"변화 방향은 {MOOD_LABELS[mood]} 입니다."
        )
    return f"안부 대화를 나눴어요. 변화 방향은 {MOOD_LABELS[mood]} 입니다."


def _build_summary(texts: list[str], mood: str) -> str:
    """요약 — LLM(있으면) + 폴백. 상담사에게는 원문이 아니라 요약만 전달한다(D1)."""
    fallback = _fallback_summary(texts, mood)
    if not texts or not agent_llm.is_enabled():
        return fallback
    task = (
        "아래 [사용자 입력]은 내담자가 안부 대화에서 남긴 말입니다. 상담사가 읽을 요약을 "
        "2~3문장으로 쓰세요. 원문을 그대로 옮기지 말고, 진단명·병명·점수·숫자 척도를 쓰지 "
        "마세요. 입력에 없는 내용을 만들지 마세요."
    )
    prompt = agent_llm.build_prompt("(없음)", user_text="\n".join(texts), task=task)
    try:
        summary = agent_llm.generate(prompt, fallback)
    except Exception:  # noqa: BLE001 — 요약 실패가 체크인 종료를 막지 않는다
        logger.warning("[agent_checkin] 요약 생성 실패 — 템플릿 폴백")
        return fallback
    return agent_guard.sanitize(summary, fallback=fallback)


def close(db: DBSession, checkin: AgentCheckin, *, commit: bool = False) -> AgentCheckin:
    """체크인 마무리 — closed_at · 요약 · 변화 방향 저장 + 프로파일 추출."""
    if checkin.closed_at is not None:
        return checkin

    pairs = _checkin_user_texts(db, checkin)
    texts = [text for _, text in pairs if text]
    mood = _mood_direction(db, checkin, texts)
    checkin.closed_at = _now()
    checkin.mood_direction = mood
    checkin.summary = _build_summary(texts, mood)
    db.flush()

    saved = agent_profile.extract_and_store(
        db,
        client_id=checkin.client_id,
        counselor_id=checkin.counselor_id,
        texts=pairs,
    )
    if commit:
        db.commit()
    logger.info(
        "[agent_checkin] 체크인 마무리 (client=%s, turns=%s)", checkin.client_id, checkin.turn_count
    )
    return checkin


def close_stale(db: DBSession, *, now: datetime | None = None) -> int:
    """턴 상한을 넘겼거나 하루 넘게 방치된 열린 체크인을 닫는다(스윕에서 호출)."""
    now = now or _now()
    rows = (
        db.query(AgentCheckin)
        .filter(AgentCheckin.closed_at.is_(None))
        .order_by(AgentCheckin.started_at.asc())
        .limit(SWEEP_LIMIT)
        .all()
    )
    closed = 0
    for checkin in rows:
        too_long = (checkin.turn_count or 0) >= MAX_TURN_COUNT
        too_old = agent_service._ensure_aware(checkin.started_at) <= now - timedelta(days=1)
        if not (too_long or too_old):
            continue
        try:
            close(db, checkin, commit=True)
            closed += 1
        except Exception:  # noqa: BLE001
            db.rollback()
            logger.exception("[agent_checkin] 체크인 마무리 실패 (id=%s)", checkin.id)
    return closed


# ---------------------------------------------------------------------------
# 상담사 조회
# ---------------------------------------------------------------------------


def serialize_checkin(checkin: AgentCheckin) -> dict:
    """Contract(CheckinSummary) — 원문은 담지 않는다."""
    return {
        "id": str(checkin.id),
        "client_id": str(checkin.client_id),
        "started_at": checkin.started_at,
        "closed_at": checkin.closed_at,
        "summary": checkin.summary or "",
        "mood_direction": checkin.mood_direction,
    }


def list_checkins(
    db: DBSession, counselor_id: UUID, client_id: UUID, *, limit: int = 20
) -> list[dict]:
    """상담사 본인이 유발한 해당 내담자 체크인 요약 — 최신순(TS12 격리)."""
    rows = (
        db.query(AgentCheckin)
        .filter(
            AgentCheckin.counselor_id == counselor_id,
            AgentCheckin.client_id == client_id,
        )
        .order_by(AgentCheckin.started_at.desc())
        .limit(max(1, min(int(limit), 100)))
        .all()
    )
    return [serialize_checkin(row) for row in rows]


def latest_closed_checkin(
    db: DBSession, counselor_id: UUID, client_id: UUID
) -> AgentCheckin | None:
    """브리핑용 — 가장 최근 마무리된 체크인 1건."""
    return (
        db.query(AgentCheckin)
        .filter(
            AgentCheckin.counselor_id == counselor_id,
            AgentCheckin.client_id == client_id,
            AgentCheckin.closed_at.is_not(None),
        )
        .order_by(AgentCheckin.closed_at.desc())
        .first()
    )
