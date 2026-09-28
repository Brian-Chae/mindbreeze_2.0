"""AI 요약 — Celery 태스크 (SDD-013)

요약·서사 모두 Gemini 단독 (Deepseek 제거).
WebSocket `/record` 네임스페이스로 완료 상태 브로드캐스트.
"""

import json
import logging
from uuid import UUID

from sqlalchemy.orm import Session as DBSession

from app.config import settings
from app.models.session import Session
from app.models.record import SessionRecord

logger = logging.getLogger(__name__)

GEMINI_MODEL = "gemini-2.5-flash"
GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta"

TEMPLATE_BY_TYPE = {
    "clinical": ["주요 주제", "감정 분석", "상담사 소견", "권고사항", "진행 단계"],
    "hypnosis": ["유도 단계", "관찰", "후처리", "권고"],
    "meditation": ["수업 흐름", "참여자 반응", "권고"],
}


def _call_gemini_text(prompt: str, *, json_mode: bool = True, timeout: int = 120) -> str:
    """Gemini 텍스트 생성 — 응답 텍스트(JSON 모드 시 JSON 문자열)를 반환.

    키 미설정·네트워크·응답 형식 문제 시 예외를 그대로 전파한다 — 호출부가 폴백/실패를 결정.
    """
    if not settings.gemini_api_key:
        raise RuntimeError("gemini_api_key not set")

    import requests

    body: dict = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.3},
    }
    if json_mode:
        body["generationConfig"]["responseMimeType"] = "application/json"

    resp = requests.post(
        f"{GEMINI_BASE}/models/{GEMINI_MODEL}:generateContent",
        headers={
            "x-goog-api-key": settings.gemini_api_key,
            "Content-Type": "application/json",
        },
        json=body,
        timeout=timeout,
    )
    resp.raise_for_status()
    data = resp.json()
    try:
        return data["candidates"][0]["content"]["parts"][0]["text"].strip()
    except (KeyError, IndexError, TypeError) as exc:
        raise ValueError(f"Gemini 응답 형식 불일치: {exc}") from exc


def _call_narrative_llm(
    metrics_summary: dict,
    db: DBSession | None = None,
    *,
    force_refresh: bool = False,
) -> dict:
    """Gemini 서사 생성. 실패 시 규칙 스텁(fallback_narrative)으로 안전하게 폴백한다."""
    from app.models.narrative_cache import NarrativeCache
    from app.services.report_narrative import build_narrative_signature, fallback_narrative

    fallback = fallback_narrative(metrics_summary)
    signature = build_narrative_signature(metrics_summary)
    if db is not None and signature is not None and not force_refresh:
        cached = db.get(NarrativeCache, signature)
        if cached is not None:
            return dict(cached.narrative)

    def cache(narrative: dict, source: str) -> dict:
        if db is not None and signature is not None:
            db.merge(NarrativeCache(signature=signature, narrative=narrative, source=source))
            db.flush()
        return narrative

    if not any(
        metric.get("direction") is not None
        for group in ("body", "mind")
        for metric in metrics_summary.get(group, {}).values()
    ):
        return cache(fallback, "rule")

    prompt = """세션 전반과 후반의 생체 지표 변화를 한국어 서사로 설명하세요.
명상을 점수(0~100), 등급, 잘함/못함으로 평가하지 마세요.
몸과 마음이 어떻게 변했는지 관측된 방향만 설명하세요. 원천 지표이며 정규화 점수가 아닙니다.
null은 측정/비교 불가이므로 안정, 개선, 0으로 해석하지 마세요.
생체 지표로 감정, 질병, 자율신경 회복, 호흡 깊이, 치료 효과를 확정하지 마세요.
HRV는 PPG 기반 SDNN이며 ECG 측정으로 표현하지 마세요.
journey(종합 여정), body(몸의 변화), mind(마음의 변화), closing(마무리)의
네 키를 가진 JSON 객체만 반환하세요. 각 값은 비어 있지 않은 짧은 문자열입니다.
자료:
""" + json.dumps(metrics_summary, ensure_ascii=False, allow_nan=False)
    try:
        content = _call_gemini_text(prompt, json_mode=True, timeout=30)
        parsed = json.loads(content)
        keys = ("journey", "body", "mind", "closing")
        if not isinstance(parsed, dict) or any(
            not isinstance(parsed.get(key), str) or not parsed[key].strip() or len(parsed[key]) > 2000
            for key in keys
        ):
            raise ValueError("서사 JSON 계약 불일치")
        return cache({key: parsed[key].strip() for key in keys}, "llm")
    except Exception:  # 공급자 오류가 리포트 생성 자체를 실패시키지 않는다.
        logger.warning("[summary_task] 서사 생성 실패: 규칙 스텁 사용")
        return cache(fallback, "rule")


def _call_gemini_summary(session_type: str, transcript: str | None) -> dict:
    """Gemini API — 구조화된 JSON 요약. 실패 시 예외 전파(허위 요약 저장 금지)."""
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

    content = _call_gemini_text(prompt, json_mode=True, timeout=120)
    parsed = json.loads(content)
    parsed["transcript_present"] = bool(transcript)
    logger.info("[summary_task] Gemini 요약 성공: %s", parsed.get("headline", "")[:50])
    return parsed


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

    # SDD-085 가드: 수동 기록 모드(마이크 오프)는 요약 대상 아님
    if record.status == "manual":
        logger.info("[summary_task] manual 세션 — 요약 스킵: %s", session_id)
        return

    # SDD-085 가드: transcript 부재(None/공백) 시 LLM 호출·스텁 생성 없이 종료
    # — "(전사 기록 없음)"으로 LLM을 호출해 허위 요약이 저장되는 경로 제거
    if not record.transcript or not record.transcript.strip():
        logger.warning("[summary_task] transcript 없음 — 요약 미실행: %s", session_id)
        if record.status == "processing":
            record.status = "failed"
            db.commit()
        asyncio.run(_emit_status(session_id, "failed", {"reason": "no_transcript"}))
        return

    # SDD-085 G5 확장: STT 신뢰도가 낮으면 AI 요약(분석)을 생성하지 않는다 — 원본 전사문은 유지.
    # STT는 완료됐으므로 status는 completed 로 마감하고, 요약만 스킵한다.
    confidence = (record.ai_summary or {}).get("transcript_confidence")
    if confidence == "low":
        logger.info("[summary_task] 신뢰도 낮음 — AI 요약 미실행: %s", session_id)
        if record.status == "processing":
            record.status = "completed"
            db.commit()
        asyncio.run(_emit_status(session_id, "completed", {"reason": "low_confidence"}))
        return

    asyncio.run(_emit_status(session_id, "summarizing"))

    try:
        result = _call_gemini_summary(session.type, record.transcript)
    except Exception as exc:
        # SDD-085 G5: 허위 요약을 저장하지 않는다 — 전사문은 유지하고 요약 실패로 마감.
        logger.exception("[summary_task] Gemini 요약 실패: %s", exc)
        summary = dict(record.ai_summary or {})
        summary["summary_failed"] = True
        record.ai_summary = summary
        record.status = "completed"
        db.commit()
        asyncio.run(_emit_status(session_id, "completed", {"reason": "summary_failed"}))
        return

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
