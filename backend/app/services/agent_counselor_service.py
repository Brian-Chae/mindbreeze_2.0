"""SDD-189: 상담사:AI 채널 서비스 — 브리핑 설정·대화·중계 이벤트 열람.

내담자 채널(`agent_service`)과 같은 저장 구조(AgentConversation/AgentMessage)를 쓰되
`channel="counselor"` 대화방만 다룬다. 두 채널은 대화방이 달라 메시지가 섞이지 않는다.

이 모듈이 지키는 경계
- 조회 데이터는 전부 `agent_policy.counselor_context` (host/담당 링크 기준)에서 온다.
- **데이터를 바꾸거나 무언가를 발송하지 않는다** — 일정 변경·메시지 발송 요청에는
  초안·안내만 돌려준다(기획 §2.2, SDD-189 Scope 6).
- 장소·연락처·길찾기를 응답에 담지 않는다(기획 §1.2-6).
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DBSession

from app.models.agent import (
    AgentConversation,
    AgentCounselorSettings,
    AgentMessage,
    AgentRelayEvent,
)
from app.services import agent_guard, agent_llm, agent_policy, agent_service

logger = logging.getLogger(__name__)

CHANNEL = agent_service.CHANNEL_COUNSELOR

# 설정 행이 없는 상담사의 기본값 (Contract: 08:00 / 21:00, 둘 다 켜짐, 건너뛰기 true)
DEFAULT_MORNING_TIME = "08:00"
DEFAULT_EVENING_TIME = "21:00"

# "HH:MM" 24시간 표기만 허용한다. "25:00"·"8:0" 은 거부(TS8).
_TIME_RE = re.compile(r"^(?:[01]\d|2[0-3]):[0-5]\d$")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def is_valid_time(value: str) -> bool:
    return bool(_TIME_RE.match(value or ""))


def parse_time(value: str) -> tuple[int, int]:
    """"HH:MM" → (시, 분). 검증은 호출 전에 끝났다고 가정한다."""
    hour, minute = value.split(":")
    return int(hour), int(minute)


# ---------------------------------------------------------------------------
# 브리핑 설정
# ---------------------------------------------------------------------------


def get_settings(db: DBSession, user_id: str | UUID) -> AgentCounselorSettings:
    """상담사 브리핑 설정 — 행이 없으면 기본값으로 만들어 돌려준다(Edge Case)."""
    uid = agent_service._to_uuid(user_id)
    existing = (
        db.query(AgentCounselorSettings)
        .filter(AgentCounselorSettings.user_id == uid)
        .first()
    )
    if existing is not None:
        return existing

    created = AgentCounselorSettings(
        user_id=uid,
        morning_enabled=True,
        morning_time=DEFAULT_MORNING_TIME,
        evening_enabled=True,
        evening_time=DEFAULT_EVENING_TIME,
        skip_no_session_days=True,
    )
    try:
        with db.begin_nested():
            db.add(created)
        db.commit()
        db.refresh(created)
        return created
    except IntegrityError:
        # 동시 요청이 먼저 만든 경우 — 그 행을 쓴다.
        db.rollback()
        return (
            db.query(AgentCounselorSettings)
            .filter(AgentCounselorSettings.user_id == uid)
            .one()
        )


def serialize_settings(settings: AgentCounselorSettings) -> dict:
    return {
        "morning_enabled": bool(settings.morning_enabled),
        "morning_time": settings.morning_time,
        "evening_enabled": bool(settings.evening_enabled),
        "evening_time": settings.evening_time,
        "skip_no_session_days": bool(settings.skip_no_session_days),
    }


def update_settings(db: DBSession, user_id: str | UUID, payload: dict) -> dict:
    """설정 수정 — 시각 형식은 Pydantic 에서 걸러지고, 여기서 한 번 더 확인한다."""
    for key in ("morning_time", "evening_time"):
        value = payload.get(key)
        if value is not None and not is_valid_time(value):
            raise HTTPException(status_code=422, detail="시각은 HH:MM 형식이어야 합니다")

    settings = get_settings(db, user_id)
    for key in (
        "morning_enabled",
        "morning_time",
        "evening_enabled",
        "evening_time",
        "skip_no_session_days",
    ):
        if payload.get(key) is not None:
            setattr(settings, key, payload[key])
    db.commit()
    db.refresh(settings)
    return serialize_settings(settings)


# ---------------------------------------------------------------------------
# 중계 이벤트 열람 · 처리
# ---------------------------------------------------------------------------


def list_relay_events(
    db: DBSession, user_id: str | UUID, *, status: str = "open", limit: int = 50
) -> dict:
    """본인(target_user) 중계 이벤트 목록. status=open 이면 미처리(handled_at null)만."""
    uid = agent_service._to_uuid(user_id)
    items = agent_policy.counselor_relay_events(
        uid, db, only_open=(status != "all"), limit=max(1, min(int(limit), 200))
    )
    return {"items": items}


def mark_relay_handled(db: DBSession, user_id: str | UUID, event_id: str) -> dict:
    """중계 이벤트 처리 완료 — 본인 대상 이벤트만. 타인 이벤트 id 는 404(IDOR 방지)."""
    uid = agent_service._to_uuid(user_id)
    event = (
        db.query(AgentRelayEvent)
        .filter(
            AgentRelayEvent.id == agent_service._to_uuid(event_id),
            AgentRelayEvent.target_user_id == uid,
        )
        .first()
    )
    if event is None:
        raise HTTPException(status_code=404, detail="전달 사항을 찾을 수 없습니다")

    if event.handled_at is None:
        event.handled_at = _now()
        # 열람·처리를 함께 반영한다 — 미처리 목록에서 빠진다.
        event.status = "read"
        db.commit()
        db.refresh(event)
    return agent_policy.relay_event_facts(event, db)


# ---------------------------------------------------------------------------
# 상담사 대화 — 규칙 기반 의도 + 가드된 LLM 보조
# ---------------------------------------------------------------------------

# 의도 판별 키워드. 규칙으로 잡히는 질문은 LLM 을 거치지 않고 DB 사실로 답한다.
_TODAY_WORDS = ("오늘",)
_TOMORROW_WORDS = ("내일",)
_SCHEDULE_WORDS = ("일정", "스케줄", "예약", "상담 몇", "몇 건")
_SETTINGS_WORDS = ("브리핑 시간", "브리핑시간", "알림 시간", "브리핑 설정", "시간 변경", "시간 바꾸")
_SUMMARY_WORDS = ("지난 요약", "지난요약", "이전 요약", "최근 요약", "지난 상담")
# 실행을 요구하는 표현 — 에이전트는 조회·초안만 하고 실제 변경·발송은 하지 않는다.
_ACTION_WORDS = (
    "보내줘", "보내 줘", "전송해", "발송해", "예약 변경해", "일정 변경해",
    "취소해", "수정해", "등록해", "승인해", "삭제해",
)

NO_SESSION_REPLY_TODAY = "오늘은 잡혀 있는 상담이 없어요."
NO_SESSION_REPLY_TOMORROW = "내일은 잡혀 있는 상담이 없어요."

ACTION_DECLINE_REPLY = (
    "저는 일정이나 메시지를 직접 바꾸거나 보내지 않아요. 확인하고 정리해 드리는 것까지만 할 수 있어요.\n"
    "필요하시면 일정은 세션 상세에서, 메시지는 내담자 채팅에서 직접 진행해 주세요."
)

SETTINGS_REPLY = (
    "브리핑 시간은 AI 비서 화면의 브리핑 설정에서 바꿀 수 있어요. "
    "아침 브리핑과 저녁 정리의 시각을 각각 지정할 수 있고, 일정이 없는 날은 건너뛰도록 둘 수 있어요."
)

NO_CONTEXT_REPLY = (
    "지금은 함께 볼 일정이나 전달 사항이 없어요. "
    "오늘 일정, 내일 일정, 또는 '<내담자 이름> 지난 요약' 처럼 물어봐 주시면 찾아 드릴게요."
)


def send_user_message(db: DBSession, user_id: str | UUID, content: str) -> dict:
    """상담사 메시지 저장 + 에이전트 응답 생성.

    상담사 채널에는 별도 동의 게이트를 두지 않는다(업무 도구이며, 내담자 개인정보를
    새로 노출하지 않고 이미 담당인 데이터만 보여준다).
    """
    uid = agent_service._to_uuid(user_id)
    text = content.strip()

    user_message = agent_service.post_user_message(db, uid, text, channel=CHANNEL)
    reply_text = build_reply(db, uid, text)
    agent_message = agent_service.post_agent_message(
        db,
        uid,
        kind="free",
        content=reply_text,
        notify=False,  # 상담사가 대화창에 있는 중이므로 푸시를 보내지 않는다
        commit=False,
        channel=CHANNEL,
    )
    db.commit()
    db.refresh(user_message)
    db.refresh(agent_message)
    # 로그에 내담자 이름·대화 원문을 남기지 않는다 — 길이만 기록한다(보안 리뷰 항목).
    logger.info("[agent_counselor] 상담사 메시지 처리 (user=%s, chars=%d)", uid, len(text))
    return {
        "user_message": agent_service.serialize_message(user_message),
        "agent_message": agent_service.serialize_message(agent_message),
    }


def build_reply(db: DBSession, counselor_id: UUID, user_text: str) -> str:
    """(응답 본문) — 규칙 기반 의도를 먼저 처리하고, 나머지는 가드된 LLM 보조로 답한다."""
    text = user_text.strip()

    # 1) 실행 요청은 LLM 을 거치지 않고 거절한다 — 에이전트는 상태를 바꾸지 않는다.
    if any(word in text for word in _ACTION_WORDS):
        return ACTION_DECLINE_REPLY

    # 2) 브리핑 설정 안내
    if any(word in text for word in _SETTINGS_WORDS):
        return SETTINGS_REPLY

    # 3) "<내담자 이름> 지난 요약"
    if any(word in text for word in _SUMMARY_WORDS):
        return _client_summary_reply(db, counselor_id, text)

    context = agent_policy.counselor_context(counselor_id, db)

    # 4) 오늘/내일 일정
    if any(word in text for word in _SCHEDULE_WORDS) or any(
        word in text for word in (*_TODAY_WORDS, *_TOMORROW_WORDS)
    ):
        if any(word in text for word in _TOMORROW_WORDS):
            return _schedule_reply(context.get("tomorrow") or [], NO_SESSION_REPLY_TOMORROW, "내일")
        if any(word in text for word in _TODAY_WORDS):
            return _schedule_reply(context.get("today") or [], NO_SESSION_REPLY_TODAY, "오늘")
        return _schedule_reply(context.get("today") or [], NO_SESSION_REPLY_TODAY, "오늘")

    # 5) 그 외 — 정책 계층 컨텍스트만 넣은 가드된 LLM 응답(키 없으면 폴백).
    if not (context.get("today") or context.get("tomorrow") or context.get("relay_events")):
        return NO_CONTEXT_REPLY

    fallback = _schedule_reply(context.get("today") or [], NO_SESSION_REPLY_TODAY, "오늘")
    task = (
        "상담사가 물은 내용에 [허용 자료] 범위 안에서만 간결하게 답하세요. "
        "자료에 없는 내용은 만들지 말고 확인이 필요하다고 안내하세요. "
        "일정을 바꾸거나 메시지를 보내겠다고 말하지 마세요. "
        "장소·주소·연락처는 언급하지 마세요."
    )
    prompt = agent_llm.build_prompt(
        agent_policy.counselor_context_to_text(context), user_text=text, task=task
    )
    return agent_llm.generate(prompt, fallback)


def _schedule_reply(sessions: list[dict], empty_reply: str, day_label: str) -> str:
    """일정 목록 응답 — DB 값 템플릿. 장소·연락처는 담지 않는다."""
    active = [s for s in sessions if not s.get("is_cancelled")]
    cancelled = [s for s in sessions if s.get("is_cancelled")]
    if not active and not cancelled:
        return empty_reply

    lines = [f"{day_label} 일정은 {len(active)}건이에요."]
    for item in active:
        lines.append(f"· {_session_line(item)}")
    for item in cancelled:
        lines.append(f"· {_session_line(item)} — 취소됨")
    return "\n".join(lines)


def _session_line(item: dict) -> str:
    """브리핑·대화 공통 한 줄 — 시각 / 내담자 실명(회차) / 유형 / 온라인·오프라인."""
    clients = item.get("clients") or []
    names = ", ".join(f"{c['name']} {c['ordinal']}회차" for c in clients) or "참여자 미지정"
    return (
        f"{item['time_text']} {names} / {item['type_label']} / {item['location_label']}"
    )


def _client_summary_reply(db: DBSession, counselor_id: UUID, text: str) -> str:
    """"<이름> 지난 요약" — 담당 내담자일 때만 직전 세션 요약을 돌려준다."""
    name = _extract_client_name(text)
    client = agent_policy.find_linked_client(counselor_id, name, db) if name else None
    if client is None:
        return (
            "담당 내담자 중에서 찾을 수 없어요. "
            "'<내담자 이름> 지난 요약' 형태로 이름을 정확히 적어 주시면 찾아 드릴게요."
        )

    facts = _latest_record_facts(db, counselor_id, client.id)
    if facts is None:
        return f"{client.name} 님의 지난 상담에는 남아 있는 기록이 없어요."

    lines = [f"{client.name} 님 지난 상담({facts['scheduled_text']}) 기록이에요."]
    if facts.get("headline"):
        lines.append(f"· 한 줄 요약: {facts['headline']}")
    for key, value in (facts.get("sections") or {}).items():
        lines.append(f"· {key}: {value}")
    if facts.get("keywords"):
        lines.append(f"· 키워드: {', '.join(facts['keywords'])}")
    # 상담사 본인이 만든 기록이지만, 진단·점수 표현은 그대로 흘리지 않는다.
    return agent_guard.sanitize("\n".join(lines), fallback="\n".join(lines[:1]))


def _extract_client_name(text: str) -> str | None:
    """"박내담 지난 요약" 처럼 요약 키워드 앞에 붙은 이름을 떼어낸다."""
    cleaned = text.strip()
    for word in _SUMMARY_WORDS:
        index = cleaned.find(word)
        if index > 0:
            candidate = cleaned[:index].strip()
            # 조사·군더더기 제거 후 마지막 토큰을 이름으로 본다.
            candidate = re.sub(r"(님|씨|의|이|가)$", "", candidate).strip()
            tokens = candidate.split()
            if tokens:
                return tokens[-1]
    return None


def _latest_record_facts(db: DBSession, counselor_id: UUID, client_id: UUID) -> dict | None:
    """담당 내담자의 가장 최근(지난) 세션 기록 요약 — 본인이 host 인 세션만."""
    from app.models.session import Session, SessionParticipant

    rows = (
        db.query(Session)
        .join(SessionParticipant, SessionParticipant.session_id == Session.id)
        .filter(
            Session.host_id == counselor_id,
            Session.is_template.is_(False),
            Session.scheduled_at.is_not(None),
            Session.scheduled_at <= _now(),
            Session.status.not_in(list(agent_policy.CANCELLED_STATUSES)),
            SessionParticipant.user_id == client_id,
            SessionParticipant.is_waitlisted.is_(False),
        )
        .order_by(Session.scheduled_at.desc())
        .limit(5)
        .all()
    )
    for session in rows:
        facts = agent_policy.record_facts(session.id, db)
        if facts["has_summary"]:
            facts["scheduled_text"] = agent_policy.format_schedule(session.scheduled_at)
            return facts
    return None


# ---------------------------------------------------------------------------
# CTA 실행 (기록용)
# ---------------------------------------------------------------------------

# 상담사 채널 CTA 는 모두 화면 이동이다 — 서버 상태를 바꾸는 CTA 가 없다.
COUNSELOR_NAVIGATION_ACTIONS = frozenset(
    {"open_schedule", "open_client", "open_record", "open_report", "open_change_requests"}
)


def execute_cta(db: DBSession, user_id: str | UUID, message_id: str, cta_id: str) -> dict:
    """CTA 실행 기록 — 본인 대화방 메시지만. 상태 변경은 없다(이동용 200 응답)."""
    uid = agent_service._to_uuid(user_id)
    message = (
        db.query(AgentMessage)
        .join(AgentConversation, AgentConversation.id == AgentMessage.conversation_id)
        .filter(
            AgentMessage.id == agent_service._to_uuid(message_id),
            AgentConversation.user_id == uid,
            AgentConversation.channel == CHANNEL,
        )
        .first()
    )
    if message is None:
        raise HTTPException(status_code=404, detail="메시지를 찾을 수 없습니다")

    target = next((c for c in (message.cta or []) if c.get("id") == cta_id), None)
    if target is None:
        raise HTTPException(status_code=404, detail="해당 동작을 찾을 수 없습니다")
    if target.get("action") not in COUNSELOR_NAVIGATION_ACTIONS:
        raise HTTPException(status_code=400, detail="지원하지 않는 동작입니다")
    return {"cta": target}
