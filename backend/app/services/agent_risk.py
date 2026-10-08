"""SDD-191: 위험 표현 조용한 감지 — 상담사에게만 알리고 내담자에게는 드러내지 않는다(D4).

설계의 핵심 두 가지
1. **감지는 규칙 기반이고 LLM 이전 단계다.** 내담자 입력이 프롬프트에 닿기 전에 문장
   단위 정규식으로 판정하므로, "지시를 무시하라" 같은 프롬프트 인젝션으로 감지를
   우회할 수 없다(verify.md Security).
2. **내담자 응답은 LLM 을 쓰지 않는 고정 템플릿이다.** 감지 사실·레벨·excerpt 가
   내담자 쪽 어디에도(응답 본문·메시지 kind·푸시 payload) 나타나지 않는다.

레벨
- `high` : 자살·자해의 의도·방법·계획 표현
- `watch`: 소멸 소망·절망 표현(의도·방법 없음)

오탐 완화는 "문장을 버리는" 방식이다 — 관용 표현("죽도록 맛있다"), 인용·뉴스·캠페인,
제3자 서술, 부정문이 들어간 문장은 패턴이 걸려도 신호를 만들지 않는다.
한국어 띄어쓰기 변형("죽고싶다", "죽 고 싶")은 공백을 제거한 문자열로 매칭해 흡수한다.

알림 경로(위험 알림은 방해금지 시간을 따지지 않고 즉시 나간다)
- `agent_risk_signals` 1행 (담당 상담사별)
- 상담사 채널 메시지 `kind=risk_alert` — 내담자 실명 + 감지 문장 excerpt(최대 200자)
- 인앱 알림 이벤트 `risk_signal` (본문 비식별)
- 푸시 Outbox (본문 "확인이 필요한 알림이 있어요", 비식별)
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy.orm import Session as DBSession

from app.models.agent import AgentMessage, AgentRiskSignal
from app.models.user import User
from app.services import notification_service

logger = logging.getLogger(__name__)

# 레벨 — Contract(RiskSignal.level)
LEVEL_HIGH = "high"
LEVEL_WATCH = "watch"
# 상승 판정용 서열. 숫자는 비교에만 쓰고 어디에도 노출하지 않는다.
_LEVEL_ORDER: dict[str, int] = {LEVEL_WATCH: 1, LEVEL_HIGH: 2}

# 같은 (내담자, 상담사, 레벨) 조합의 재발을 억제하는 창(분).
SUPPRESS_WINDOW_MIN = 30

# excerpt 상한 — 감지된 문장만 담고 대화 원문 전체는 담지 않는다(Edge Case).
EXCERPT_MAX_LENGTH = 200

# 안전 템플릿 반복 남발 방지 — 이 창 안에서 이미 몇 번 안내했는지 센다.
SAFE_REPLY_WINDOW_MIN = 30

# 상담사 채널 메시지 kind / CTA — Contract 확장분.
KIND_RISK_ALERT = "risk_alert"
CTA_TALK_TO_COUNSELOR = "talk_to_counselor"
CTA_LABEL_TALK_TO_COUNSELOR = "상담사님과 대화하기"

# 인앱 알림 이벤트 (notification_service.EVENT_CATALOG 등록분)
RISK_NOTIFICATION_EVENT = "risk_signal"

# 푸시 비식별 문구 — 이름·위험 문장·레벨을 담지 않는다(TS15).
PUSH_BODY_RISK = "확인이 필요한 알림이 있어요"


# ---------------------------------------------------------------------------
# 규칙 기반 탐지
# ---------------------------------------------------------------------------

# 문장 분리 — 종결부호·줄바꿈 기준. 쉼표는 경계로 보지 않는다(인용 맥락이 끊기면 안 됨).
_SENTENCE_SPLIT = re.compile(r"(?<=[.!?。？！])\s+|[\n·•]+")

# 띄어쓰기·반복 자모 변형 흡수용. 공백과 가운뎃점류를 지운 문자열로 패턴을 맞춘다.
_SPACE_RE = re.compile(r"[\s​~\-_.]+")

# high — 의도·방법·계획이 드러나는 표현.
_HIGH_PATTERNS: tuple[re.Pattern[str], ...] = tuple(
    re.compile(p) for p in (
        r"죽고싶",
        r"죽고파",
        r"죽어버리고싶",
        r"죽으려고",
        r"죽을방법",
        r"죽는방법",
        r"자살",
        r"자해",
        r"목숨을(?:끊|버리|놓)",
        r"극단적선택",
        r"손목을?(?:긋|그어|그었|자르|잘라|칼)",
        r"(?:삶|인생|목숨)을?끝(?:내|낼|냈)",
        r"손목에칼",
        r"약을한꺼번에",
        r"약을모아",
        r"수면제를모",
        r"유서",
        r"뛰어내리",
        r"번개탄",
    )
)

# watch — 소멸 소망·절망. 방법·의도 표현이 없는 단계.
_WATCH_PATTERNS: tuple[re.Pattern[str], ...] = tuple(
    re.compile(p) for p in (
        r"사라지고싶",
        r"없어지고싶",
        r"살기싫",
        r"살고싶지않",
        r"살아갈이유가없",
        r"끝내고싶",
        r"모든걸끝",
        r"다끝내고싶",
        r"태어나지않았으면",
    )
)

# 관용 표현 — 강조의 "죽~". 의도와 무관하다("죽도록 맛있다", "배고파 죽겠어요").
_IDIOM_PATTERNS: tuple[re.Pattern[str], ...] = tuple(
    re.compile(p) for p in (
        r"죽도록",
        r"죽을만큼",
        r"죽겠(?:어|다|네|군|습니다)",
        r"죽을뻔",
        r"웃겨죽",
        r"좋아죽",
    )
)

# 인용·보도·창작물·캠페인 맥락. 내담자 자신의 상태 서술이 아니다.
_QUOTE_PATTERNS: tuple[re.Pattern[str], ...] = tuple(
    re.compile(p) for p in (
        r"캠페인",
        r"예방(?:교육|센터|주간|포스터|광고|캠페인)?",
        r"포스터",
        r"뉴스",
        r"기사",
        r"보도",
        r"다큐",
        r"드라마",
        r"영화",
        r"웹툰",
        r"유튜브",
        r"방송",
        r"장면",
        r"소설",
        r"공익광고",
        r"통계",
        r"강의",
    )
)

# 제3자 서술 — 주체가 내담자가 아니다. 1인칭 표현은 넣지 않는다.
_THIRD_PARTY_PATTERNS: tuple[re.Pattern[str], ...] = tuple(
    re.compile(p) for p in (
        r"(?:친구|동생|언니|오빠|형|누나|엄마|아빠|부모님|지인|동료|선배|후배|사촌|이웃)(?:가|는|이|도|의)",
        r"아는사람",
        r"남편이",  # 오기 변형 흡수
        r"주변사람",
        r"누군가가",
        r"환자가",
    )
)

# 부정문 — 그런 생각이 없다는 진술은 신호로 보지 않는다.
_NEGATION_PATTERNS: tuple[re.Pattern[str], ...] = tuple(
    re.compile(p) for p in (
        r"싶지(?:는)?않",
        r"생각은?(?:전혀)?없",
        r"그런생각(?:은|는)?(?:전혀)?(?:안|없)",
        r"하지않(?:아요|았어요|을거)",
        r"아니(?:에요|예요|야|라)",
    )
)

# 1인칭 단서 — 제3자 veto 를 뒤집는다("친구가 그랬는데 저도 죽고 싶어요").
_FIRST_PERSON_PATTERNS: tuple[re.Pattern[str], ...] = tuple(
    re.compile(p) for p in (r"저도", r"나도", r"제가", r"내가", r"저는", r"나는")
)


def _normalize(text: str) -> str:
    """공백·구두점 변형을 지운 매칭용 문자열 — "죽 고 싶" → "죽고싶"."""
    return _SPACE_RE.sub("", text or "")


def _matches(patterns: tuple[re.Pattern[str], ...], normalized: str) -> bool:
    return any(p.search(normalized) for p in patterns)


def _vetoed(normalized: str) -> bool:
    """오탐 완화 — 관용·인용·제3자·부정 맥락이면 신호를 만들지 않는다."""
    if _matches(_NEGATION_PATTERNS, normalized):
        return True
    if _matches(_QUOTE_PATTERNS, normalized):
        return True
    if _matches(_IDIOM_PATTERNS, normalized) and not _matches(_HIGH_PATTERNS, normalized):
        return True
    if _matches(_THIRD_PARTY_PATTERNS, normalized) and not _matches(
        _FIRST_PERSON_PATTERNS, normalized
    ):
        return True
    return False


def detect(text: str) -> tuple[str, str] | None:
    """(레벨, excerpt) 또는 None. 규칙만 쓰며 LLM·사용자 지시의 영향을 받지 않는다.

    문장 단위로 보므로 "뉴스에서 봤어요. 그런데 저도 죽고 싶어요." 처럼 인용 문장과
    본인 서술이 섞여 있어도 본인 서술만 걸린다.
    """
    if not text or not text.strip():
        return None

    sentences = [s.strip() for s in _SENTENCE_SPLIT.split(text) if s and s.strip()]
    best: tuple[str, str] | None = None
    for sentence in sentences:
        normalized = _normalize(sentence)
        if _vetoed(normalized):
            continue
        level: str | None = None
        if _matches(_HIGH_PATTERNS, normalized):
            level = LEVEL_HIGH
        elif _matches(_WATCH_PATTERNS, normalized):
            level = LEVEL_WATCH
        if level is None:
            continue
        candidate = (level, sentence[:EXCERPT_MAX_LENGTH])
        if best is None or _LEVEL_ORDER[level] > _LEVEL_ORDER[best[0]]:
            best = candidate
    return best


# ---------------------------------------------------------------------------
# 내담자 응답 — LLM 비사용 고정 템플릿
# ---------------------------------------------------------------------------
#
# 금지: 감지·위험·모니터링·알림이 갔·알렸 등 감지를 암시하는 어떤 표현도 쓰지 않는다(TS8).
# 각 레벨에 변형을 둬 같은 문장이 반복되는 느낌을 줄인다.

SAFE_REPLIES_HIGH: tuple[str, ...] = (
    "많이 힘든 마음을 꺼내 주셔서 고맙습니다. 혼자 담아 두기에 무거운 이야기예요. "
    "상담사님과 이야기 나눠 보시면 좋겠어요.",
    "그 마음을 적어 주시기까지 많이 애쓰셨을 것 같아요. 제가 임의로 판단하지 않고 그대로 들을게요. "
    "상담사님과 이야기 나눠 보시면 좋겠어요.",
    "지금 마음이 많이 무거우신 것 같아요. 들려주셔서 고맙습니다. "
    "상담사님과 이야기 나눠 보시면 좋겠어요.",
)

SAFE_REPLIES_WATCH: tuple[str, ...] = (
    "그런 마음이 드실 만큼 지치셨던 것 같아요. 들려주셔서 고맙습니다. "
    "상담사님과 이야기 나눠 보시면 좋겠어요.",
    "말씀해 주신 마음을 가볍게 넘기지 않고 듣고 있어요. "
    "상담사님과 이야기 나눠 보시면 좋겠어요.",
)

# 연속 감지 시 안전 템플릿을 반복하지 않고 쓰는 일반 공감 문장(Edge Case).
PLAIN_EMPATHY_REPLY = (
    "계속 이야기해 주셔서 고맙습니다. 지금 떠오르는 마음을 조금 더 들려주실 수 있을까요?"
)


def safe_reply_text(level: str, repeat_index: int) -> str:
    """레벨별 고정 응답 — repeat_index 가 2 이상이면 일반 공감으로 바꾼다."""
    if repeat_index >= 2:
        return PLAIN_EMPATHY_REPLY
    variants = SAFE_REPLIES_HIGH if level == LEVEL_HIGH else SAFE_REPLIES_WATCH
    return variants[repeat_index % len(variants)]


def all_safe_reply_texts() -> tuple[str, ...]:
    """반복 횟수 집계용 — 지금까지 보낸 안전 템플릿 전체."""
    return (*SAFE_REPLIES_HIGH, *SAFE_REPLIES_WATCH)


# ---------------------------------------------------------------------------
# 신호 생성 · 상담사 알림
# ---------------------------------------------------------------------------


def _now() -> datetime:
    return datetime.now(timezone.utc)


def active_counselor_ids(db: DBSession, client_id: UUID) -> list[UUID]:
    """활성 담당 상담사 id — 최근 매칭 순. 위험 알림은 **전원**에게 간다(Edge Case)."""
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
    seen: list[UUID] = []
    for row in rows:
        if row[0] not in seen:
            seen.append(row[0])
    return seen


def _suppressed(db: DBSession, client_id: UUID, counselor_id: UUID, level: str) -> bool:
    """같은 (내담자, 상담사, 레벨) 이 30분 안에 이미 있으면 새 신호를 만들지 않는다.

    레벨 상승(watch→high)은 억제 대상이 아니다 — 같은 레벨만 본다.
    """
    cutoff = _now() - timedelta(minutes=SUPPRESS_WINDOW_MIN)
    return (
        db.query(AgentRiskSignal.id)
        .filter(
            AgentRiskSignal.client_id == client_id,
            AgentRiskSignal.counselor_id == counselor_id,
            AgentRiskSignal.level == level,
            AgentRiskSignal.created_at >= cutoff,
        )
        .first()
        is not None
    )


def _safe_reply_repeat_index(db: DBSession, client_id: UUID) -> int:
    """최근 창 안에서 이미 보낸 안전 템플릿 수 — 반복 남발 방지용."""
    from app.services import agent_service

    conversation = agent_service.get_or_create_conversation(
        db, client_id, agent_service.CHANNEL_CLIENT
    )
    cutoff = _now() - timedelta(minutes=SAFE_REPLY_WINDOW_MIN)
    rows = (
        db.query(AgentMessage.content)
        .filter(
            AgentMessage.conversation_id == conversation.id,
            AgentMessage.sender == "agent",
            AgentMessage.created_at >= cutoff,
        )
        .all()
    )
    known = set(all_safe_reply_texts())
    return sum(1 for row in rows if row[0] in known)


def _risk_alert_content(client_name: str, level: str, excerpt: str) -> str:
    """상담사 채널 본문 — 내담자 실명 + 감지된 문장 excerpt 만(원문 전체 아님)."""
    level_label = "즉시 확인이 필요한 표현" if level == LEVEL_HIGH else "주의해서 볼 표현"
    return (
        f"{client_name} 님의 AI 대화에서 {level_label}이 확인되었어요.\n"
        f"확인된 문장: “{excerpt}”\n"
        "내담자에게는 이 사실을 알리지 않았고, 상담사님과 이야기해 보도록 안내만 했어요."
    )


def _risk_alert_ctas(client_id: UUID) -> list[dict]:
    """위험 알림 CTA — 모두 화면 이동용(서버 상태 변경 없음)."""
    return [
        {
            "id": "open_client",
            "action": "open_client",
            "label": "내담자 상세",
            "payload": {"client_id": str(client_id), "url": f"/clients/{client_id}"},
        },
        {
            "id": "open_risk_signals",
            "action": "open_risk_signals",
            "label": "확인이 필요한 알림 목록",
            "payload": {"url": "/agent?tab=risk"},
        },
    ]


def notify_counselor(
    db: DBSession,
    *,
    counselor_id: UUID,
    client_id: UUID,
    client_name: str,
    level: str,
    excerpt: str,
) -> None:
    """상담사 채널 메시지 + 인앱 알림 + 비식별 푸시.

    **방해금지 시간을 보지 않는다** — 위험 알림은 즉시 나가야 한다(Edge Case).
    안부 아웃리치만 22:00~08:00 KST 를 지킨다.
    """
    from app.models.notification_outbox import NotificationOutbox
    from app.services import agent_service

    # notify=False — 기본 `agent_message` 알림 대신 전용 `risk_signal` 이벤트를 쓴다.
    # 하나의 위험 알림에 인앱 알림이 두 번 쌓이지 않게 한다(TS7: 각 1건).
    message = agent_service.post_agent_message(
        db,
        counselor_id,
        kind=KIND_RISK_ALERT,
        content=_risk_alert_content(client_name, level, excerpt),
        cta=_risk_alert_ctas(client_id),
        channel=agent_service.CHANNEL_COUNSELOR,
        notify=False,
        commit=False,
    )

    # 인앱 알림 이벤트 — 본문에 이름·문장·레벨을 담지 않는다.
    try:
        notification_service.notify_event(
            RISK_NOTIFICATION_EVENT,
            counselor_id,
            {
                "title": "루시 (AI)",
                "body": "확인이 필요한 알림이 있어요. 루시(AI) 채널에서 확인해 주세요.",
                "extra": notification_service.build_standard_extra(
                    RISK_NOTIFICATION_EVENT,
                    "notice",
                    None,
                    params={"deeplink": agent_service.COUNSELOR_AGENT_DEEPLINK},
                ),
            },
            db,
            commit=False,
        )
    except Exception:  # noqa: BLE001 — 알림 실패가 신호 기록을 되돌리지 않는다
        logger.exception("[agent_risk] 인앱 알림 적재 실패 (counselor=%s)", counselor_id)

    # 푸시 Outbox — 비식별 본문만. 이름·감지 문장·레벨을 담지 않는다(TS15).
    db.add(
        NotificationOutbox(
            user_id=counselor_id,
            channel="push",
            payload={
                "title": agent_service.PUSH_TITLE,
                "body": PUSH_BODY_RISK,
                "deeplink": agent_service.COUNSELOR_AGENT_DEEPLINK,
                "message_id": str(message.id),
            },
            status="pending",
        )
    )
    db.flush()


def _talk_to_counselor_cta(db: DBSession, counselor_id: UUID | None, client_id: UUID) -> list[dict]:
    """[상담사님과 대화하기] — 담당 상담사와의 실제 direct 채팅방으로 보낸다.

    방이 없으면 기존 chat 헬퍼로 만든다(Acceptance: room_id 가 실제 방이어야 한다).
    담당 상담사를 찾을 수 없으면 CTA 를 붙이지 않는다 — 열 수 없는 버튼을 보여주지 않는다.
    """
    if counselor_id is None:
        return []
    try:
        from app.services.chat_service import get_or_create_direct_room

        room = get_or_create_direct_room(counselor_id, client_id, db)
    except Exception:  # noqa: BLE001 — 방 생성 실패가 안전 응답 자체를 막지 않는다
        logger.exception("[agent_risk] direct 채팅방 확보 실패 (client=%s)", client_id)
        return []
    return [
        {
            "id": CTA_TALK_TO_COUNSELOR,
            "action": CTA_TALK_TO_COUNSELOR,
            "label": CTA_LABEL_TALK_TO_COUNSELOR,
            "payload": {"room_id": str(room.id), "url": f"/app/chat/{room.id}"},
        }
    ]


def handle_client_message(
    db: DBSession, client_id: UUID, message: AgentMessage | None, text: str
) -> dict | None:
    """내담자 자유 메시지의 위험 탐지 → 상담사 알림 + 내담자용 고정 응답 재료.

    반환 None = 탐지 없음(호출부가 기존 라우팅을 이어간다).
    반환 dict = {"content": 고정 응답, "cta": [...]} — 레벨·excerpt 는 돌려주지 않는다.
    커밋은 호출부가 한다.
    """
    detected = detect(text)
    if detected is None:
        return None
    level, excerpt = detected

    counselor_ids = active_counselor_ids(db, client_id)
    client = db.get(User, client_id)
    client_name = (client.name if client else None) or "이름 미등록"

    for counselor_id in counselor_ids:
        if _suppressed(db, client_id, counselor_id, level):
            continue
        db.add(
            AgentRiskSignal(
                client_id=client_id,
                counselor_id=counselor_id,
                message_id=message.id if message is not None else None,
                level=level,
                excerpt=excerpt,
                status="open",
            )
        )
        db.flush()
        notify_counselor(
            db,
            counselor_id=counselor_id,
            client_id=client_id,
            client_name=client_name,
            level=level,
            excerpt=excerpt,
        )

    repeat_index = _safe_reply_repeat_index(db, client_id)
    content = safe_reply_text(level, repeat_index)
    cta = (
        _talk_to_counselor_cta(db, counselor_ids[0] if counselor_ids else None, client_id)
        if repeat_index < 2
        else []
    )
    # 로그에 대화 원문·excerpt·레벨을 남기지 않는다(보안 리뷰 항목).
    logger.info("[agent_risk] 안전 응답 생성 (client=%s, counselors=%d)", client_id, len(counselor_ids))
    return {"content": content, "cta": cta}


# ---------------------------------------------------------------------------
# 상담사 조회 · 처리
# ---------------------------------------------------------------------------


def serialize_signal(signal: AgentRiskSignal, client_name: str) -> dict:
    """Contract(RiskSignal) 형태로 직렬화."""
    return {
        "id": str(signal.id),
        "client_id": str(signal.client_id),
        "client_name": client_name,
        "level": signal.level,
        "excerpt": signal.excerpt,
        "created_at": signal.created_at,
        "handled_at": signal.handled_at,
    }


def list_signals(
    db: DBSession, counselor_id: UUID, *, status: str = "open", limit: int = 50
) -> list[dict]:
    """본인(담당 상담사) 신호만. 타 상담사 신호는 쿼리에 들어올 수 없다(TS12)."""
    query = db.query(AgentRiskSignal, User.name).join(
        User, User.id == AgentRiskSignal.client_id
    ).filter(AgentRiskSignal.counselor_id == counselor_id)
    if status != "all":
        query = query.filter(AgentRiskSignal.handled_at.is_(None))
    rows = (
        query.order_by(
            AgentRiskSignal.handled_at.is_(None).desc(), AgentRiskSignal.created_at.desc()
        )
        .limit(max(1, min(int(limit), 200)))
        .all()
    )
    return [serialize_signal(signal, name or "이름 미등록") for signal, name in rows]


def open_signals_for_briefing(db: DBSession, counselor_id: UUID, *, limit: int = 20) -> list[dict]:
    """브리핑용 미처리 신호 — 본문 excerpt 는 상담사 채널에만 들어간다(TS14)."""
    return list_signals(db, counselor_id, status="open", limit=limit)


def open_signal_count(db: DBSession, counselor_id: UUID, client_id: UUID) -> int:
    return (
        db.query(AgentRiskSignal.id)
        .filter(
            AgentRiskSignal.counselor_id == counselor_id,
            AgentRiskSignal.client_id == client_id,
            AgentRiskSignal.handled_at.is_(None),
        )
        .count()
    )
