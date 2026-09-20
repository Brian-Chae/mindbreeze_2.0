"""SDD-087: 상담사 코멘트(내담자 전달 메시지) 저장 + AI(Gemini) 초안 생성.

- 코멘트는 client 리포트 content["counselor_comment"] 에 저장한다 (리포트=참가자 단위, 그룹 격리).
- counselor_notes(세션 기록지 내부 메모)와 분리 — 초안 프롬프트 소재로만 쓰고 원문 인용을 금지한다.
- Gemini 실패·키 부재·타임아웃 시 규칙 템플릿으로 폴백한다 (버튼이 죽지 않음, 5xx 없음).
"""

import logging
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy.orm import Session as DBSession

from app.config import settings
from app.models.record import Report, SessionRecord
from app.models.session import Session, SessionParticipant
from app.models.user import User

logger = logging.getLogger(__name__)

COMMENT_MAX_LENGTH = 1000
GEMINI_MODEL = "gemini-2.5-flash"
GEMINI_TIMEOUT_SECONDS = 15.0

_SESSION_TYPE_LABELS = {
    "clinical": "임상심리상담",
    "hypnosis": "최면심리상담",
    "meditation": "명상 수업",
}


def _load_client_report(report_id: str, host_id: str, db: DBSession) -> tuple[Report, Session]:
    """client 리포트 + host 접근 제어 공통 로드 (기존 리포트 접근 제어 재사용)."""
    from app.services.report_service import _can_access_report, _to_uuid

    report = db.query(Report).filter(Report.id == _to_uuid(report_id)).first()
    if not report:
        raise HTTPException(status_code=404, detail="리포트를 찾을 수 없습니다")
    session = db.query(Session).filter(Session.id == report.session_id).first()
    if not _can_access_report(host_id, session, db):
        raise HTTPException(status_code=403, detail="host 상담사만 가능합니다")
    if report.type != "client":
        raise HTTPException(status_code=400, detail="내담자 리포트에만 코멘트를 작성할 수 있습니다")
    return report, session


def update_client_comment(report_id: str, host_id: str, comment: str | None, db: DBSession) -> dict:
    """content.counselor_comment 갱신. null·빈 문자열 = 삭제 (빈 문자열 저장 금지 — null 보존)."""
    from app.services.report_service import _serialize

    report, session = _load_client_report(report_id, host_id, db)
    # 승인 후(completed) 수정 비허용 — 발송 콘텐츠 확정 원칙 (Q7)
    if report.status != "pending_review":
        raise HTTPException(status_code=400, detail="검토 대기 상태의 리포트만 코멘트를 수정할 수 있습니다")

    value = comment.strip() if isinstance(comment, str) else None
    if value is not None and len(value) > COMMENT_MAX_LENGTH:
        raise HTTPException(status_code=422, detail=f"코멘트는 {COMMENT_MAX_LENGTH}자 이내로 작성해 주세요")

    content = dict(report.content or {})
    if value:
        content["counselor_comment"] = value
    else:
        content.pop("counselor_comment", None)
    report.content = content
    db.commit()
    db.refresh(report)
    return _serialize(report, session)


def build_comment_draft(report_id: str, host_id: str, db: DBSession) -> dict:
    """AI 초안 생성 — DB 저장 없음(응답으로만 반환), 저장은 코멘트 저장 API 로만."""
    report, session = _load_client_report(report_id, host_id, db)
    context = _draft_context(report, session, db)
    draft, source = _generate_draft(context)
    return {"draft": draft, "source": source}


