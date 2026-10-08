"""SDD-188: AI 에이전트 서비스 — 대화·동의·메시지·CTA·중계 이벤트.

에이전트 메시지를 만드는 모든 경로(예약 노티 스윕, 리포트 승인 훅, 사용자 응답)가
`post_agent_message()` 하나를 거친다. 거기서 인앱 알림(ws)과 푸시 Outbox 적재까지
함께 처리하므로 알림 누락·중복 규칙이 한 곳에 모인다.

푸시 본문은 비식별 고정 문구다 — 잠금화면에 상담 내용·이름이 노출되면 안 된다(기획 §4).
실제 푸시 발송 consumer 와 디바이스 토큰은 SDD-190 범위이며, 여기서는 `channel="push"`
행을 pending 으로 남긴다(기존 ws/email cron 은 channel 을 명시 필터해 이 행을 건드리지 않는다).
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from urllib.parse import quote
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DBSession

from app.models.agent import (
    AgentConversation,
    AgentDeliveryLog,
    AgentMessage,
    AgentRelayEvent,
)
from app.models.chat import ChatRoom
from app.models.consent import Consent
from app.models.notification_outbox import NotificationOutbox
from app.models.session import Session
from app.models.user import User
from app.services import agent_guard, agent_llm, agent_policy, notification_service

logger = logging.getLogger(__name__)

# 동의(D1) — 가입 후 첫 대화 진입 시 1회. 문구 개정 시 버전을 올려 재동의를 받는다.
AGENT_CONSENT_TYPE = "ai_agent"
AGENT_CONSENT_VERSION = "1.0"

# 내담자 앱의 AI 대화 화면 딥링크 (프론트 라우트 /app/ai)
AGENT_DEEPLINK = "/app/ai"
# SDD-189: 상담사 웹의 AI 비서 화면 딥링크 (프론트 라우트 /agent)
COUNSELOR_AGENT_DEEPLINK = "/agent"

# 푸시 비식별 고정 문구 — 이름·상담 내용·리포트 문장을 담지 않는다.
PUSH_TITLE = "루시 (AI)"
PUSH_BODY = "루시가 메시지를 보냈어요"
# SDD-189 브리핑 푸시 문구 — 내담자 이름·상담 내용이 잠금화면에 보이면 안 된다.
PUSH_BODY_BRIEFING = "루시가 브리핑을 보냈어요"

# 채널 식별자 — AgentConversation.channel 값.
CHANNEL_CLIENT = "client"
CHANNEL_COUNSELOR = "counselor"

# 채널별 딥링크 — 푸시/인앱 알림이 어느 화면으로 보낼지 가른다.
CHANNEL_DEEPLINKS: dict[str, str] = {
    CHANNEL_CLIENT: AGENT_DEEPLINK,
    CHANNEL_COUNSELOR: COUNSELOR_AGENT_DEEPLINK,
}

# 사후 피드백 자유 서술을 같은 relay event 에 누적하는 시간 창(분).
# 이 창을 넘어선 일반 대화는 피드백으로 수집하지 않는다.
FEEDBACK_COLLECT_WINDOW_MIN = 60

# 일정 변경 문의 사유 길이 제한 (Contract: 1~500자)
CHANGE_REASON_MIN = 1
CHANGE_REASON_MAX = 500

# 지도 검색 URL — 프론트는 이 도메인만 렌더하면 된다(임의 스킴 차단).
MAP_SEARCH_BASE = "https://map.kakao.com/?q="

FEEDBACK_CHOICE_LABELS: dict[str, str] = {
    "helpful": "도움이 됐어요",
    "neutral": "보통이었어요",
    "disappointed": "아쉬웠어요",
}


def _to_uuid(value: str | UUID) -> UUID:
    try:
        return value if isinstance(value, UUID) else UUID(str(value))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="잘못된 ID 형식입니다")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _ensure_aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


# ---------------------------------------------------------------------------
# 대화방 · 직렬화
# ---------------------------------------------------------------------------


def get_or_create_conversation(
    db: DBSession, user_id: str | UUID, channel: str = "client"
) -> AgentConversation:
    """(사용자, 채널) 대화방을 가져오거나 만든다 — 유니크 경합에 안전하게 멱등."""
    uid = _to_uuid(user_id)
    existing = (
        db.query(AgentConversation)
        .filter(AgentConversation.user_id == uid, AgentConversation.channel == channel)
        .first()
    )
    if existing is not None:
        return existing

    conversation = AgentConversation(user_id=uid, channel=channel)
    try:
        with db.begin_nested():
            db.add(conversation)
        db.flush()
        return conversation
    except IntegrityError:
        # 동시 요청이 먼저 만든 경우 — 그 행을 쓴다.
        return (
            db.query(AgentConversation)
            .filter(AgentConversation.user_id == uid, AgentConversation.channel == channel)
            .one()
        )


def serialize_message(message: AgentMessage) -> dict:
    """Contract(AgentMessage) 형태로 직렬화."""
    return {
        "id": str(message.id),
        "sender": message.sender,
        "kind": message.kind,
        "content": message.content,
        "cta": list(message.cta or []),
        "ref_type": message.ref_type,
        "ref_id": str(message.ref_id) if message.ref_id else None,
        "read_at": message.read_at,
        "created_at": message.created_at or _now(),
    }


# ---------------------------------------------------------------------------
# 동의 (D1)
# ---------------------------------------------------------------------------


def has_consent(db: DBSession, user_id: str | UUID) -> bool:
    uid = _to_uuid(user_id)
    return (
        db.query(Consent.id)
        .filter(
            Consent.user_id == uid,
            Consent.type == AGENT_CONSENT_TYPE,
            Consent.version == AGENT_CONSENT_VERSION,
            Consent.agreed.is_(True),
        )
        .first()
        is not None
    )


def consent_status(db: DBSession, user_id: str | UUID) -> dict:
    return {"agreed": has_consent(db, user_id), "version": AGENT_CONSENT_VERSION}


def grant_consent(db: DBSession, user_id: str | UUID) -> dict:
    """동의 1회 기록 — 이미 동의했으면 그대로 둔다(재동의 요구 없음)."""
    uid = _to_uuid(user_id)
    existing = (
        db.query(Consent)
        .filter(
            Consent.user_id == uid,
            Consent.type == AGENT_CONSENT_TYPE,
            Consent.version == AGENT_CONSENT_VERSION,
        )
        .first()
    )
    if existing is None:
        try:
            with db.begin_nested():
                db.add(
                    Consent(
                        user_id=uid,
                        type=AGENT_CONSENT_TYPE,
                        version=AGENT_CONSENT_VERSION,
                        agreed=True,
                    )
                )
            db.commit()
        except IntegrityError:
            db.rollback()
    elif not existing.agreed:
        existing.agreed = True
        db.commit()
    return {"agreed": True, "version": AGENT_CONSENT_VERSION}


def require_consent(db: DBSession, user_id: str | UUID) -> None:
    """쓰기 경로(메시지 전송·CTA 실행·중계)의 동의 게이트."""
    if not has_consent(db, user_id):
        raise HTTPException(status_code=403, detail="agent_consent_required")


# ---------------------------------------------------------------------------
# 메시지 생성 (에이전트 선발화 단일 진입점)
# ---------------------------------------------------------------------------


def post_agent_message(
    db: DBSession,
    user_id: str | UUID,
    *,
    kind: str,
    content: str,
    cta: list[dict] | None = None,
    ref_type: str | None = None,
    ref_id: str | UUID | None = None,
    sender: str = "agent",
    notify: bool = True,
    commit: bool = True,
    channel: str = CHANNEL_CLIENT,
    push_body: str | None = None,
) -> AgentMessage:
    """에이전트/시스템 메시지를 저장하고 (notify=True 면) 인앱·푸시 알림을 적재한다.

    channel 로 내담자 채널(client)과 상담사 채널(counselor)을 가른다 — 두 채널은
    서로 다른 대화방이므로 메시지가 섞이지 않는다.
    """
    uid = _to_uuid(user_id)
    conversation = get_or_create_conversation(db, uid, channel)
    message = AgentMessage(
        conversation_id=conversation.id,
        sender=sender,
        kind=kind,
        content=content,
        cta=list(cta or []),
        ref_type=ref_type,
        ref_id=_to_uuid(ref_id) if ref_id else None,
        # 명시적 시각 부여 — server_default(now()) 는 트랜잭션 타임스탬프라서 같은
        # 트랜잭션 안에서 user/agent 메시지가 동일한 created_at 을 갖게 되고,
        # 정렬(created_at, id)에서 uuid 가 랜덤이라 순서가 뒤바뀐다. 생성 시점을
        # 명시해 두면 user(LLM 전) < agent(LLM 후) 순서가 항상 보장된다.
        created_at=_now(),
    )
    db.add(message)
    db.flush()

    if notify:
        _enqueue_notifications(db, uid, message, channel=channel, push_body=push_body)

    if commit:
        db.commit()
        db.refresh(message)
    return message


def post_user_message(
    db: DBSession,
    user_id: str | UUID,
    content: str,
    *,
    commit: bool = False,
    channel: str = CHANNEL_CLIENT,
) -> AgentMessage:
    """사용자 발화 저장 — 본인이 쓴 글이므로 생성 시점에 읽음 처리한다."""
    uid = _to_uuid(user_id)
    conversation = get_or_create_conversation(db, uid, channel)
    message = AgentMessage(
        conversation_id=conversation.id,
        sender="user",
        kind="free",
        content=content,
        cta=[],
        read_at=_now(),
        # post_agent_message 와 동일한 이유로 명시적 시각 — LLM 응답 전 시점이라
        # 같은 턴의 agent 메시지보다 항상 앞선다.
        created_at=_now(),
    )
    db.add(message)
    db.flush()
    if commit:
        db.commit()
        db.refresh(message)
    return message


def _enqueue_notifications(
    db: DBSession,
    user_id: UUID,
    message: AgentMessage,
    *,
    channel: str = CHANNEL_CLIENT,
    push_body: str | None = None,
) -> None:
    """인앱(ws) 알림 + 푸시 Outbox 적재.

    두 채널 모두 본문에 상담 내용을 담지 않는다 — 내용은 대화창에서 확인한다.
    상담사 브리핑도 같다: 내담자 이름·상담 내용이 잠금화면에 보이면 안 된다(TS10).
    푸시는 consumer 가 없어 pending 으로 남는다(SDD-190).
    """
    deeplink = CHANNEL_DEEPLINKS.get(channel, AGENT_DEEPLINK)
    body = push_body or PUSH_BODY
    extra = notification_service.build_standard_extra(
        "agent_message",
        "notice",
        str(message.id),
        params={"deeplink": deeplink, "kind": message.kind},
    )
    try:
        notification_service.notify_event(
            "agent_message",
            user_id,
            {"title": PUSH_TITLE, "body": body, "extra": extra},
            db,
            commit=False,
        )
    except Exception:  # noqa: BLE001 — 알림 실패가 메시지 생성을 막지 않는다
        logger.exception("[agent_service] 인앱 알림 적재 실패: message_id=%s", message.id)

    # 푸시 Outbox — payload 에 PII·상담 내용 없음(TS15).
    db.add(
        NotificationOutbox(
            user_id=user_id,
            channel="push",
            payload={
                "title": PUSH_TITLE,
                "body": body,
                "deeplink": deeplink,
                "message_id": str(message.id),
            },
            status="pending",
        )
    )
    db.flush()


# ---------------------------------------------------------------------------
# 발송 로그 (멱등)
# ---------------------------------------------------------------------------


def claim_delivery(
    db: DBSession,
    *,
    kind: str,
    ref_id: str | UUID,
    offset_min: int,
    user_id: str | UUID,
    payload: dict | None = None,
) -> bool:
    """발송 로그를 원자적으로 선점한다 — True 면 이 실행이 발송 담당.

    reminder_service._log_delivery 와 같은 패턴. UNIQUE 제약이 중복 실행을 막으므로
    스윕이 겹쳐도 메시지는 1건만 생성된다.
    """
    try:
        with db.begin_nested():
            db.add(
                AgentDeliveryLog(
                    kind=kind,
                    ref_id=_to_uuid(ref_id),
                    offset_min=int(offset_min),
                    user_id=_to_uuid(user_id),
                    payload=payload,
                )
            )
        db.flush()
        return True
    except IntegrityError:
        logger.info(
            "[agent_service] 이미 발송됨 (kind=%s, ref=%s, offset=%s)", kind, ref_id, offset_min
        )
        return False


def find_delivery(
    db: DBSession, *, kind: str, ref_id: str | UUID, user_id: str | UUID
) -> AgentDeliveryLog | None:
    """해당 대상·수신자의 최근 발송 로그 1건 (일정 변경 감지에 사용)."""
    return (
        db.query(AgentDeliveryLog)
        .filter(
            AgentDeliveryLog.kind == kind,
            AgentDeliveryLog.ref_id == _to_uuid(ref_id),
            AgentDeliveryLog.user_id == _to_uuid(user_id),
        )
        .order_by(AgentDeliveryLog.created_at.desc())
        .first()
    )


# ---------------------------------------------------------------------------
# 조회 · 읽음
# ---------------------------------------------------------------------------


def list_messages(
    db: DBSession,
    user_id: str | UUID,
    *,
    before: datetime | None = None,
    limit: int = 30,
    channel: str = CHANNEL_CLIENT,
) -> dict:
    """최신순 메시지 목록 + 더 있는지 여부."""
    conversation = get_or_create_conversation(db, user_id, channel)
    limit = max(1, min(int(limit), 100))
    query = db.query(AgentMessage).filter(AgentMessage.conversation_id == conversation.id)
    if before is not None:
        query = query.filter(AgentMessage.created_at < _ensure_aware(before))
    rows = (
        query.order_by(AgentMessage.created_at.desc(), AgentMessage.id.desc())
        .limit(limit + 1)
        .all()
    )
    has_more = len(rows) > limit
    return {
        "items": [serialize_message(m) for m in rows[:limit]],
        "has_more": has_more,
    }


def mark_read(
    db: DBSession,
    user_id: str | UUID,
    up_to: datetime | None = None,
    *,
    channel: str = CHANNEL_CLIENT,
) -> int:
    """에이전트/시스템 메시지를 읽음 처리하고 남은 미읽음 수를 반환한다."""
    conversation = get_or_create_conversation(db, user_id, channel)
    query = db.query(AgentMessage).filter(
        AgentMessage.conversation_id == conversation.id,
        AgentMessage.read_at.is_(None),
    )
    if up_to is not None:
        query = query.filter(AgentMessage.created_at <= _ensure_aware(up_to))
    query.update({"read_at": _now()}, synchronize_session=False)
    db.commit()
    return unread_count(db, user_id, channel=channel)


def unread_count(
    db: DBSession, user_id: str | UUID, *, channel: str = CHANNEL_CLIENT
) -> int:
    conversation = get_or_create_conversation(db, user_id, channel)
    return (
        db.query(AgentMessage)
        .filter(
            AgentMessage.conversation_id == conversation.id,
            AgentMessage.read_at.is_(None),
            AgentMessage.sender != "user",
        )
        .count()
    )


# ---------------------------------------------------------------------------
# CTA 구성 (예약 노티·리포트 메시지가 공유)
# ---------------------------------------------------------------------------


def map_search_url(address: str) -> str:
    """주소 검색 지도 URL — 주소를 URL 인코딩해 붙인다."""
    return MAP_SEARCH_BASE + quote(address, safe="")


def _direct_room_id(db: DBSession, counselor_id: UUID, client_id: UUID) -> str | None:
    """기존 1:1 채팅방 id — 없으면 None(스윕에서 방을 새로 만들지 않는다)."""
    room = (
        db.query(ChatRoom)
        .filter(
            ChatRoom.room_type == "direct",
            ChatRoom.host_id == counselor_id,
            ChatRoom.name == str(client_id),
        )
        .first()
    )
    return str(room.id) if room else None


def build_session_ctas(
    db: DBSession, facts: dict, client_id: str | UUID, *, include_ack: bool = True
) -> list[dict]:
    """예약 안내 메시지의 CTA 목록.

    - 오프라인 + 주소 있음 → 길찾기. 주소가 없으면 길찾기 CTA 자체를 넣지 않는다(TS5).
    - 온라인 → 입장하기
    - 전화는 상담사 번호가 있을 때만(D11)
    """
    session_id = facts["session_id"]
    ctas: list[dict] = []
    if include_ack:
        ctas.append({"id": "ack", "action": "ack", "label": "확인했어요", "done": False})

    if facts.get("location_type") == "online":
        ctas.append({
            "id": "join_session",
            "action": "join_session",
            "label": "입장하기",
            "payload": {"session_id": session_id, "url": f"/app/sessions/{session_id}"},
        })
    elif facts.get("location_address"):
        ctas.append({
            "id": "open_map",
            "action": "open_map",
            "label": "길찾기",
            "payload": {"url": map_search_url(facts["location_address"])},
        })

    ctas.append({
        "id": "request_change",
        "action": "request_change",
        "label": "일정 변경 문의",
        "payload": {"session_id": session_id},
        "done": False,
    })

    room_id = _direct_room_id(db, _to_uuid(facts["counselor_id"]), _to_uuid(client_id))
    ctas.append({
        "id": "open_chat",
        "action": "open_chat",
        "label": "상담사에게 메시지",
        "payload": {
            "room_id": room_id,
            "url": f"/app/chat/{room_id}" if room_id else "/app/chat",
        },
    })

    if facts.get("counselor_phone"):
        ctas.append({
            "id": "call_counselor",
            "action": "call_counselor",
            "label": "상담사에게 전화",
            "payload": {"tel": facts["counselor_phone"]},
        })
    return ctas


def build_report_ctas(report_id: str) -> list[dict]:
    """리포트 메시지의 CTA — 리포트 보기 + 3지선다 피드백(D9, 숫자 척도 없음)."""
    ctas: list[dict] = [
        {
            "id": "open_report",
            "action": "open_report",
            "label": "리포트 보기",
            "payload": {"url": f"/app/reports/{report_id}"},
        }
    ]
    for choice, label in FEEDBACK_CHOICE_LABELS.items():
        ctas.append({
            "id": f"feedback_{choice}",
            "action": "feedback_choice",
            "label": label,
            "payload": {"choice": choice},
            "done": False,
        })
    return ctas


# ---------------------------------------------------------------------------
# 중계 이벤트
# ---------------------------------------------------------------------------


def create_relay_event(
    db: DBSession,
    *,
    kind: str,
    source_user_id: str | UUID,
    target_user_id: str | UUID | None,
    session_id: str | UUID | None,
    payload: dict,
    commit: bool = False,
) -> AgentRelayEvent:
    event = AgentRelayEvent(
        kind=kind,
        source_user_id=_to_uuid(source_user_id),
        target_user_id=_to_uuid(target_user_id) if target_user_id else None,
        session_id=_to_uuid(session_id) if session_id else None,
        payload=payload,
        status="pending",
    )
    db.add(event)
    db.flush()
    if commit:
        db.commit()
    return event


def _active_feedback_event(db: DBSession, user_id: UUID) -> AgentRelayEvent | None:
    """피드백 자유 서술을 누적할 대상 이벤트 — 최근 창(FEEDBACK_COLLECT_WINDOW_MIN) 안의 pending."""
    cutoff = _now() - timedelta(minutes=FEEDBACK_COLLECT_WINDOW_MIN)
    return (
        db.query(AgentRelayEvent)
        .filter(
            AgentRelayEvent.kind == "feedback",
            AgentRelayEvent.source_user_id == user_id,
            AgentRelayEvent.status == "pending",
            AgentRelayEvent.created_at >= cutoff,
        )
        .order_by(AgentRelayEvent.created_at.desc())
        .first()
    )


def _append_feedback_text(db: DBSession, event: AgentRelayEvent, text: str) -> None:
    """D10: 부정 피드백 포함 자유 서술을 **원문 그대로** 누적한다(요약·순화 금지)."""
    payload = dict(event.payload or {})
    texts = list(payload.get("texts") or [])
    texts.append(text)
    payload["texts"] = texts
    event.payload = payload
    db.flush()


# ---------------------------------------------------------------------------
# 사용자 자유 메시지 → 에이전트 응답
# ---------------------------------------------------------------------------

# 리포트 범위를 벗어난 질문(진단·병명·약 등)에 쓰는 안내. LLM 을 거치지 않는다.
OUT_OF_SCOPE_REPLY = (
    "그 부분은 제가 말씀드릴 수 있는 범위가 아니에요. "
    "상담사님과 이야기해 보시면 좋겠어요. 지금 마음은 어떠신지 들려주실 수 있을까요?"
)

# SDD-193: 리포트·일정이 없는 내담자도 감정 대화를 나눈다 — 친근한 친구 톤 폴백.
COMPANION_REPLY_FALLBACKS: tuple[str, ...] = (
    "그런 마음이 들었군요. 오늘 하루는 어떤 일들이 있었는지 조금 더 들려주실 수 있을까요?",
    "지금 마음이 좀 무거우셨나 봐요. 편하게 말씀해 주세요. 어떤 점이 가장 힘든지 듣고 싶어요.",
    "들려주셔서 고마워요. 요즘은 어떤 순간에 그 마음이 가장 크게 느껴지나요?",
    "듣고 있어요. 오늘은 어떤 기분으로 지내셨는지 조금 더 이야기해 주실래요?",
)


def _companion_reply(user_text: str) -> str:
    """담당 상담사·리포트·일정이 없는 내담자도 감정 대화로 응답한다(SDD-193 결정 1).

    사실 정보(리포트·일정)가 없으므로 LLM 은 감정 공감 + 열린 질문만 만들고,
    실패 시 고정 폴백으로 완결된다. 프로파일 축적 대상(담당 상담사)이 없으므로
    이 경로는 체크인 없이 대화만 한다.
    """
    fallback = COMPANION_REPLY_FALLBACKS[len(user_text) % len(COMPANION_REPLY_FALLBACKS)]
    task = (
        "내담자의 오늘 기분과 감정을 편안한 친구처럼 들어 주세요. "
        "한 문장으로 따뜻하게 공감하고, 왜 그런 마음이 들었는지 열린 질문 하나만 덧붙이세요. "
        "조언·해석·진단·처방을 하지 마세요. 상태를 숫자나 점수로 표현하지 마세요. "
        "2~3문장을 넘기지 마세요."
    )
    prompt = agent_llm.build_prompt(
        "(감정 대화 — 참고 자료 없음)", user_text=user_text, task=task
    )
    return agent_llm.generate(prompt, fallback)


def send_user_message(db: DBSession, user_id: str | UUID, content: str) -> dict:
    """사용자 메시지 저장 + 에이전트 응답 생성 (동의 필수)."""
    require_consent(db, user_id)
    uid = _to_uuid(user_id)
    text = content.strip()

    user_message = post_user_message(db, uid, text)

    # 사후 피드백 수집 창이 열려 있으면 원문 그대로 중계 이벤트에 누적한다(D10).
    feedback_event = _active_feedback_event(db, uid)
    if feedback_event is not None:
        _append_feedback_text(db, feedback_event, text)

    reply_text, reply_kind, reply_cta = _route_reply(
        db, uid, text, user_message, in_feedback=feedback_event is not None
    )
    agent_message = post_agent_message(
        db,
        uid,
        kind=reply_kind,
        content=reply_text,
        cta=reply_cta,
        notify=False,  # 사용자가 대화창에 있는 중이므로 푸시를 보내지 않는다
        commit=False,
    )
    db.commit()
    db.refresh(user_message)
    db.refresh(agent_message)
    # 로그에 대화 원문을 남기지 않는다 — 길이만 기록한다(보안 리뷰 항목).
    logger.info(
        "[agent_service] 사용자 메시지 처리 (user=%s, chars=%d, kind=%s)", uid, len(text), reply_kind
    )
    return {
        "user_message": serialize_message(user_message),
        "agent_message": serialize_message(agent_message),
    }


def _route_reply(
    db: DBSession,
    user_id: UUID,
    user_text: str,
    user_message: AgentMessage,
    *,
    in_feedback: bool = False,
) -> tuple[str, str, list[dict]]:
    """SDD-191 라우팅 — ① 위험 탐지 ② 안부 대화 ③ 기존 리포트 대화·일반 응답.

    위험 탐지가 가장 앞에 오는 것은 의도적이다: 규칙 기반이라 LLM 지시 이전 단계에서
    끝나므로 프롬프트 인젝션으로 우회할 수 없다. 탐지 시 응답은 LLM 을 쓰지 않는 고정
    템플릿이며 감지 사실을 드러내지 않는다(D4).
    """
    # 지연 임포트 — agent_checkin/agent_risk 가 이 모듈을 참조하므로 순환을 피한다.
    from app.services import agent_checkin, agent_risk

    # ① 위험 표현 — 상담사에게만 조용히 알리고, 내담자에게는 고정 안전 응답을 돌려준다.
    risk_reply = agent_risk.handle_client_message(db, user_id, user_message, user_text)
    if risk_reply is not None:
        # kind 는 평범한 "free" 로 둔다 — 메시지 종류로도 감지 사실이 드러나면 안 된다.
        return risk_reply["content"], "free", list(risk_reply["cta"])

    # ② 열린 안부 대화, 또는 담당 상담사가 있는 내담자의 대화
    #   started_at 을 사용자 메시지 시각으로 넘겨, 방금 저장된 메시지가 체크인 구간에
    #   포함되게 한다(created_at >= started_at 필터 회귀 방지).
    checkin = agent_checkin.ensure_checkin_for_conversation(
        db, user_id, started_at=user_message.created_at
    )
    if checkin is not None:
        content, kind = agent_checkin.respond(db, user_id, checkin, user_text)
        return content, kind, []

    # ③ 기존 경로(SDD-188) — 리포트 대화·일반 응답
    reply_text, reply_kind = _build_reply(db, user_id, user_text, in_feedback=in_feedback)
    return reply_text, reply_kind, []


def _build_reply(
    db: DBSession, user_id: UUID, user_text: str, *, in_feedback: bool = False
) -> tuple[str, str]:
    """(응답 본문, kind) — 리포트 본문 범위 안에서만 답한다."""
    # 진단·병명·약 등 금지 주제는 LLM 을 거치지 않고 상담사 연결로 안내한다.
    if agent_guard.is_blocked(user_text):
        return OUT_OF_SCOPE_REPLY, "free"

    context = agent_policy.client_context(user_id, db)
    reports = context.get("reports") or []
    sessions = context.get("sessions") or []
    if not reports and not sessions:
        # SDD-193: 리포트·일정이 없어도 감정 대화로 응답한다(친근한 친구).
        return _companion_reply(user_text), "free"

    fallback = _fallback_reply(context, in_feedback=in_feedback)
    task = (
        "내담자가 남긴 이야기에 짧게 공감하고, [허용 자료]의 리포트 본문 범위 안에서만 "
        "설명하세요. 자료에 없는 내용은 상담사님과 이야기해 보시라고 안내하세요. "
        "마지막에 열린 질문 하나를 덧붙이세요."
    )
    prompt = agent_llm.build_prompt(
        agent_policy.context_to_text(context), user_text=user_text, task=task
    )
    reply = agent_llm.generate(prompt, fallback)
    return reply, ("report_chat" if reports else "free")


def _fallback_reply(context: dict, *, in_feedback: bool = False) -> str:
    """LLM 없이 쓰는 규칙 템플릿 — 키 부재·지연·실패 시 항상 이 문장으로 응답한다."""
    if in_feedback:
        return (
            "들려주셔서 고맙습니다. 남겨 주신 이야기는 상담사님께 그대로 전해 드릴게요. "
            "더 하고 싶은 말씀이 있으면 편하게 이어서 적어 주세요."
        )
    reports = context.get("reports") or []
    if reports:
        quotes = agent_policy.report_quotes(reports[0])
        if quotes:
            return (
                f"리포트에는 이렇게 적혀 있어요. “{quotes[0]}” "
                "제가 새로 해석하지는 않고, 적힌 내용 안에서 함께 살펴볼게요. "
                "이 부분을 읽으면서 어떤 생각이 드셨어요?"
            )
        return (
            "리포트를 함께 보면서 이야기할 수 있어요. "
            "어떤 부분이 가장 궁금하셨는지 알려 주시면 그 대목을 같이 살펴볼게요."
        )
    sessions = context.get("sessions") or []
    item = sessions[0]
    return (
        f"다음 상담은 {item['scheduled_text']}, {item['counselor_name']} 선생님과 함께예요. "
        "그때까지 어떻게 지내고 계신지 들려주실 수 있을까요?"
    )


# ---------------------------------------------------------------------------
# CTA 실행
# ---------------------------------------------------------------------------

# 서버가 상태를 바꾸지 않고 클라이언트 이동만 하는 액션 (기록용 200 응답)
_NAVIGATION_ACTIONS = frozenset(
    {
        "open_map",
        "join_session",
        "open_chat",
        "call_counselor",
        "open_report",
        # SDD-191: 담당 상담사와의 direct 채팅방으로 이동(서버 상태 변경 없음).
        "talk_to_counselor",
    }
)


def execute_cta(
    db: DBSession,
    user_id: str | UUID,
    message_id: str,
    cta_id: str,
    *,
    reason: str | None = None,
    text: str | None = None,
) -> dict:
    """CTA 실행 — 소유자 검증 후 액션별로 처리한다(IDOR 방지)."""
    require_consent(db, user_id)
    uid = _to_uuid(user_id)
    mid = _to_uuid(message_id)

    # 본인 대화방의 메시지만 조작할 수 있다. 타인 메시지 id 는 404.
    message = (
        db.query(AgentMessage)
        .join(AgentConversation, AgentConversation.id == AgentMessage.conversation_id)
        .filter(AgentMessage.id == mid, AgentConversation.user_id == uid)
        .first()
    )
    if message is None:
        raise HTTPException(status_code=404, detail="메시지를 찾을 수 없습니다")

    ctas = list(message.cta or [])
    target = next((c for c in ctas if c.get("id") == cta_id), None)
    if target is None:
        raise HTTPException(status_code=404, detail="해당 동작을 찾을 수 없습니다")

    action = target.get("action")
    if action in _NAVIGATION_ACTIONS:
        # 서버 상태 변경 없음 — 프론트 이동용. done 처리하지 않는다.
        return {"cta": target, "agent_message": None}

    if action == "ack":
        return _handle_ack(db, uid, message, ctas, target)
    if action == "request_change":
        return _handle_request_change(db, uid, message, ctas, target, reason)
    if action == "feedback_choice":
        return _handle_feedback_choice(db, uid, message, ctas, target, text)

    raise HTTPException(status_code=400, detail="지원하지 않는 동작입니다")


def _replace_cta(
    message: AgentMessage, ctas: list[dict], updated: list[dict], db: DBSession
) -> None:
    """JSONB 컬럼은 재할당해야 변경이 감지된다 — 복사 후 교체(불변성 규칙)."""
    message.cta = updated
    db.flush()


def _mark_done(ctas: list[dict], cta_ids: set[str]) -> tuple[list[dict], dict]:
    """지정한 CTA 들을 done 으로 바꾼 새 목록과 대표 CTA 를 반환한다."""
    updated = [
        ({**c, "done": True} if c.get("id") in cta_ids else c) for c in ctas
    ]
    primary = next(c for c in updated if c.get("id") in cta_ids)
    return updated, primary


def _session_host_id(db: DBSession, session_id: UUID | None) -> UUID | None:
    if session_id is None:
        return None
    session = db.get(Session, session_id)
    return session.host_id if session else None


def _handle_ack(
    db: DBSession, uid: UUID, message: AgentMessage, ctas: list[dict], target: dict
) -> dict:
    """확인했어요 — 중계 이벤트(ack) 기록 후 버튼 비활성. 두 번 눌러도 1건(멱등)."""
    if target.get("done"):
        return {"cta": target, "agent_message": None}

    session_id = message.ref_id if message.ref_type == "session" else None
    create_relay_event(
        db,
        kind="ack",
        source_user_id=uid,
        target_user_id=_session_host_id(db, session_id),
        session_id=session_id,
        payload={"message_id": str(message.id), "kind": message.kind},
    )
    updated, primary = _mark_done(ctas, {target["id"]})
    _replace_cta(message, ctas, updated, db)
    db.commit()
    return {"cta": primary, "agent_message": None}


def _handle_request_change(
    db: DBSession,
    uid: UUID,
    message: AgentMessage,
    ctas: list[dict],
    target: dict,
    reason: str | None,
) -> dict:
    """일정 변경 문의 — 사유를 중계 이벤트로 넘기고 상담사에게 인앱 알림을 보낸다."""
    cleaned = (reason or "").strip()
    if not (CHANGE_REASON_MIN <= len(cleaned) <= CHANGE_REASON_MAX):
        raise HTTPException(status_code=400, detail="변경 사유를 1~500자로 입력해 주세요")
    if target.get("done"):
        return {"cta": target, "agent_message": None}

    payload_session = (target.get("payload") or {}).get("session_id")
    session_id = (
        _to_uuid(payload_session)
        if payload_session
        else (message.ref_id if message.ref_type == "session" else None)
    )
    session = db.get(Session, session_id) if session_id else None
    host_id = session.host_id if session else None

    create_relay_event(
        db,
        kind="schedule_change_request",
        source_user_id=uid,
        target_user_id=host_id,
        session_id=session_id,
        # 사유는 상담사가 판단해야 하므로 원문 그대로 넘긴다.
        payload={"reason": cleaned, "message_id": str(message.id)},
    )

    if host_id is not None:
        try:
            notification_service.notify_event(
                "schedule_change_request",
                host_id,
                {
                    "title": "일정 변경 문의가 접수되었습니다",
                    "body": "내담자가 예약 일정 변경을 문의했습니다. 루시(AI) 중계 내용을 확인해 주세요.",
                    "extra": notification_service.build_standard_extra(
                        "schedule_change_request",
                        "session",
                        str(session_id) if session_id else None,
                        params={"session_id": str(session_id) if session_id else None},
                        legacy={"session_id": str(session_id) if session_id else None},
                    ),
                },
                db,
                commit=False,
            )
        except Exception:  # noqa: BLE001 — 알림 실패가 접수를 취소하지 않는다
            logger.exception("[agent_service] 일정 변경 문의 알림 실패: session_id=%s", session_id)

    updated, primary = _mark_done(ctas, {target["id"]})
    _replace_cta(message, ctas, updated, db)

    when = session and agent_policy.format_schedule(session.scheduled_at)
    confirm = (
        f"일정 변경 문의를 접수했어요. 현재 예약은 {when} 입니다. "
        "상담사님께 전달해 두었으니 확인 후 안내드릴게요."
        if when
        else "일정 변경 문의를 접수했어요. 상담사님께 전달해 두었으니 확인 후 안내드릴게요."
    )
    agent_message = post_agent_message(
        db, uid, kind="free", content=confirm, notify=False, commit=False
    )
    db.commit()
    db.refresh(agent_message)
    return {"cta": primary, "agent_message": serialize_message(agent_message)}


def _handle_feedback_choice(
    db: DBSession,
    uid: UUID,
    message: AgentMessage,
    ctas: list[dict],
    target: dict,
    text: str | None,
) -> dict:
    """3지선다 피드백 — 선택을 중계 이벤트로 저장하고 열린 질문으로 이어간다(D9)."""
    if target.get("done"):
        return {"cta": target, "agent_message": None}

    choice = (target.get("payload") or {}).get("choice")
    if choice not in FEEDBACK_CHOICE_LABELS:
        raise HTTPException(status_code=400, detail="지원하지 않는 피드백 선택입니다")

    report_id = message.ref_id if message.ref_type == "report" else None
    session_id: UUID | None = None
    host_id: UUID | None = None
    if report_id is not None:
        from app.models.record import Report

        report = db.get(Report, report_id)
        if report is not None:
            session_id = report.session_id
            host_id = _session_host_id(db, session_id)

    texts = [text.strip()] if text and text.strip() else []
    create_relay_event(
        db,
        kind="feedback",
        source_user_id=uid,
        target_user_id=host_id,
        session_id=session_id,
        payload={
            "choice": choice,
            # D10: 자유 서술은 원문 그대로 누적한다(요약·순화 금지).
            "texts": texts,
            "report_id": str(report_id) if report_id else None,
        },
    )

    # 3지선다는 한 번만 고르게 한다 — 세 버튼 모두 비활성.
    choice_ids = {c["id"] for c in ctas if c.get("action") == "feedback_choice"}
    updated, _ = _mark_done(ctas, choice_ids)
    primary = next(c for c in updated if c.get("id") == target["id"])
    _replace_cta(message, ctas, updated, db)

    follow_up = _feedback_follow_up(choice)
    agent_message = post_agent_message(
        db, uid, kind="feedback_thanks", content=follow_up, notify=False, commit=False
    )
    db.commit()
    db.refresh(agent_message)
    return {"cta": primary, "agent_message": serialize_message(agent_message)}


def _feedback_follow_up(choice: str) -> str:
    """선택별 열린 질문 — 숫자 척도를 쓰지 않고 자유 서술로 이어간다."""
    if choice == "disappointed":
        return (
            "알려 주셔서 고맙습니다. 어떤 점이 아쉬우셨는지 조금 더 이야기해 주실래요? "
            "남겨 주신 말씀은 상담사님께 그대로 전해 드려요."
        )
    if choice == "neutral":
        return (
            "말씀해 주셔서 고맙습니다. 어떤 부분이 조금 아쉬웠거나 더 바라는 점이 있으셨는지 "
            "조금 더 이야기해 주실래요?"
        )
    return (
        "도움이 되셨다니 다행이에요. 어떤 점이 특히 그러셨는지 조금 더 이야기해 주실래요? "
        "남겨 주신 말씀은 상담사님께 그대로 전해 드려요."
    )
