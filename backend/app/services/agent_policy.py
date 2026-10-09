"""SDD-188: AI 에이전트 정책 계층 — 내담자 채널이 볼 수 있는 데이터의 단일 진입점.

채널 간 정보 유출을 프롬프트 지시로 막지 않고 **조회 범위 자체를 코드로 제한**한다
(기획 §3.1). 내담자 채널의 컨텍스트는 이 모듈만이 만들 수 있고, 다른 코드는
`client_context()` 가 돌려준 값만 LLM 프롬프트에 넣는다.

볼 수 있는 것
- 본인(user_id)이 active 참여자인 예정 세션의 일정·장소·상담사 이름
- 본인 소유(`Report.user_id == user_id`) + `type="client"` + `status="completed"` 리포트 본문

볼 수 없는 것 (쿼리 자체에 들어오지 않는다)
- 상담사 리포트(`type="counselor"`), 승인 전 리포트(`pending_review` 등)
- 상담사 비공개 메모(`ClientCounselorLink.memo`)
- 다른 참여자·다른 내담자의 리포트, EEG 수치/점수
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session as DBSession

from app.models.counselor_profile import CounselorProfile
from app.models.record import Report
from app.models.session import Session, SessionParticipant
from app.models.user import User

logger = logging.getLogger(__name__)

KST = ZoneInfo("Asia/Seoul")

# 컨텍스트에 담는 최대 건수 — 프롬프트 폭주 방지.
MAX_CONTEXT_SESSIONS = 5
MAX_CONTEXT_REPORTS = 3
# 리포트 본문에서 인용할 문장 수 상한(기획 §3.3: 핵심 서술 1~2개).
MAX_QUOTE_SENTENCES = 2
# 루시가 참조하는 최근 대화 기억(체크인 요약) 상한 — Brian 결정 D1.
MAX_CONTEXT_MEMORIES = 100

SESSION_TYPE_LABELS: dict[str, str] = {
    "clinical": "임상심리상담",
    "hypnosis": "최면심리상담",
    "meditation": "명상수업",
}


def _ensure_aware(dt: datetime) -> datetime:
    """naive 입력을 UTC 로 간주한다 — reminder_service._ensure_aware 와 동일 규약."""
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def session_type_label(session: Session) -> str:
    if session.type == "custom":
        return session.custom_type_name or "클래스"
    return SESSION_TYPE_LABELS.get(session.type, "클래스")


def format_schedule(scheduled_at: datetime | None) -> str:
    """예약 시각을 한국 시간 기준 사람이 읽는 문장으로 — DB 값 그대로 쓴다(환각 방지)."""
    if scheduled_at is None:
        return "일정 미정"
    dt = _ensure_aware(scheduled_at).astimezone(KST)
    weekday = "월화수목금토일"[dt.weekday()]
    return f"{dt.year}년 {dt.month}월 {dt.day}일({weekday}) {dt.hour:02d}:{dt.minute:02d}"


def counselor_address(host: User | None, db: DBSession) -> str | None:
    """상담사 프로필 주소(1·2행 결합). 없으면 None."""
    if host is None:
        return None
    profile = (
        db.query(CounselorProfile).filter(CounselorProfile.user_id == host.id).first()
    )
    if profile is None:
        return None
    parts = [p.strip() for p in (profile.address_line1, profile.address_line2) if p and p.strip()]
    if not parts:
        return None
    return " ".join(parts)[:300]


# ---------------------------------------------------------------------------
# 세션 — 본인 예약만
# ---------------------------------------------------------------------------


def upcoming_sessions(
    user_id: str | UUID, db: DBSession, *, limit: int = MAX_CONTEXT_SESSIONS
) -> list[dict]:
    """본인이 active 참여자인 예정 세션 목록(가까운 순).

    대기열(is_waitlisted)·취소/종료 세션·템플릿·일정 없는 즉석 클래스는 제외한다.
    """
    uid = user_id if isinstance(user_id, UUID) else UUID(str(user_id))
    now = _now()
    rows = (
        db.query(Session)
        .join(SessionParticipant, SessionParticipant.session_id == Session.id)
        .filter(
            SessionParticipant.user_id == uid,
            SessionParticipant.is_waitlisted.is_(False),
            Session.is_template.is_(False),
            Session.scheduled_at.is_not(None),
            Session.scheduled_at >= now - timedelta(hours=1),
            Session.status.in_(["scheduled", "ready", "open"]),
        )
        .order_by(Session.scheduled_at.asc())
        .limit(limit)
        .all()
    )
    # 같은 내담자가 같은 세션에 중복 참여 행을 가져도 세션은 1건으로 모은다.
    seen: set[UUID] = set()
    result: list[dict] = []
    for session in rows:
        if session.id in seen:
            continue
        seen.add(session.id)
        result.append(session_facts(session, db))
    return result


def session_facts(session: Session, db: DBSession) -> dict:
    """세션의 사실 정보만 추출 — 모두 DB 값이며 LLM 을 거치지 않는다."""
    host = db.get(User, session.host_id)
    return {
        "session_id": str(session.id),
        "title": session.title,
        "type_label": session_type_label(session),
        "status": session.status,
        "scheduled_at": _ensure_aware(session.scheduled_at) if session.scheduled_at else None,
        "scheduled_text": format_schedule(session.scheduled_at),
        "duration_min": session.duration_min,
        "location_type": session.location_type,
        # 오프라인 세션만 장소가 의미를 가진다. 온라인은 항상 None.
        "location_address": (
            session.location_address if session.location_type == "offline" else None
        ),
        "counselor_id": str(session.host_id),
        "counselor_name": (host.name if host else None) or "상담사",
        # D11: 전화 CTA 는 번호가 있을 때만 붙인다.
        "counselor_phone": (host.phone if host and host.phone else None),
        "linkband_mode": session.linkband_mode,
    }


# ---------------------------------------------------------------------------
# 리포트 — 본인 소유 + client + completed 만
# ---------------------------------------------------------------------------


def approved_client_reports(
    user_id: str | UUID, db: DBSession, *, limit: int = MAX_CONTEXT_REPORTS
) -> list[dict]:
    """본인에게 승인·발송 완료된 client 리포트 본문 목록(최신순).

    세 조건(본인 소유 / type=client / status=completed)을 모두 쿼리에 걸어
    상담사 리포트·승인 전 리포트·타인 리포트가 결과에 들어올 수 없게 한다.
    """
    uid = user_id if isinstance(user_id, UUID) else UUID(str(user_id))
    rows = (
        db.query(Report)
        .filter(
            Report.user_id == uid,
            Report.type == "client",
            Report.status == "completed",
        )
        .order_by(Report.created_at.desc())
        .limit(limit)
        .all()
    )
    return [report_facts(report, db) for report in rows]


def report_facts(report: Report, db: DBSession) -> dict:
    """리포트 본문에서 대화에 쓸 서술만 추출한다.

    EEG 수치·7지표·신뢰도 등 숫자 블록은 의도적으로 제외한다(점수 환원 금지).
    """
    content = report.content if isinstance(report.content, dict) else {}
    session = db.get(Session, report.session_id)
    host = db.get(User, session.host_id) if session else None

    headline = _clean_text(content.get("headline"))
    summary = _clean_text(content.get("summary"))
    comment = _clean_text(content.get("counselor_comment"))
    insights = [
        text
        for text in (_clean_text(_insight_text(item)) for item in (content.get("insights") or []))
        if text
    ][:3]

    return {
        "report_id": str(report.id),
        "session_id": str(report.session_id),
        "session_title": session.title if session else None,
        "type_label": session_type_label(session) if session else "클래스",
        "scheduled_text": format_schedule(session.scheduled_at) if session else "일정 미정",
        "counselor_name": (host.name if host else None) or "상담사",
        "headline": headline,
        "summary": summary,
        "counselor_comment": comment,
        "insights": insights,
    }


def _insight_text(item: object) -> str | None:
    """insights 항목은 문자열 또는 {title, body} 형태 모두 올 수 있다."""
    if isinstance(item, str):
        return item
    if isinstance(item, dict):
        for key in ("text", "body", "description", "title"):
            value = item.get(key)
            if isinstance(value, str) and value.strip():
                return value
    return None


def _clean_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    text = value.strip()
    return text or None


def report_quotes(facts: dict, *, limit: int = MAX_QUOTE_SENTENCES) -> list[str]:
    """리포트 핵심 서술 1~2문장 — 인용할 본문이 없으면 빈 목록(빈 본문은 인용하지 않는다)."""
    candidates: list[str] = []
    for value in (facts.get("headline"), facts.get("summary"), facts.get("counselor_comment")):
        if value:
            candidates.append(value)
    candidates.extend(facts.get("insights") or [])

    quotes: list[str] = []
    for text in candidates:
        sentence = text.strip().split("\n")[0].strip()
        if not sentence or sentence in quotes:
            continue
        quotes.append(sentence[:200])
        if len(quotes) >= limit:
            break
    return quotes


# ---------------------------------------------------------------------------
# 단일 진입점
# ---------------------------------------------------------------------------


def client_memories(
    user_id: str | UUID, db: DBSession, *, limit: int = MAX_CONTEXT_MEMORIES
) -> list[dict]:
    """최근 체크인 요약 — 루시가 "지난 대화 기억"으로 참조한다(SDD-194).

    요약은 체크인 마무리 시 `agent_guard` 를 거쳐 저장된 것만 담기므로 진단·점수
    표현이 없다. 프롬프트에 자연스럽게 실리도록 시간순(오래된→최신)으로 돌려준다.
    """
    from app.models.agent import AgentCheckin

    uid = user_id if isinstance(user_id, UUID) else UUID(str(user_id))
    rows = (
        db.query(AgentCheckin.summary, AgentCheckin.closed_at)
        .filter(
            AgentCheckin.client_id == uid,
            AgentCheckin.closed_at.is_not(None),
            AgentCheckin.summary.is_not(None),
        )
        .order_by(AgentCheckin.closed_at.desc())
        .limit(limit)
        .all()
    )
    memories: list[dict] = []
    for summary, closed_at in reversed(rows):
        text = (summary or "").strip()
        if not text:
            continue
        memories.append({
            "summary": text,
            "closed_at": _ensure_aware(closed_at) if closed_at else None,
        })
    return memories


def client_context(user_id: str | UUID, db: DBSession) -> dict:
    """내담자 채널 컨텍스트 — 에이전트가 참조할 수 있는 전부.

    이 함수의 반환값(과 거기서 파생한 문자열)만 LLM 프롬프트에 들어간다.
    """
    uid = user_id if isinstance(user_id, UUID) else UUID(str(user_id))
    user = db.get(User, uid)
    return {
        "user": {
            "id": str(uid),
            "name": (user.name if user else None) or "회원",
        },
        "sessions": upcoming_sessions(uid, db),
        "reports": approved_client_reports(uid, db),
        "memories": client_memories(uid, db),
    }


def context_to_text(context: dict) -> str:
    """컨텍스트를 LLM 프롬프트용 텍스트로 직렬화 — 허용 자료 블록에만 쓴다."""
    lines: list[str] = []

    sessions = context.get("sessions") or []
    if sessions:
        lines.append("■ 예약된 상담 일정")
        for item in sessions:
            place = (
                f"장소 {item['location_address']}"
                if item.get("location_address")
                else ("온라인 진행" if item.get("location_type") == "online" else "장소 정보 없음")
            )
            lines.append(
                f"- {item['scheduled_text']} / {item['type_label']} / "
                f"{item['counselor_name']} 선생님 / {place}"
            )
    else:
        lines.append("■ 예약된 상담 일정: 없음")

    reports = context.get("reports") or []
    if reports:
        lines.append("")
        lines.append("■ 내담자에게 발송 완료된 리포트 본문 (이 범위 안에서만 이야기할 수 있음)")
        for item in reports:
            lines.append(f"- {item['scheduled_text']} {item['type_label']} 리포트")
            for key, label in (
                ("headline", "핵심"),
                ("summary", "요약"),
                ("counselor_comment", "상담사 코멘트"),
            ):
                if item.get(key):
                    lines.append(f"  · {label}: {item[key]}")
            for insight in item.get("insights") or []:
                lines.append(f"  · 관찰: {insight}")
    else:
        lines.append("")
        lines.append("■ 발송 완료된 리포트: 없음")

    memories = context.get("memories") or []
    if memories:
        lines.append("")
        lines.append("■ 지난 대화 기억 (내담자와 나눈 최근 대화 요약)")
        for item in memories:
            lines.append(f"- {item['summary']}")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# SDD-189: 상담사 채널 컨텍스트 — host/담당 링크 기준 단일 진입점
# ---------------------------------------------------------------------------
#
# 격리 규칙: 세션은 `Session.host_id == 상담사` 로만, 내담자는 그 세션의 active 참여자
# 또는 `ClientCounselorLink(status="active")` 로만 들어온다. 따라서 다른 상담사의
# 세션·내담자·요약은 쿼리 자체에 들어올 수 없다(기획 §3.1, SDD-189 Risks).
#
# 내담자 채널과 반대로 **실명**을 쓴다(D12) — 상담사는 담당 내담자를 식별해야 한다.
# 반대로 **장소·주소·연락처·길찾기는 담지 않는다**(기획 §1.2-6): 상담사는 자기 상담실
# 주소를 안내받을 필요가 없고, 내담자 연락처를 알림 본문으로 흘리지 않는다.

# 브리핑 1건에 담는 상한 — 프롬프트·메시지 폭주 방지.
MAX_BRIEFING_SESSIONS = 20
MAX_BRIEFING_RELAY_EVENTS = 20
MAX_BRIEFING_KEYWORDS = 5

# 브리핑 대상에서 제외하지 않고 "취소" 로 표시하는 상태.
CANCELLED_STATUSES: tuple[str, ...] = ("cancelled",)
# 저녁 정리에서 "진행된 상담" 으로 보는 상태.
CONDUCTED_STATUSES: tuple[str, ...] = ("in_progress", "completed")

# 리포트 상태 → 상담사가 읽는 한국어 라벨. 승인 대기(pending_review)가 핵심 신호다.
REPORT_STATUS_LABELS: dict[str, str] = {
    "pending_analysis": "분석 중",
    "pending_review": "승인 대기",
    "completed": "발송 완료",
    "error": "생성 오류",
}

LOCATION_LABELS: dict[str, str] = {"online": "온라인", "offline": "오프라인"}


def kst_today(now: datetime | None = None) -> date:
    """KST 기준 오늘 날짜 — 브리핑의 날짜 경계는 항상 한국 시간으로 끊는다."""
    return (now or _now()).astimezone(KST).date()


def kst_day_bounds(day: date) -> tuple[datetime, datetime]:
    """KST 날짜의 [00:00, 24:00) 을 UTC aware 범위로 변환한다."""
    start = datetime(day.year, day.month, day.day, tzinfo=KST)
    return start.astimezone(timezone.utc), (start + timedelta(days=1)).astimezone(timezone.utc)


def time_text(scheduled_at: datetime | None) -> str:
    """KST 시각만 — 브리핑은 날짜별로 묶이므로 "14:00" 형태로 짧게 쓴다."""
    if scheduled_at is None:
        return "시간 미정"
    dt = _ensure_aware(scheduled_at).astimezone(KST)
    return f"{dt.hour:02d}:{dt.minute:02d}"


def linked_client_ids(counselor_id: str | UUID, db: DBSession) -> set[UUID]:
    """담당(active) 내담자 id 집합 — ClientCounselorLink 기준."""
    from app.models.client_counselor_link import ClientCounselorLink

    cid = counselor_id if isinstance(counselor_id, UUID) else UUID(str(counselor_id))
    rows = (
        db.query(ClientCounselorLink.client_id)
        .filter(
            ClientCounselorLink.counselor_id == cid,
            ClientCounselorLink.status == "active",
        )
        .all()
    )
    return {row[0] for row in rows}


def find_linked_client(counselor_id: str | UUID, name: str, db: DBSession) -> User | None:
    """이름으로 담당 내담자를 찾는다 — 담당 링크 또는 본인 세션 참여자만 후보다.

    타 상담사의 내담자 이름을 넣어도 None 이 돌아간다(TS6·TS9).
    """
    cid = counselor_id if isinstance(counselor_id, UUID) else UUID(str(counselor_id))
    needle = (name or "").strip()
    if not needle:
        return None

    candidate_ids = set(linked_client_ids(cid, db))
    # 링크가 아직 없더라도 본인이 host 인 세션의 참여자는 담당 내담자로 본다.
    rows = (
        db.query(SessionParticipant.user_id)
        .join(Session, Session.id == SessionParticipant.session_id)
        .filter(
            Session.host_id == cid,
            Session.is_template.is_(False),
            SessionParticipant.user_id.is_not(None),
            SessionParticipant.is_waitlisted.is_(False),
        )
        .all()
    )
    candidate_ids.update(row[0] for row in rows if row[0] is not None)
    if not candidate_ids:
        return None

    return (
        db.query(User)
        .filter(User.id.in_(candidate_ids), User.name == needle)
        .order_by(User.created_at.asc())
        .first()
    )


def session_ordinal(
    counselor_id: UUID, client_id: UUID, session: Session, db: DBSession
) -> int:
    """회차 — 이 상담사와 이 내담자가 함께한 세션 중 해당 세션의 순번(1-based).

    취소된 세션은 회차로 세지 않는다. 일정이 없는 세션은 비교 대상에서 빠지므로 1 이 된다.
    """
    if session.scheduled_at is None:
        return 1
    count = (
        db.query(Session.id)
        .join(SessionParticipant, SessionParticipant.session_id == Session.id)
        .filter(
            Session.host_id == counselor_id,
            Session.is_template.is_(False),
            Session.scheduled_at.is_not(None),
            Session.scheduled_at <= _ensure_aware(session.scheduled_at),
            Session.status.not_in(list(CANCELLED_STATUSES)),
            SessionParticipant.user_id == client_id,
            SessionParticipant.is_waitlisted.is_(False),
        )
        .distinct()
        .count()
    )
    return max(1, count)


def record_facts(session_id: UUID, db: DBSession) -> dict:
    """세션 기록의 AI 요약에서 상담사 브리핑에 쓸 서술만 추출한다.

    기록이 없거나(마이크 오프·미진행) 요약이 비어 있으면 has_summary=False 로 돌려주고,
    브리핑 템플릿이 "기록 없음" 으로 표기한다(환각으로 채우지 않는다).
    """
    from app.models.record import SessionRecord

    record = (
        db.query(SessionRecord).filter(SessionRecord.session_id == session_id).first()
    )
    if record is None:
        return {"status": None, "has_summary": False, "headline": None, "sections": {}, "keywords": []}

    summary = record.ai_summary if isinstance(record.ai_summary, dict) else {}
    sections = summary.get("sections")
    sections = sections if isinstance(sections, dict) else {}
    keywords = [
        kw.strip()
        for kw in (summary.get("keywords") or [])
        if isinstance(kw, str) and kw.strip()
    ][:MAX_BRIEFING_KEYWORDS]
    headline = _clean_text(summary.get("headline"))

    return {
        "status": record.status,
        "has_summary": bool(headline or sections or keywords),
        "headline": headline,
        # 섹션 본문은 상담사 본인이 만든 기록이므로 그대로 전달한다.
        "sections": {
            str(key): value.strip()
            for key, value in sections.items()
            if isinstance(value, str) and value.strip()
        },
        "keywords": keywords,
        "counselor_notes": _clean_text(record.counselor_notes),
    }


def previous_record_facts(
    counselor_id: UUID, client_id: UUID, session: Session, db: DBSession
) -> dict | None:
    """직전 세션의 AI 요약 — 같은 상담사·같은 내담자의 가장 최근 지난 세션 기준.

    아침 브리핑의 "지난 회차에서 다룬 이야기" 한 줄에 쓴다. 요약이 없으면 None.
    """
    if session.scheduled_at is None:
        return None
    previous = (
        db.query(Session)
        .join(SessionParticipant, SessionParticipant.session_id == Session.id)
        .filter(
            Session.host_id == counselor_id,
            Session.id != session.id,
            Session.is_template.is_(False),
            Session.scheduled_at.is_not(None),
            Session.scheduled_at < _ensure_aware(session.scheduled_at),
            Session.status.not_in(list(CANCELLED_STATUSES)),
            SessionParticipant.user_id == client_id,
            SessionParticipant.is_waitlisted.is_(False),
        )
        .order_by(Session.scheduled_at.desc())
        .first()
    )
    if previous is None:
        return None
    facts = record_facts(previous.id, db)
    if not facts["has_summary"]:
        return None
    facts["session_id"] = str(previous.id)
    facts["scheduled_text"] = format_schedule(previous.scheduled_at)
    return facts


def _report_facts_for(session_id: UUID, client_id: UUID | None, db: DBSession) -> dict | None:
    """세션·내담자의 client 리포트 상태 — 본문은 담지 않고 상태만 쓴다."""
    from app.models.record import Report

    query = db.query(Report).filter(Report.session_id == session_id, Report.type == "client")
    if client_id is not None:
        query = query.filter(Report.user_id == client_id)
    report = query.order_by(Report.created_at.desc()).first()
    if report is None:
        return None
    return {
        "report_id": str(report.id),
        "status": report.status,
        "status_label": REPORT_STATUS_LABELS.get(report.status, report.status),
    }


def _acked_client_ids(session_id: UUID, db: DBSession) -> set[UUID]:
    """예약 안내를 "확인했어요" 로 누른 내담자 id — SDD-188 ack 중계 이벤트 기준."""
    from app.models.agent import AgentRelayEvent

    rows = (
        db.query(AgentRelayEvent.source_user_id)
        .filter(AgentRelayEvent.kind == "ack", AgentRelayEvent.session_id == session_id)
        .all()
    )
    return {row[0] for row in rows}


def _session_clients(session: Session, db: DBSession) -> list[User]:
    """세션의 active 참여 내담자(대기열 제외, 중복 제거) — 실명 표시 대상."""
    rows = (
        db.query(User)
        .join(SessionParticipant, SessionParticipant.user_id == User.id)
        .filter(
            SessionParticipant.session_id == session.id,
            SessionParticipant.user_id.is_not(None),
            SessionParticipant.is_waitlisted.is_(False),
        )
        .all()
    )
    seen: set[UUID] = set()
    clients: list[User] = []
    for user in rows:
        if user.id in seen:
            continue
        seen.add(user.id)
        clients.append(user)
    return clients


def _participant_joined(session_id: UUID, client_id: UUID, db: DBSession) -> bool:
    """참석 여부 — 참여 행의 joined_at 유무로 판단한다(별도 no-show 필드가 없다)."""
    row = (
        db.query(SessionParticipant.joined_at)
        .filter(
            SessionParticipant.session_id == session_id,
            SessionParticipant.user_id == client_id,
        )
        .first()
    )
    return bool(row and row[0] is not None)


def counselor_session_brief(
    session: Session, counselor_id: UUID, db: DBSession, *, with_summary: bool = False
) -> dict:
    """브리핑 1행에 필요한 세션 사실 — **장소·주소·연락처를 담지 않는다**.

    with_summary=True(저녁 정리)일 때만 이 세션의 기록 요약을 함께 싣는다.
    """
    acked = _acked_client_ids(session.id, db)
    clients: list[dict] = []
    for user in _session_clients(session, db):
        clients.append({
            "client_id": str(user.id),
            # D12: 상담사 채널은 실명을 쓴다.
            "name": user.name or "이름 미등록",
            "ordinal": session_ordinal(counselor_id, user.id, session, db),
            "acked": user.id in acked,
            "attended": _participant_joined(session.id, user.id, db),
            "report": _report_facts_for(session.id, user.id, db),
            "previous_summary": previous_record_facts(counselor_id, user.id, session, db),
        })

    return {
        "session_id": str(session.id),
        "title": session.title,
        "type_label": session_type_label(session),
        "status": session.status,
        "is_cancelled": session.status in CANCELLED_STATUSES,
        "scheduled_at": _ensure_aware(session.scheduled_at) if session.scheduled_at else None,
        "time_text": time_text(session.scheduled_at),
        "scheduled_text": format_schedule(session.scheduled_at),
        "duration_min": session.duration_min,
        # 온라인/오프라인 구분만. 주소는 상담사 브리핑에 넣지 않는다.
        "location_label": LOCATION_LABELS.get(session.location_type, "오프라인"),
        "linkband_mode": session.linkband_mode,
        "clients": clients,
        "record": record_facts(session.id, db) if with_summary else None,
    }


def counselor_day_sessions(
    counselor_id: UUID, day: date, db: DBSession, *, with_summary: bool = False
) -> list[dict]:
    """해당 KST 날짜에 잡힌 본인(host) 세션 목록(시각 순). 템플릿은 제외한다."""
    start, end = kst_day_bounds(day)
    rows = (
        db.query(Session)
        .filter(
            Session.host_id == counselor_id,
            Session.is_template.is_(False),
            Session.scheduled_at.is_not(None),
            Session.scheduled_at >= start,
            Session.scheduled_at < end,
        )
        .order_by(Session.scheduled_at.asc())
        .limit(MAX_BRIEFING_SESSIONS)
        .all()
    )
    return [
        counselor_session_brief(session, counselor_id, db, with_summary=with_summary)
        for session in rows
    ]


def counselor_pending_reports(counselor_id: UUID, db: DBSession) -> list[dict]:
    """승인 대기(pending_review) 리포트 — 본인이 host 인 세션 것만."""
    from app.models.record import Report

    rows = (
        db.query(Report, Session)
        .join(Session, Session.id == Report.session_id)
        .filter(
            Session.host_id == counselor_id,
            Report.status == "pending_review",
        )
        .order_by(Report.created_at.desc())
        .limit(MAX_BRIEFING_SESSIONS)
        .all()
    )
    items: list[dict] = []
    for report, session in rows:
        client = db.get(User, report.user_id) if report.user_id else None
        items.append({
            "report_id": str(report.id),
            "session_id": str(session.id),
            "client_name": (client.name if client else None) or "이름 미등록",
            "type_label": session_type_label(session),
            "scheduled_text": format_schedule(session.scheduled_at),
            "status": report.status,
            "status_label": REPORT_STATUS_LABELS.get(report.status, report.status),
        })
    return items


def counselor_relay_events(
    counselor_id: UUID, db: DBSession, *, only_open: bool = True, limit: int | None = None
) -> list[dict]:
    """본인에게 온 중계 이벤트(내담자 피드백·일정 변경 문의·확인) 목록 — 최신순.

    `target_user_id == 상담사` 로만 조회하므로 타 상담사 이벤트는 결과에 들어오지 않는다.
    피드백 자유 서술은 **원문 그대로** 전달한다(D10 — 요약·순화 금지).
    """
    from app.models.agent import AgentRelayEvent

    query = db.query(AgentRelayEvent).filter(AgentRelayEvent.target_user_id == counselor_id)
    if only_open:
        query = query.filter(AgentRelayEvent.handled_at.is_(None))
    rows = (
        query.order_by(AgentRelayEvent.created_at.desc())
        .limit(limit or MAX_BRIEFING_RELAY_EVENTS)
        .all()
    )
    return [relay_event_facts(event, db) for event in rows]


def relay_event_facts(event, db: DBSession) -> dict:
    """중계 이벤트 → Contract(RelayEvent) 형태. payload 는 원문 그대로 유지한다."""
    client = db.get(User, event.source_user_id)
    session = db.get(Session, event.session_id) if event.session_id else None
    return {
        "id": str(event.id),
        "kind": event.kind,
        "client_id": str(event.source_user_id),
        "client_name": (client.name if client else None) or "이름 미등록",
        "session_id": str(event.session_id) if event.session_id else None,
        "session_title": (session.title if session else None),
        "scheduled_at": (
            _ensure_aware(session.scheduled_at)
            if session and session.scheduled_at
            else None
        ),
        "payload": dict(event.payload or {}),
        "handled_at": event.handled_at,
        "created_at": event.created_at,
    }


# ---------------------------------------------------------------------------
# 상담사 채널 단일 진입점
# ---------------------------------------------------------------------------


def counselor_context(
    user_id: str | UUID, db: DBSession, day: date | None = None
) -> dict:
    """상담사 채널 컨텍스트 — 브리핑·대화가 참조할 수 있는 전부.

    이 함수의 반환값(과 거기서 파생한 문자열)만 LLM 프롬프트에 들어간다.
    모든 조회가 host_id / target_user_id / 담당 링크로 묶여 있어 타 상담사 데이터는
    구조적으로 들어올 수 없다.
    """
    cid = user_id if isinstance(user_id, UUID) else UUID(str(user_id))
    user = db.get(User, cid)
    base_day = day or kst_today()

    return {
        "user": {"id": str(cid), "name": (user.name if user else None) or "상담사"},
        "day": base_day,
        # 오늘 세션은 저녁 정리가 기록 요약을 쓰므로 요약을 포함해 한 번만 조회한다.
        "today": counselor_day_sessions(cid, base_day, db, with_summary=True),
        "tomorrow": counselor_day_sessions(cid, base_day + timedelta(days=1), db),
        "pending_reports": counselor_pending_reports(cid, db),
        "relay_events": counselor_relay_events(cid, db, only_open=True),
        # SDD-191: 세션 사이 안부 요약 + 미처리 위험 신호.
        "checkin_summaries": counselor_checkin_summaries(cid, db),
        "risk_signals": counselor_open_risk_signals(cid, db),
    }


# ---------------------------------------------------------------------------
# SDD-191: 안부 요약 · 미처리 위험 신호 (상담사 전용)
# ---------------------------------------------------------------------------

# 브리핑 1건에 담는 상한.
MAX_BRIEFING_CHECKINS = 10
MAX_BRIEFING_RISK_SIGNALS = 10

# 변화 방향 라벨 — 숫자 척도를 쓰지 않는다.
MOOD_DIRECTION_LABELS: dict[str, str] = {
    "better": "좋아짐",
    "same": "비슷함",
    "watch": "주의",
}

RISK_LEVEL_LABELS: dict[str, str] = {
    "high": "즉시 확인",
    "watch": "주의 관찰",
}


def counselor_checkin_summaries(
    counselor_id: str | UUID, db: DBSession, *, limit: int = MAX_BRIEFING_CHECKINS
) -> list[dict]:
    """담당 내담자별 "세션 사이 안부 요약" — 최근 마무리된 체크인만, 내담자당 1건.

    counselor_id 로 묶여 있어 타 상담사가 유발한 체크인은 들어올 수 없다.
    """
    from app.models.agent import AgentCheckin

    cid = counselor_id if isinstance(counselor_id, UUID) else UUID(str(counselor_id))
    rows = (
        db.query(AgentCheckin, User.name)
        .join(User, User.id == AgentCheckin.client_id)
        .filter(
            AgentCheckin.counselor_id == cid,
            AgentCheckin.closed_at.is_not(None),
        )
        .order_by(AgentCheckin.closed_at.desc())
        .limit(limit * 3)
        .all()
    )
    items: list[dict] = []
    seen: set[UUID] = set()
    for checkin, name in rows:
        if checkin.client_id in seen:
            continue
        seen.add(checkin.client_id)
        items.append({
            "checkin_id": str(checkin.id),
            "client_id": str(checkin.client_id),
            "client_name": name or "이름 미등록",
            "summary": checkin.summary or "",
            "mood_direction": checkin.mood_direction,
            "mood_label": MOOD_DIRECTION_LABELS.get(checkin.mood_direction or "", "비슷함"),
            "closed_at": _ensure_aware(checkin.closed_at) if checkin.closed_at else None,
        })
        if len(items) >= limit:
            break
    return items


def counselor_open_risk_signals(
    counselor_id: str | UUID, db: DBSession, *, limit: int = MAX_BRIEFING_RISK_SIGNALS
) -> list[dict]:
    """미처리 위험 신호 — 처리 완료(handled_at)된 신호는 빠진다(TS14)."""
    from app.models.agent import AgentRiskSignal

    cid = counselor_id if isinstance(counselor_id, UUID) else UUID(str(counselor_id))
    rows = (
        db.query(AgentRiskSignal, User.name)
        .join(User, User.id == AgentRiskSignal.client_id)
        .filter(
            AgentRiskSignal.counselor_id == cid,
            AgentRiskSignal.handled_at.is_(None),
        )
        .order_by(AgentRiskSignal.created_at.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "signal_id": str(signal.id),
            "client_id": str(signal.client_id),
            "client_name": name or "이름 미등록",
            "level": signal.level,
            "level_label": RISK_LEVEL_LABELS.get(signal.level, signal.level),
            "excerpt": signal.excerpt,
            "created_at": _ensure_aware(signal.created_at) if signal.created_at else None,
        }
        for signal, name in rows
    ]


def counselor_context_to_text(context: dict) -> str:
    """상담사 컨텍스트를 LLM 프롬프트용 텍스트로 직렬화 — 허용 자료 블록에만 쓴다.

    장소·주소·연락처는 컨텍스트 자체에 없으므로 여기에도 나타나지 않는다.
    """
    lines: list[str] = []

    for key, label in (("today", "오늘 일정"), ("tomorrow", "내일 일정")):
        sessions = context.get(key) or []
        if not sessions:
            lines.append(f"■ {label}: 없음")
            continue
        lines.append(f"■ {label}")
        for item in sessions:
            names = ", ".join(
                f"{c['name']}({c['ordinal']}회차)" for c in item.get("clients") or []
            ) or "참여자 미지정"
            suffix = " / 취소됨" if item.get("is_cancelled") else ""
            lines.append(
                f"- {item['time_text']} {item['type_label']} / {names} / "
                f"{item['location_label']}{suffix}"
            )
        lines.append("")

    reports = context.get("pending_reports") or []
    if reports:
        lines.append(f"■ 승인 대기 리포트 {len(reports)}건")
        for item in reports:
            lines.append(f"- {item['client_name']} / {item['scheduled_text']} {item['type_label']}")
        lines.append("")

    # SDD-191: 안부 요약·위험 신호는 **건수만** 넣는다. excerpt·요약 본문을 프롬프트에
    # 넣으면 내담자 입력이 LLM 지시에 섞이고(인젝션), 상담 내용이 공급자로 흘러간다.
    checkins = context.get("checkin_summaries") or []
    if checkins:
        lines.append(f"■ 세션 사이 안부 요약 {len(checkins)}건")
        lines.append("")
    risk_signals = context.get("risk_signals") or []
    if risk_signals:
        lines.append(f"■ 확인이 필요한 알림 {len(risk_signals)}건")
        lines.append("")

    events = context.get("relay_events") or []
    if events:
        lines.append(f"■ 미처리 내담자 전달 사항 {len(events)}건")
        for item in events:
            lines.append(f"- {item['client_name']} / {RELAY_KIND_LABELS.get(item['kind'], item['kind'])}")
        lines.append("")

    return "\n".join(lines).strip()


RELAY_KIND_LABELS: dict[str, str] = {
    "feedback": "상담 후 피드백",
    "schedule_change_request": "일정 변경 문의",
    "ack": "예약 안내 확인",
}
