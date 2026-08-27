"""AI 요약 — Celery 태스크 (SDD-013)

1차: Deepseek → 2차: Gemini 폴백
WebSocket `/record` 네임스페이스로 완료 상태 브로드캐스트.
"""

import json
import logging
import os
from uuid import UUID

from sqlalchemy.orm import Session as DBSession

from app.models.session import Session
from app.models.record import SessionRecord

logger = logging.getLogger(__name__)

DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY", "")
DEEPSEEK_BASE = "https://api.deepseek.com/v1"

TEMPLATE_BY_TYPE = {
    "clinical": ["주요 주제", "감정 분석", "상담사 소견", "권고사항", "진행 단계"],
    "hypnosis": ["유도 단계", "관찰", "후처리", "권고"],
    "meditation": ["수업 흐름", "참여자 반응", "권고"],
}


def _call_deepseek_summary(session_type: str, transcript: str | None) -> dict:
    """Deepseek API — 구조화된 JSON 요약."""
    if not DEEPSEEK_API_KEY:
        logger.warning("[summary_task] DEEPSEEK_API_KEY not set, using stub")
        return _generate_stub(session_type, transcript)

    import requests

    sections = TEMPLATE_BY_TYPE.get(session_type, ["요약", "관찰", "권고"])
    sections_format = ", ".join(f'"{s}": "내용"' for s in sections)

    prompt = f"""다음은 심리상담 세션의 전사 기록입니다. 아래 JSON 형식으로 요약해주세요.
세션 유형: {session_type}
요약 항목: {', '.join(sections)}

반드시 다음 JSON 형식으로만 응답하세요:
{{
  "headline": "세션 한 줄 요약",
  "sections": {{
    {sections_format}
  }},
  "keywords": ["키워드1", "키워드2", "키워드3"],
  "risk_flags": []
}}

전사 기록:
{transcript or "(전사 기록 없음)"}"""

    try:
        resp = requests.post(
            f"{DEEPSEEK_BASE}/chat/completions",
            headers={
                "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": "deepseek-chat",
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.3,
                "max_tokens": 2048,
            },
            timeout=120,
        )
        resp.raise_for_status()
        result = resp.json()
        content = result["choices"][0]["message"]["content"]

        # JSON 추출 (코드 블록 제거)
        content = content.strip()
        if content.startswith("```"):
            content = content.split("\n", 1)[-1]
            if content.endswith("```"):
                content = content[:-3]
            content = content.strip()
        if content.lower().startswith("json"):
            content = content[4:].strip()

        parsed = json.loads(content)
        parsed["transcript_present"] = bool(transcript)
        logger.info("[summary_task] Deepseek success: %s", parsed.get("headline", "")[:50])
        return parsed

    except (requests.RequestException, json.JSONDecodeError, KeyError) as exc:
        logger.exception("[summary_task] Deepseek failed: %s", exc)
        raise


def _generate_stub(session_type: str, transcript: str | None) -> dict:
    """API 키 없거나 실패 시 스텁."""
    logger.info("[summary_task] Stub: type=%s", session_type)
    sections = TEMPLATE_BY_TYPE.get(session_type, ["요약", "관찰", "권고"])
    return {
        "headline": f"{session_type} 세션 AI 요약 (자동 생성)",
        "sections": {sec: f"{sec} 내용이 자동 생성되었습니다." for sec in sections},
        "keywords": ["키워드1", "키워드2", "키워드3"],
        "risk_flags": [],
        "transcript_present": bool(transcript),
    }


async def _emit_status(session_id: str, status: str, detail: dict | None = None):
    try:
        from app.ws.record_namespace import broadcast_record_status
        await broadcast_record_status(session_id, status, detail)
    except Exception:
        logger.warning("[summary_task] WebSocket emit failed: %s", status)


def run_summary_inline(session_id: str, db: DBSession) -> None:
    import asyncio

    sid = UUID(session_id)
    record = db.query(SessionRecord).filter(SessionRecord.session_id == sid).first()
    session = db.query(Session).filter(Session.id == sid).first()
    if not record or not session:
        logger.warning("[summary_task] not found: %s", session_id)
        return

    asyncio.run(_emit_status(session_id, "summarizing"))

    try:
        result = _call_deepseek_summary(session.type, record.transcript)
    except Exception as exc:
        logger.exception("[summary_task] Deepseek failed: %s", exc)
        result = _generate_stub(session.type, record.transcript)

    summary = dict(record.ai_summary or {})
    summary.update(result)
    record.ai_summary = summary
    record.status = "completed"
    db.commit()

    asyncio.run(_emit_status(session_id, "completed", {"headline": result.get("headline")}))
    logger.info("[summary_task] Summary complete for session %s", session_id)


try:
    from celery import shared_task

    @shared_task(name="tasks.summary")
    def summary_task(session_id: str) -> None:
        from app.core.database import SessionLocal

        db = SessionLocal()
        try:
            run_summary_inline(session_id, db)
        finally:
            db.close()
except Exception:
    pass
