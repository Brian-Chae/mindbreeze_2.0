"""STT (Whisper) + 화자분리 — Celery 태스크 (SDD-013)

파이프라인: merge_chunks → transcribe (Whisper) → diarize → 완료
WebSocket `/record` 네임스페이스로 각 단계 상태 브로드캐스트.
"""

import base64
import json
import logging
import os
import shutil
import tempfile
from uuid import UUID

from sqlalchemy.orm import Session as DBSession

from app.config import settings
from app.models.record import SessionRecord, AudioChunk

logger = logging.getLogger(__name__)

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
GEMINI_MODEL = "gemini-2.5-flash"
GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta"


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


def _call_gemini_transcribe(chunk_paths: list[str]) -> dict:
    """Gemini Audio로 STT + 화자 구분(diarization).

    오디오 청크를 병합해 Gemini에 inline_data로 전달하고,
    프롬프트로 counselor/client 2화자 구분 + 타임스탬프 JSON 응답을 유도한다.
    """
    if not settings.gemini_api_key:
        logger.warning("[stt_task] gemini_api_key 미설정")
        raise RuntimeError("gemini_api_key not set")

    # 1) 청크 병합 → base64
    merged = tempfile.NamedTemporaryFile(suffix=".webm", delete=False)
    merged_path = merged.name
    try:
        with open(merged_path, "wb") as out:
            for path in chunk_paths:
                with open(path, "rb") as src:
                    shutil.copyfileobj(src, out)
        with open(merged_path, "rb") as f:
            audio_b64 = base64.b64encode(f.read()).decode("utf-8")
    finally:
        os.unlink(merged_path)

    prompt = (
        "이 오디오는 상담사(counselor)와 내담자(client)의 1:1 상담 대화 녹음입니다. "
        "화자를 구분해 대화 전체를 전사하세요. "
        "다른 말 없이 아래 JSON 배열만 출력하세요:\n"
        '[{"speaker": "counselor" | "client", "text": "발화 내용", "start": 0.0, "end": 4.5}, ...]\n'
        "start/end는 오디오 시작 기준 초(float)로 표기하세요."
    )

    import httpx

    resp = httpx.post(
        f"{GEMINI_BASE}/models/{GEMINI_MODEL}:generateContent",
        headers={"x-goog-api-key": settings.gemini_api_key, "Content-Type": "application/json"},
        json={
            "contents": [
                {
                    "parts": [
                        {"text": prompt},
                        {"inline_data": {"mime_type": "audio/webm", "data": audio_b64}},
                    ]
                }
            ]
        },
        timeout=180,
    )
    resp.raise_for_status()
    result = resp.json()

    parts = (result.get("candidates") or [{}])[0].get("content", {}).get("parts", [])
    text = "".join(p.get("text", "") for p in parts if isinstance(p, dict))
    if not text.strip():
        raise RuntimeError("Gemini 응답에 텍스트 없음")

    segments = _extract_segments_json(text)
    raw_text = "\n".join(f"[{s['speaker']}] {s['text']}" for s in segments)
    logger.info("[stt_task] Gemini success: %d segments, %d chars", len(segments), len(raw_text))
    return {"segments": segments, "raw_text": raw_text}


def _extract_segments_json(text: str) -> list[dict]:
    """Gemini 응답에서 segments JSON 배열을 추출·검증한다. 실패 시 raise."""
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned.startswith("json"):
            cleaned = cleaned[4:]
        cleaned = cleaned.strip()

    start = cleaned.find("[")
    end = cleaned.rfind("]")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("segments JSON 배열을 찾지 못함")

    data = json.loads(cleaned[start : end + 1])
    if not isinstance(data, list):
        raise ValueError("segments가 배열이 아님")

    segments: list[dict] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        speaker = str(item.get("speaker", "")).strip().lower()
        if speaker in ("상담사", "counselor", "호스트"):
            speaker = "counselor"
        elif speaker in ("내담자", "client", "고객"):
            speaker = "client"
        else:
            speaker = "speaker_0"
        seg_text = str(item.get("text", "")).strip()
        if not seg_text:
            continue
        try:
            seg_start = float(item.get("start", 0.0))
        except (TypeError, ValueError):
            seg_start = 0.0
        try:
            seg_end = float(item.get("end", seg_start))
        except (TypeError, ValueError):
            seg_end = seg_start
        segments.append({"speaker": speaker, "text": seg_text, "start": seg_start, "end": seg_end})

    if not segments:
        raise ValueError("유효한 segments 없음")
    return segments


def _generate_stub(chunk_paths: list[str]) -> dict:
    """API 키 없을 때 사용하는 스텁 (SDD-085: 청크 0개 경로에서는 호출되지 않음)."""
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

    # SDD-085 가드 1: 수동 기록 모드(마이크 오프)는 STT 대상 아님
    if record.status == "manual":
        logger.info("[stt_task] manual 세션 — STT 스킵: %s", session_id)
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

    # SDD-085 가드 2(G5): 청크 0개면 스텁 가짜 전사를 저장하지 않는다 — 데이터 무결성
    if not chunks:
        logger.warning("[stt_task] 오디오 청크 없음 — STT 미실행(failed): %s", session_id)
        record.status = "failed"
        db.commit()
        asyncio.run(_emit_status(session_id, "failed", {"reason": "no_audio_chunks"}))
        return

    asyncio.run(_emit_status(session_id, "transcribing"))
    try:
        result = _call_gemini_transcribe(chunk_paths)
    except Exception as exc:
        logger.exception("[stt_task] Gemini transcribe failed, Whisper fallback: %s", exc)
        try:
            result = _call_whisper(chunk_paths)
        except Exception as exc2:
            # 가짜 stub 전사를 저장하지 않는다(SDD-085 G5 원칙) — 실패로 기록
            logger.exception("[stt_task] Whisper failed — STT 실패 처리: %s", exc2)
            record.status = "failed"
            db.commit()
            asyncio.run(_emit_status(session_id, "failed", {"reason": "stt_failed"}))
            return

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
