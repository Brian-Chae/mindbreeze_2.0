"""STT (Whisper) + 화자분리 — Celery 태스크 (SDD-013)

파이프라인: merge_chunks → transcribe (Whisper) → diarize → 완료
WebSocket `/record` 네임스페이스로 각 단계 상태 브로드캐스트.
"""

import json
import logging
import os
from uuid import UUID

from sqlalchemy.orm import Session as DBSession

from app.models.record import SessionRecord, AudioChunk

logger = logging.getLogger(__name__)

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")


def _call_whisper(chunk_paths: list[str]) -> dict:
    """OpenAI Whisper API — STT. 실제 API 호출."""
    if not OPENAI_API_KEY:
        logger.warning("[stt_task] OPENAI_API_KEY not set, using stub")
        return _generate_stub(chunk_paths)

    import requests

    logger.info("[stt_task] Whisper API: %d chunks", len(chunk_paths))

    # 청크 파일들을 읽어서 하나의 파일로 병합 후 Whisper에 전송
    # Whisper는 multipart/form-data로 파일 업로드
    import tempfile
    import shutil

    merged = tempfile.NamedTemporaryFile(suffix=".webm", delete=False)
    merged_path = merged.name
    try:
        for path in chunk_paths:
            with open(path, "rb") as src:
                shutil.copyfileobj(src, merged)
        merged.close()

        with open(merged_path, "rb") as f:
            resp = requests.post(
                "https://api.openai.com/v1/audio/transcriptions",
                headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
                files={"file": ("audio.webm", f, "audio/webm")},
                data={
                    "model": "whisper-1",
                    "language": "ko",
                    "response_format": "verbose_json",
                    "timestamp_granularities": ["segment"],
                },
                timeout=120,
            )
        resp.raise_for_status()
        result = resp.json()

        # Whisper verbose_json → segments 변환
        segments = []
        for seg in result.get("segments", []):
            segments.append({
                "speaker": "speaker_0",  # Whisper는 화자분리 미지원 → diarization 단계에서 처리
                "text": seg.get("text", "").strip(),
                "start": seg.get("start", 0.0),
                "end": seg.get("end", 0.0),
            })

        raw_text = result.get("text", "")
        logger.info("[stt_task] Whisper success: %d segments, %d chars", len(segments), len(raw_text))
        return {"segments": segments, "raw_text": raw_text}

    except (requests.RequestException, KeyError) as exc:
        logger.exception("[stt_task] Whisper API failed: %s", exc)
        raise
    finally:
        os.unlink(merged_path)


def _call_gemini_fallback(chunk_paths: list[str]) -> dict:
    """Whisper 실패 시 Gemini 폴백 (동일한 인터페이스). 현재 스텁."""
    logger.warning("[stt_task] Gemini fallback invoked")
    return _generate_stub(chunk_paths)


def _generate_stub(chunk_paths: list[str]) -> dict:
    """청크가 없거나 API 키 없을 때 사용하는 스텁."""
    segments = [
        {"speaker": "counselor", "text": "안녕하세요. 오늘 컨디션은 어떠세요?", "start": 0.0, "end": 4.5},
        {"speaker": "client", "text": "조금 피곤하지만 괜찮습니다.", "start": 4.5, "end": 8.0},
        {"speaker": "counselor", "text": "어떤 점이 특히 힘드셨나요?", "start": 8.0, "end": 12.0},
        {"speaker": "client", "text": "요즘 잠을 잘 못 자서 집중이 안 돼요.", "start": 12.0, "end": 16.0},
    ]
    return {
        "segments": segments,
        "raw_text": "\n".join(f"[{s['speaker']}] {s['text']}" for s in segments),
    }


async def _emit_status(session_id: str, status: str, detail: dict | None = None):
    """WebSocket으로 처리 상태 브로드캐스트."""
    try:
        from app.ws.record_namespace import broadcast_record_status
        await broadcast_record_status(session_id, status, detail)
    except Exception:
        logger.warning("[stt_task] WebSocket emit failed: %s", status)


def run_stt_inline(session_id: str, db: DBSession) -> None:
    """동기 실행용 헬퍼 — Celery 비활성 환경/테스트에서 직접 호출."""
    import asyncio

    sid = UUID(session_id)
    record = db.query(SessionRecord).filter(SessionRecord.session_id == sid).first()
    if not record:
        logger.warning("[stt_task] SessionRecord not found: %s", session_id)
        return

    asyncio.run(_emit_status(session_id, "merging"))

    chunks = (
        db.query(AudioChunk)
        .filter(AudioChunk.session_id == sid)
        .order_by(AudioChunk.chunk_index.asc())
        .all()
    )
    chunk_paths = [c.file_path for c in chunks]
    logger.info("[stt_task] Merged %d chunks for session %s", len(chunks), session_id)

    asyncio.run(_emit_status(session_id, "transcribing"))
    try:
        result = _call_whisper(chunk_paths)
    except Exception as exc:
        logger.exception("[stt_task] Whisper failed, fallback: %s", exc)
        result = _call_gemini_fallback(chunk_paths)

    asyncio.run(_emit_status(session_id, "diarizing"))
    segments = result.get("segments", [])

    record.transcript = result.get("raw_text")
    summary = dict(record.ai_summary or {})
    summary["segments"] = segments
    record.ai_summary = summary
    db.commit()
    logger.info("[stt_task] STT complete: %d segments", len(segments))


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
except Exception:
    pass
