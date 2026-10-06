"""AI 요약 — Celery 태스크 (SDD-013)

요약·서사 모두 Gemini 단독 (Deepseek 제거).
WebSocket `/record` 네임스페이스로 완료 상태 브로드캐스트.
"""

import json
import logging
from uuid import UUID

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session as DBSession

from app.config import settings
from app.core.celery_app import RetryableTaskError
from app.models.session import Session
from app.models.record import SessionRecord

logger = logging.getLogger(__name__)

# GEN-5TH-10: 모델명은 settings.gemini_model 에서 읽는다(호출 시점 참조).
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
        f"{GEMINI_BASE}/models/{settings.gemini_model}:generateContent",
        headers={
            "x-goog-api-key": settings.gemini_api_key,
            "Content-Type": "application/json",
        },
        json=body,
        timeout=timeout,
    )
    # CEL-RETRY-01: 5xx/429·네트워크 오류는 일시적이므로 재시도 가능한 예외로 구분한다.
    # 4xx(요청 오류)는 영구 오류로 남겨 백오프 재시도로 호출을 낭비하지 않는다.
    status = getattr(resp, "status_code", None)
    if isinstance(status, int) and (status == 429 or status >= 500):
        raise RetryableTaskError(f"gemini_http_{status}")
    resp.raise_for_status()
    data = resp.json()
    try:
        return data["candidates"][0]["content"]["parts"][0]["text"].strip()
    except (KeyError, IndexError, TypeError) as exc:
        raise ValueError(f"Gemini 응답 형식 불일치: {exc}") from exc


def _partial_narrative_signature(metrics_summary: dict) -> str:
    """direction 결측을 '?' 로 표시한 6지표 캐시 키 (SUM-5TH-08).

    전체 시그니처(build_narrative_signature)는 한 지표라도 결측이면 None 이라 캐시를 쓸 수
    없었다. 부분 키로 캐시를 허용하되 결측('?')을 stable('→')로 치환하지 않아, 서로 다른
    결측 조합이 같은 키로 섞이지 않는다(NarrativeCache.signature 는 6자 고정).
    """
    from app.services.report_narrative import SIGNATURE_DIRECTION, SIGNATURE_METRICS

    parts: list[str] = []
    for group, metric in SIGNATURE_METRICS:
        group_summary = metrics_summary.get(group)
        metric_summary = (
            group_summary.get(metric) if isinstance(group_summary, dict) else None
        )
        direction = metric_summary.get("direction") if isinstance(metric_summary, dict) else None
        parts.append(SIGNATURE_DIRECTION.get(direction, "?") if isinstance(direction, str) else "?")
    return "".join(parts)


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
    # SUM-5TH-08: 일부 지표의 direction 이 None(비교 불가)이면 전체 시그니처가 None 이 되어
    # 캐시를 아예 쓰지 못했다(같은 입력을 매번 재계산·폴백 재생성). 결측을 '?' 로 표시한
    # 부분 시그니처로도 캐시 키를 만들어 반복 호출을 막는다(null 을 stable 로 오인하지 않는다).
    signature = build_narrative_signature(metrics_summary)
    if signature is None:
        signature = _partial_narrative_signature(metrics_summary)
    cache_ok = True
    if db is not None and signature is not None and not force_refresh:
        # 캐시는 best-effort — 조회 실패(예: 아직 마이그레이션 전이라 narrative_cache 테이블이
        # 없음)가 리포트 생성 자체를 막아선 안 된다.
        try:
            cached = db.get(NarrativeCache, signature)
        except SQLAlchemyError:
            cached = None
            cache_ok = False
            logger.warning("[summary_task] 서사 캐시 조회 실패 — 캐시 없이 진행")
        if cached is not None:
            return dict(cached.narrative)

    def cache(narrative: dict, source: str) -> dict:
        if db is not None and signature is not None and cache_ok:
            # SAVEPOINT 로 감싸 저장 실패가 호출측 트랜잭션(진행 중인 flush)을 되돌리지 않게 한다.
            try:
                with db.begin_nested():
                    db.merge(
                        NarrativeCache(signature=signature, narrative=narrative, source=source)
                    )
                    db.flush()
            except SQLAlchemyError:
                logger.warning("[summary_task] 서사 캐시 저장 실패 — 결과는 반환")
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
- 원천 지표의 소수점 수치를 문장에 나열하지 마세요. "집중이 0.495에서 0.645로" 대신 "집중이 높아졌어요"처럼 방향만 쓰세요.
- 호흡수·심박수처럼 자연스러운 단위(회/분) 수치는 써도 좋지만, 집중·이완·감정안정도의 소수점 원천값은 쓰지 마세요.
null은 측정/비교 불가이므로 안정, 개선, 0으로 해석하지 마세요.
생체 지표로 감정, 질병, 자율신경 회복, 호흡 깊이, 치료 효과를 확정하지 마세요.
용어는 일반 사용자 눈높이로 쓰세요: HRV는 "심박변이", emotional_stability는 "감정안정도"로 통일하고 SDNN·RMSSD·PPG·LF/HF 같은 전문 약어와 "정규화", "점수", "스코어", "원천", "원시" 같은 기술 용어는 쓰지 마세요.
journey(종합 여정), body(몸의 변화), mind(마음의 변화), closing(마무리)의
네 키와 metrics(지표별 한 문장 설명) 키를 가진 JSON 객체만 반환하세요. 각 값은 비어 있지 않은 짧은 문자열입니다.
metrics 는 "respiratory_rate", "heart_rate", "hrv", "focus", "relaxation", "emotional_stability"
여섯 키를 가진 객체이며, 각 값은 해당 지표의 변화를 주어진 direction(up/down/stable)에 맞게 설명하는 60자 이내 문장입니다.
direction 이 down(하락)인 지표를 "몰입을 되찾았다", "회복했다", "편안함을 찾았다"처럼 개선·회복으로 쓰면 안 됩니다.
direction 이 up(상승)인 지표를 "흔들렸다", "산만해졌다"처럼 악화로 쓰면 안 됩니다.
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
        narrative = {key: parsed[key].strip() for key in keys}
        # 지표별 문장 검수 — 금지 용어·길이·방향 모순은 걸러 규칙 문장 폴백을 남긴다.
        metric_sentences = _validate_metric_sentences(metrics_summary, parsed.get("metrics"))
        if metric_sentences:
            narrative["metrics"] = metric_sentences
        return cache(narrative, "llm")
    except Exception:  # 공급자 오류가 리포트 생성 자체를 실패시키지 않는다.
        logger.warning("[summary_task] 서사 생성 실패: 규칙 스텁 사용")
        return cache(fallback, "rule")


