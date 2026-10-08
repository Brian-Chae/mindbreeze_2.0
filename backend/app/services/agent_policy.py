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
from datetime import datetime, timedelta, timezone
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

    return "\n".join(lines)