def ensure_auto_comment(report: Report, db: DBSession) -> None:
    """자동 승인(auto_approve_report) 경로: client 리포트에 코멘트가 없으면 AI 초안을 생성·저장한다.

    실패해도 승인·발송 흐름을 막지 않는다 (best-effort, 폴백 템플릿 포함).
    """
    if report.type != "client":
        return
    content = report.content if isinstance(report.content, dict) else {}
    existing = content.get("counselor_comment")
    if isinstance(existing, str) and existing.strip():
        return
    try:
        session = db.query(Session).filter(Session.id == report.session_id).first()
        if not session:
            return
        draft, _source = _generate_draft(_draft_context(report, session, db))
        new_content = dict(content)
        new_content["counselor_comment"] = draft
        report.content = new_content
        db.flush()
    except Exception:  # noqa: BLE001 — 코멘트 생성 실패가 승인을 실패시키지 않는다
        logger.exception("[comment_draft] 자동 승인 코멘트 생성 실패: report_id=%s", report.id)


def _session_type_label(session: Session) -> str:
    if session.type == "custom" and session.custom_type_name:
        return session.custom_type_name
    return _SESSION_TYPE_LABELS.get(session.type, "상담")


def _draft_context(report: Report, session: Session, db: DBSession) -> dict:
    """프롬프트 입력 계층 수집 — 필수(세션 메타)는 항상, 선택(요약·서사)은 있으면 보강."""
    participant = (
        db.query(SessionParticipant).filter(SessionParticipant.id == report.participant_id).first()
        if report.participant_id
        else None
    )
    participant_name = None
    if participant:
        if participant.user_id:
            user = db.query(User).filter(User.id == participant.user_id).first()
            participant_name = user.name if user else None
        else:
            participant_name = participant.guest_name
    participant_count = (
        db.query(SessionParticipant)
        .filter(
            SessionParticipant.session_id == session.id,
            SessionParticipant.is_waitlisted.is_(False),
        )
        .count()
    )

    scheduled_str = None
    if session.scheduled_at:
        scheduled_str = session.scheduled_at.astimezone(ZoneInfo("Asia/Seoul")).strftime("%Y년 %m월 %d일")

    context: dict = {
        "session_type": _session_type_label(session),
        "title": session.title,
        "scheduled_at": scheduled_str,
        "duration_min": session.duration_min,
        "participant_count": participant_count,
        "participant_name": participant_name,
    }

    # 그룹 세션의 공통 녹음 요약·메모는 타 참가자 내용을 포함할 수 있어 프롬프트에서 제외한다
    # (report_task._client_content 의 격리 규칙과 동일).
    record = (
        None
        if session.participant_mode == "group"
        else db.query(SessionRecord).filter(SessionRecord.session_id == session.id).first()
    )
    if record and isinstance(record.ai_summary, dict):
        summary = record.ai_summary
        for key in ("summary", "overview", "headline"):
            v = summary.get(key)
            if isinstance(v, str) and v.strip():
                context["ai_summary"] = v.strip()
                break
        sections = summary.get("sections")
        if isinstance(sections, dict) and sections:
            context["ai_sections"] = {str(k): str(v) for k, v in list(sections.items())[:5]}
    if record and isinstance(record.counselor_notes, str) and record.counselor_notes.strip():
        context["counselor_notes"] = record.counselor_notes.strip()

    # EEG 측정 세션이면 서사(narrative)를 보강 소재로 활용 — 미측정이면 넣지 않는다 (날조 금지)
    content = report.content if isinstance(report.content, dict) else {}
    eeg = content.get("eeg")
    if isinstance(eeg, dict) and eeg.get("status") in ("valid", "degraded"):
        narrative = eeg.get("narrative")
        if isinstance(narrative, dict):
            texts = [v for v in narrative.values() if isinstance(v, str) and v.strip()]
            if texts:
                context["eeg_narrative"] = " ".join(texts)
    return context