def _validate_metric_sentences(metrics_summary: dict, raw: object) -> dict[str, str] | None:
    """LLM metrics 객체 검수 — 방향·금지 용어·길이를 통과한 지표 문장만 반환한다."""
    from app.services.report_narrative import validate_metric_sentence

    if not isinstance(raw, dict):
        return None
    result: dict[str, str] = {}
    for group in ("body", "mind"):
        for key, metric in metrics_summary.get(group, {}).items():
            sentence = raw.get(key)
            direction = metric.get("direction")
            if isinstance(sentence, str) and validate_metric_sentence(sentence, direction):
                result[key] = sentence.strip()
    return result or None


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
    # SUM-5TH-07: 필수 키 계약(headline/sections/keywords/risk_flags)을 검증한다. 검증 없이
    # 통과시키면 빈/불완전 요약이 그대로 저장돼 리포트가 허위 내용을 담는다. 계약 위반은 예외로
    # 전파해 호출측(run_summary_inline)이 summary_failed 로 마킹하게 한다.
    if not isinstance(parsed, dict):
        raise ValueError("요약 응답이 JSON 객체가 아님")
    if not isinstance(parsed.get("headline"), str) or not parsed["headline"].strip():
        raise ValueError("요약 필수 키 누락/형식 오류: headline")
    if not isinstance(parsed.get("sections"), dict) or not parsed["sections"]:
        raise ValueError("요약 필수 키 누락/형식 오류: sections")
    if not isinstance(parsed.get("keywords"), list):
        raise ValueError("요약 필수 키 누락/형식 오류: keywords")
    if not isinstance(parsed.get("risk_flags"), list):
        raise ValueError("요약 필수 키 누락/형식 오류: risk_flags")
    parsed["transcript_present"] = bool(transcript)
    logger.info("[summary_task] Gemini 요약 성공: %s", parsed.get("headline", "")[:50])
    return parsed


