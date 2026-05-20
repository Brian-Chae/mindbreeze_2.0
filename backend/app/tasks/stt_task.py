"""STT (Gemini Audio) Celery 태스크 — MVP1 스텁

실제 Gemini API 호출은 비활성. 청크 개수와 더미 텍스트로 transcript를 채운다.
"""

import logging
import os
from uuid import UUID

from sqlalchemy.orm import Session as DBSession

from app.models.record import SessionRecord, AudioChunk

logger = logging.getLogger(__name__)

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")


def _call_gemini_audio(chunk_paths: list[str]) -> dict:
    """실제 Gemini Audio API 호출 자리. MVP1에서는 스텁."""
    logger.info("[stt_task] Gemini stub invoked: %d chunks", len(chunk_paths))
    segments = [
        {"speaker": "counselor", "text": "안녕하세요. 오늘 컨디션은 어떠세요?", "start": 0.0, "end": 4.5},
        {"speaker": "client", "text": "조금 피곤하지만 괜찮습니다.", "start": 4.5, "end": 8.0},
    ]
    raw_text = "\n".join(f"[{s['speaker']}] {s['text']}" for s in segments)
    return {"segments": segments, "raw_text": raw_text}


def _call_whisper_fallback(chunk_paths: list[str]) -> dict:
    """Gemini 실패 시 Whisper+pyannote 폴백. MVP1 스텁."""
    logger.warning("[stt_task] Whisper fallback invoked")
    return {"segments": [], "raw_text": "(전사 실패 — 폴백 처리)"}


def run_stt_inline(session_id: str, db: DBSession) -> None:
    """동기 실행용 헬퍼 (Celery 비활성 환경/테스트)."""
    sid = UUID(session_id)
    record = db.query(SessionRecord).filter(SessionRecord.session_id == sid).first()
    if not record:
        logger.warning("[stt_task] SessionRecord not found: %s", session_id)
        return

    chunks = (
        db.query(AudioChunk)
        .filter(AudioChunk.session_id == sid)
        .order_by(AudioChunk.chunk_index.asc())
        .all()
    )
    chunk_paths = [c.file_path for c in chunks]

    try:
        result = _call_gemini_audio(chunk_paths)
    except Exception as exc:  # noqa: BLE001
        logger.exception("[stt_task] Gemini failed, using fallback: %s", exc)
        result = _call_whisper_fallback(chunk_paths)

    record.transcript = result.get("raw_text")
    summary = dict(record.ai_summary or {})
    summary["segments"] = result.get("segments", [])
    record.ai_summary = summary
    db.commit()


# Celery 태스크 정의 (Celery 미가용 환경에서도 import 가능하도록 try/except)
try:
    from celery import shared_task

    @shared_task(name="tasks.stt")
    def stt_task(session_id: str) -> None:
        from app.core.database import SessionLocal

        db = SessionLocal()
        try:
            run_stt_inline(session_id, db)
        finally:
            db.close()
except Exception:  # noqa: BLE001
    pass