def _build_prompt(context: dict) -> str:
    lines = [
        "당신은 심리상담사를 돕는 글쓰기 보조자입니다.",
        "상담사가 내담자에게 보내는 세션 리포트에 첨부할 짧은 코멘트 초안을 작성하세요.",
        "",
        "규칙:",
        "- 따뜻한 존댓말, 내담자를 수신자로 하는 3~5문장.",
        "- 의료 진단·치료 효과를 단정하지 마세요 (진단/치료 목적 아님).",
        "- 아래에 없는 측정 결과나 대화 내용을 지어내지 마세요. 측정·기록이 없으면 언급하지 마세요.",
        "- 상담사 내부 메모가 있다면 소재로만 참고하고 원문을 인용하지 마세요.",
        f"- {COMMENT_MAX_LENGTH}자 이내의 순수 텍스트만 출력하세요 (JSON·머리말·따옴표 금지).",
        "",
        "세션 정보:",
        f"- 세션 유형: {context['session_type']}",
    ]
    if context.get("title"):
        lines.append(f"- 세션 제목: {context['title']}")
    if context.get("scheduled_at"):
        lines.append(f"- 일시: {context['scheduled_at']}")
    if context.get("duration_min"):
        lines.append(f"- 세션 시간: {context['duration_min']}분")
    lines.append(f"- 참가자 수: {context.get('participant_count') or 1}명")
    if context.get("participant_name"):
        lines.append(f"- 수신 내담자 이름: {context['participant_name']}")
    if context.get("ai_summary"):
        lines.append(f"- 세션 AI 요약: {context['ai_summary']}")
    if context.get("ai_sections"):
        for name, body in context["ai_sections"].items():
            lines.append(f"- 요약({name}): {body}")
    if context.get("eeg_narrative"):
        lines.append(f"- 뇌파 분석 서사: {context['eeg_narrative']}")
    if context.get("counselor_notes"):
        lines.append(f"- 상담사 내부 메모(인용 금지, 소재로만): {context['counselor_notes']}")
    return "\n".join(lines)


def _rule_based_draft(context: dict) -> str:
    """LLM 없이 세션 메타만으로 만드는 템플릿 초안 (항상 성공)."""
    when = f"{context['scheduled_at']} " if context.get("scheduled_at") else ""
    name = f"{context['participant_name']}님, " if context.get("participant_name") else ""
    sentences = [
        f"{name}{when}{context['session_type']} 세션에 함께해 주셔서 감사합니다.",
        "오늘 함께한 시간이 스스로를 돌아보는 의미 있는 걸음이 되었기를 바랍니다.",
        "세션에서 나눈 이야기들을 일상에서도 천천히 되새겨 보시길 권해 드립니다.",
        "궁금한 점이나 나누고 싶은 이야기가 있다면 언제든 편하게 알려 주세요.",
    ]
    return " ".join(sentences)[:COMMENT_MAX_LENGTH]


def _call_gemini(prompt: str) -> str | None:
    """Gemini generateContent 호출. 키 부재·오류·타임아웃 시 None (호출부에서 규칙 폴백)."""
    api_key = settings.gemini_api_key
    if not api_key:
        return None

    import httpx

    try:
        resp = httpx.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent",
            headers={"x-goog-api-key": api_key, "Content-Type": "application/json"},
            json={
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {"temperature": 0.6, "maxOutputTokens": 1024},
            },
            timeout=GEMINI_TIMEOUT_SECONDS,
        )
        resp.raise_for_status()
        data = resp.json()
        parts = data["candidates"][0]["content"]["parts"]
        text = "".join(p.get("text", "") for p in parts if isinstance(p, dict)).strip()
        return text or None
    except Exception:  # noqa: BLE001 — 공급자 오류가 초안 생성 자체를 실패시키지 않는다
        logger.warning("[comment_draft] Gemini 호출 실패 — 규칙 템플릿 폴백")
        return None


def _generate_draft(context: dict) -> tuple[str, str]:
    """(draft, source) — Gemini 성공 시 ("...", "llm"), 그 외 규칙 템플릿 ("...", "rule")."""
    text = _call_gemini(_build_prompt(context))
    if text:
        return text[:COMMENT_MAX_LENGTH], "llm"
    return _rule_based_draft(context), "rule"