async def _emit_status(session_id: str, status: str, detail: dict | None = None):
    try:
        from app.ws.record_namespace import broadcast_record_status
        await broadcast_record_status(session_id, status, detail)
    except Exception:
        logger.warning("[summary_task] WebSocket emit failed: %s", status)


def _emit_report_progress(session_id: str, db: DBSession) -> None:
    """SDD-095: 리포트 생성 진행 상태(`report:progress`) 브로드캐스트."""
    try:
        from app.services import report_progress_service

        report_progress_service.emit_report_progress(session_id, db)
    except Exception:
        logger.warning("[summary_task] report:progress emit failed: %s", session_id)


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
        _emit_report_progress(session_id, db)
        return

    # SDD-085 가드: transcript 부재(None/공백) 시 LLM 호출·스텁 생성 없이 종료
    # — "(전사 기록 없음)"으로 LLM을 호출해 허위 요약이 저장되는 경로 제거
    if not record.transcript or not record.transcript.strip():
        logger.warning("[summary_task] transcript 없음 — 요약 미실행: %s", session_id)
        if record.status == "processing":
            record.status = "failed"
            db.commit()
        asyncio.run(_emit_status(session_id, "failed", {"reason": "no_transcript"}))
        _emit_report_progress(session_id, db)
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
        _emit_report_progress(session_id, db)
        return

    asyncio.run(_emit_status(session_id, "summarizing"))
    # SDD-095: AI 요약 단계 진행 표시
    _emit_report_progress(session_id, db)

    try:
        result = _call_gemini_summary(session.type, record.transcript)
    except RetryableTaskError:
        # CEL-RETRY-01: 5xx/429·네트워크 등 일시 오류는 summary_failed 로 굳히지 않고
        # 전파해 Celery autoretry(backoff)로 재시도한다. status 는 processing 으로 남겨
        # 재시도가 이어받을 수 있게 한다(영구 실패가 아니므로 completed 마킹 금지).
        logger.warning("[summary_task] Gemini 일시 오류 — 재시도 위임: %s", session_id)
        asyncio.run(_emit_status(session_id, "summarizing", {"retryable": True}))
        raise
    except Exception as exc:
        # SDD-085 G5: 허위 요약을 저장하지 않는다 — 전사문은 유지하고 요약 실패로 마감.
        logger.exception("[summary_task] Gemini 요약 실패: %s", exc)
        summary = dict(record.ai_summary or {})
        summary["summary_failed"] = True
        record.ai_summary = summary
        record.status = "completed"
        db.commit()
        asyncio.run(_emit_status(session_id, "completed", {"reason": "summary_failed"}))
        _emit_report_progress(session_id, db)
        return

    summary = dict(record.ai_summary or {})
    summary.update(result)
    record.ai_summary = summary
    record.status = "completed"
    db.commit()

    asyncio.run(_emit_status(session_id, "completed", {"headline": result.get("headline")}))
    logger.info("[summary_task] Summary complete for session %s", session_id)
    # SDD-095: 요약 완료 → 리포트 생성 단계로 넘어감을 진행 스텝퍼에 반영
    _emit_report_progress(session_id, db)


try:
    from app.core.celery_app import celery_app

    # STT-5TH-04: 미처리 인프라 오류(일시)에 대한 Celery 레벨 재시도 — report_email_task 패턴.
    @celery_app.task(
        name="tasks.summary",
        autoretry_for=(RuntimeError,),
        retry_backoff=True,
        retry_kwargs={"max_retries": 3},
    )
    def summary_task(session_id: str) -> None:
        from app.core.database import SessionLocal

        db = SessionLocal()
        try:
            run_summary_inline(session_id, db)
        finally:
            db.close()
except Exception:  # noqa: BLE001
    # MB-ERR-001: 등록 예외를 삼키면 태스크 미등록으로 파이프라인이 조용히 끊긴다.
    logger.exception("[summary_task] Celery 태스크 등록 실패 — tasks.summary 미등록 가능")
