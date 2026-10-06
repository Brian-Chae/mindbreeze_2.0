"""STT (Whisper) + 화자분리 — Celery 태스크 (SDD-013)

파이프라인: merge_chunks → transcribe (Whisper) → diarize → 완료
WebSocket `/record` 네임스페이스로 각 단계 상태 브로드캐스트.
"""

import base64
import json
import logging
import math
import os
import re
import shutil
import tempfile
from uuid import UUID

from sqlalchemy.orm import Session as DBSession

from app.config import settings
from app.models.record import SessionRecord, AudioChunk
from app.models.session import Session

logger = logging.getLogger(__name__)

GEMINI_MODEL = "gemini-2.5-flash"
GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta"
GEMINI_TIMEOUT = 300  # SDD-121: 4분+ 오디오도 처리 — 기존 180초 타임아웃 완화
GEMINI_SEGMENT_SECONDS = 90  # 이 이상이면 세그먼트 분할(단일 요청 크기/시간 초과 방지)

# STT-5TH-01: Gemini STT 실패를 일시/영구로 구분한다.
#   - 일시(transient): 네트워크 오류/타임아웃/429/5xx — backoff 재시도 후에도 실패하면 Whisper 폴백.
#   - 영구(permanent): 4xx(요청·인증 오류)/응답 계약 위반 — 재시도·폴백 없이 즉시 실패.
# 예외를 구분하지 않으면 어떤 실패에도 전체 Whisper 재전사(비용 2배)가 발생하던 문제를 막는다.
GEMINI_RETRY_ATTEMPTS = 3          # 최초 시도 포함 총 시도 횟수
GEMINI_RETRY_BACKOFF_SEC = 1.0     # 지수 backoff 기준(1s → 2s)
GEMINI_TRANSIENT_STATUS = frozenset({408, 425, 429, 500, 502, 503, 504})


class GeminiTransientError(RuntimeError):
    """Gemini 일시 오류(네트워크/타임아웃/429/5xx) — backoff 재시도·Whisper 폴백 대상."""


def _gemini_request_once(url: str, headers: dict, body: dict, timeout: int) -> dict:
    """Gemini POST 1회. 일시 오류는 GeminiTransientError, 영구 오류는 그대로 전파한다."""
    import httpx

    try:
        resp = httpx.post(url, headers=headers, json=body, timeout=timeout)
    except httpx.TransportError as exc:  # 타임아웃/연결/읽기 오류 = 일시
        raise GeminiTransientError(f"transport: {exc}") from exc

    if resp.status_code in GEMINI_TRANSIENT_STATUS:
        raise GeminiTransientError(f"HTTP {resp.status_code}")
    # 그 외 4xx(400/401/403/404/422 등)는 영구 오류 — raise_for_status 가 HTTPStatusError 로 전파.
    resp.raise_for_status()
    return resp.json()


def _gemini_post_with_retry(url: str, headers: dict, body: dict, timeout: int) -> dict:
    """일시 오류만 지수 backoff 로 재시도한다. 소진 시 GeminiTransientError 전파."""
    import time

    for attempt in range(1, GEMINI_RETRY_ATTEMPTS + 1):
        try:
            return _gemini_request_once(url, headers, body, timeout)
        except GeminiTransientError as exc:
            if attempt >= GEMINI_RETRY_ATTEMPTS:
                logger.warning(
                    "[stt_task] Gemini 일시 오류 재시도 소진(%d회): %s", attempt, exc
                )
                raise
            delay = GEMINI_RETRY_BACKOFF_SEC * (2 ** (attempt - 1))
            logger.warning(
                "[stt_task] Gemini 일시 오류(재시도 %d/%d, %.1fs 후): %s",
                attempt, GEMINI_RETRY_ATTEMPTS, delay, exc,
            )
            time.sleep(delay)
    raise GeminiTransientError("Gemini 재시도 루프 비정상 종료")  # 도달 불가(방어)



def _split_existing_chunks(chunk_paths: list[str]) -> tuple[list[str], list[str]]:
    """청크 경로를 존재/누락으로 분리한다.

    STT-01: 일부 청크 파일이 유실돼도 전사 전체가 실패하지 않도록, 존재하는 청크만
    병합 대상으로 삼고 누락분은 로그·결과에 표시한다(결손 구간 보존).
    반환: (존재 경로, 누락 경로).
    """
    existing: list[str] = []
    missing: list[str] = []
    for path in chunk_paths:
        (existing if os.path.exists(path) else missing).append(path)
    return existing, missing


def _call_whisper(chunk_paths: list[str]) -> dict:
    """OpenAI Whisper API — STT. 실제 API 호출.

    STT-5TH-02: 키는 settings.openai_api_key 에서 읽는다(os.environ 직접 조회 제거).
    STT-5TH-03: Whisper 는 화자분리를 지원하지 않아 모든 세그먼트가 speaker_0 으로
    고정된다 — 폴백 사실을 결과에 diarization_fallback=True 로 명시해 상담사/내담자
    구분이 소실됐음을 상위에서 기록할 수 있게 한다.
    """
    openai_api_key = settings.openai_api_key
    if not openai_api_key:
        # SDD-085 G5: 키 미설정 시 가짜 stub 전사를 만들지 않는다 — 실패로 처리해
        # 상위(run_stt_inline)에서 record.status='failed' 로 마감한다.
        raise RuntimeError("OPENAI_API_KEY not set")

    import requests

    # STT-01: 일부 청크가 누락돼도 전사 전체를 실패시키지 않는다 — 존재 청크만 병합.
    existing, missing = _split_existing_chunks(chunk_paths)
    if not existing:
        raise RuntimeError("전사 가능한 청크 없음 — 전부 누락")
    if missing:
        logger.warning("[stt_task] [청크 누락] Whisper %d개 건너뜀: %s", len(missing), missing)
    logger.info("[stt_task] Whisper API: %d chunks(누락 %d)", len(existing), len(missing))

    # 청크 파일들을 읽어서 하나의 파일로 병합 후 Whisper에 전송
    # Whisper는 multipart/form-data로 파일 업로드
    merged = tempfile.NamedTemporaryFile(suffix=".webm", delete=False)
    merged_path = merged.name
    try:
        # STT-02: 병합 파일 핸들을 with 로 관리해 병합 중 예외가 나도 반드시 닫히게 한다.
        with merged:
            for path in existing:
                with open(path, "rb") as src:
                    shutil.copyfileobj(src, merged)

        with open(merged_path, "rb") as f:
            resp = requests.post(
                "https://api.openai.com/v1/audio/transcriptions",
                headers={"Authorization": f"Bearer {openai_api_key}"},
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
        # STT-5TH-03: 화자분리 소실(모든 speaker_0) — 폴백 사실을 결과에 명시한다.
        return {
            "segments": segments,
            "raw_text": raw_text,
            "missing_chunks": len(missing),
            "diarization_fallback": True,
        }

    except (requests.RequestException, KeyError, OSError, ValueError) as exc:
        # STT-02: 파일 I/O(OSError)·JSON 파싱(ValueError) 오류도 명시적으로 잡아
        # 로그를 남기고 상위(run_stt_inline)에서 실패로 마감되도록 re-raise 한다.
        logger.exception("[stt_task] Whisper API failed: %s", exc)
        raise
    finally:
        try:
            os.unlink(merged_path)
        except FileNotFoundError:
            pass


def _transcribe_batch(chunk_paths: list[str], session_type: str) -> tuple[list[dict], str, int]:
    """청크 배치 하나를 병합해 Gemini 로 전사한다.

    반환: (segments(배치 상대 시각), raw_text, 누락 청크 수).
    STT-01: 누락 청크는 건너뛰고 존재하는 청크만 병합하므로 일부 결손이 있어도
    배치 전사 자체는 실패하지 않는다.
    """
    # 0) 누락 청크 분리 — 하나라도 없으면 전사 전체가 실패하던 문제 방지(STT-01)
    existing, missing = _split_existing_chunks(chunk_paths)
    if not existing:
        raise RuntimeError("전사 가능한 청크 없음 — 전부 누락")
    if missing:
        logger.warning("[stt_task] [청크 누락] %d개 건너뜀: %s", len(missing), missing)

    # 1) 존재하는 청크만 병합 → base64
    merged = tempfile.NamedTemporaryFile(suffix=".webm", delete=False)
    merged_path = merged.name
    try:
        with open(merged_path, "wb") as out:
            for path in existing:
                with open(path, "rb") as src:
                    shutil.copyfileobj(src, out)
        with open(merged_path, "rb") as f:
            audio_b64 = base64.b64encode(f.read()).decode("utf-8")
    finally:
        os.unlink(merged_path)

    # 2) 유형별 화자 안내 — 1:1 상담 프레임을 무조건 강제하지 않는다.
    if session_type in ("clinical", "hypnosis"):
        speaker_hint = (
            "이 녹음이 상담사와 내담자 2명의 대화로 명확하면 'counselor'/'client'로 구분하고, "
            "2명인지 불분명하거나 1명이면 모두 'speaker_0'으로 표시하세요. "
        )
    else:
        speaker_hint = "화자 구분 없이 모두 'speaker_0'으로 표시하세요. "

    prompt = (
        "다음 오디오 녹음을 전사하세요. 들리는 말만 정확히 적고, 추측하거나 지어내지 마세요. "
        "말이 아닌 소리(잡음, 무음, 물건 소리, 음악 등)는 [잡음], [무음]처럼 대괄호 마커로 표시하세요. "
        + speaker_hint
        + "다른 말 없이 아래 JSON 배열만 출력하세요:\n"
        '[{"speaker": "speaker_0", "text": "...", "start": 0.0, "end": 1.0}, ...]\n'
        "start/end는 오디오 시작 기준 초(float)로 표기하세요."
    )

    # STT-5TH-01: JSON 응답을 강제(responseMimeType=application/json)해 마크다운/부가 텍스트
    # 혼입으로 인한 파싱 실패(→ 불필요한 Whisper 폴백)를 줄인다. 일시 오류는 backoff 재시도.
    result = _gemini_post_with_retry(
        f"{GEMINI_BASE}/models/{GEMINI_MODEL}:generateContent",
        {"x-goog-api-key": settings.gemini_api_key, "Content-Type": "application/json"},
        {
            "contents": [
                {
                    "parts": [
                        {"text": prompt},
                        {"inline_data": {"mime_type": "audio/webm", "data": audio_b64}},
                    ]
                }
            ],
            "generationConfig": {"responseMimeType": "application/json", "temperature": 0.0},
        },
        GEMINI_TIMEOUT,
    )

    parts = (result.get("candidates") or [{}])[0].get("content", {}).get("parts", [])
    text = "".join(p.get("text", "") for p in parts if isinstance(p, dict))
    if not text.strip():
        raise RuntimeError("Gemini 응답에 텍스트 없음")

    segments = _extract_segments_json(text)
    raw_text = "\n".join(f"[{s['speaker']}] {s['text']}" for s in segments)
    return segments, raw_text, len(missing)


def _call_gemini_transcribe(
    chunk_paths: list[str], session_type: str, audio_duration_sec: float | None = None
) -> dict:
    """Gemini Audio로 STT (발화자 구분은 1:1 유형에서만 유도).

    오디오 청크를 병합해 Gemini에 inline_data로 전달하고, 유형에 맞는
    중립 프롬프트로 전사한다. 상담 대화로 단정하지 않아야 실제 오디오와
    무관한 대화를 지어내는 환각(1:1 상담 프레임 강제)을 막을 수 있다.
    말이 아닌 소리는 [잡음]/[무음] 마커로 표기해 후속 신뢰도 판정에 쓴다.

    SDD-121: 긴 오디오(> GEMINI_SEGMENT_SECONDS)는 세그먼트로 분할해 전사한다.
    단일 요청에 긴 오디오를 통째로 넣으면 타임아웃(180초 초과)이 발생하므로,
    세그먼트별 요청으로 크기·시간을 줄이고 타임스탬프 오프셋을 누적해 병합한다.
    """
    if not settings.gemini_api_key:
        logger.warning("[stt_task] gemini_api_key 미설정")
        raise RuntimeError("gemini_api_key not set")

    # 총 길이 추정 — 녹음 시작/종료 시각이 있으면 정확값, 없으면 청크당 5초로 근사.
    total_duration = audio_duration_sec or (len(chunk_paths) * 5.0)

    if total_duration > GEMINI_SEGMENT_SECONDS and len(chunk_paths) > 1:
        n_segments = max(1, int(math.ceil(total_duration / GEMINI_SEGMENT_SECONDS)))
        per_segment = int(math.ceil(len(chunk_paths) / n_segments))
        # 청크당 길이(초). 오프셋을 '추정 총길이 / n_segments' 로 누적하면 배치별 청크 수가
        # 다를 때(마지막 배치 등) 실제 발화 시각과 어긋난다. STT-01: 실제 배치 청크 수에
        # 청크당 길이를 곱해 누적함으로써 세그먼트 오프셋을 실제 구간 길이에 맞춘다.
        per_chunk_sec = total_duration / len(chunk_paths) if len(chunk_paths) else 0.0
        segments: list[dict] = []
        missing_total = 0
        offset = 0.0
        for i in range(0, len(chunk_paths), per_segment):
            batch = chunk_paths[i : i + per_segment]
            # 배치 청크가 전부 누락이면 API 호출 없이 건너뛰고 시간축만 전진한다.
            if not any(os.path.exists(p) for p in batch):
                missing_total += len(batch)
                logger.warning("[stt_task] [청크 누락] 배치 %d개 전부 누락 — 건너뜀", len(batch))
                offset += len(batch) * per_chunk_sec
                continue
            batch_segments, _, batch_missing = _transcribe_batch(batch, session_type)
            missing_total += batch_missing
            for s in batch_segments:
                s = dict(s)
                s["start"] = round(float(s.get("start", 0.0)) + offset, 2)
                s["end"] = round(float(s.get("end", 0.0)) + offset, 2)
                segments.append(s)
            # 다음 배치 오프셋 = 이번 배치의 실제 구간 길이(청크 수 × 청크당 길이)만큼 전진.
            offset += len(batch) * per_chunk_sec
        raw_text = "\n".join(f"[{s['speaker']}] {s['text']}" for s in segments)
        logger.info(
            "[stt_task] Gemini success(분할 %d): %d segments, %d chars, 누락 %d",
            n_segments, len(segments), len(raw_text), missing_total,
        )
        return {"segments": segments, "raw_text": raw_text, "missing_chunks": missing_total}

    segments, raw_text, missing_chunks = _transcribe_batch(chunk_paths, session_type)
    logger.info("[stt_task] Gemini success: %d segments, %d chars", len(segments), len(raw_text))
    return {"segments": segments, "raw_text": raw_text, "missing_chunks": missing_chunks}


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


# 신뢰도 낮음(비발화·환각) 판정 임계값 — 보수적으로 잡아 정상 세션을 오판하지 않는다.
_NON_SPEECH_RATIO_THRESHOLD = 0.6    # [잡음]/[무음] 등 비언어 마커 세그먼트 비율
_MIN_SPEECH_CHARS_PER_MIN = 30.0     # 분당 최소 발화 문자 수 (한국어 ~300자/분 대비 보수적)
_TIMESTAMP_OVERRUN_RATIO = 1.15      # 세그먼트 끝이 실제 길이의 115% 초과 → 환각
_MIN_AUDIO_SEC_FOR_TIMESTAMP = 10.0  # 이보다 짧으면 타임스탬프 환각 검사를 건너뜀
_MIN_AUDIO_SEC_FOR_DENSITY = 30.0    # 이보다 짧으면 발화 밀도 검사를 건너뜀


def _assess_transcript_confidence(segments: list[dict], audio_duration_sec: float | None) -> str:
    """STT 결과의 신뢰도 판정. 'low'면 AI 요약(분석)을 제공하지 않는다 (SDD-085 G5 확장).

    판정 근거(결정적·보수적):
      1) 타임스탬프 환각 — 세그먼트 끝이 실제 오디오 길이를 크게 초과
      2) 비발화 지배 — [잡음]/[무음] 등 대괄호 마커만 있는 세그먼트가 과반
      3) 발화량 부족 — 분당 발화 문자가 터무니없이 적음

    원본 STT(전사문)는 항상 보존하며, 이 신뢰도는 '요약 제공 여부'에만 사용한다.
    """
    if not segments:
        return "low"

    # 1) 타임스탬프 환각 감지 (오디오 길이를 신뢰할 수 있을 때만)
    if audio_duration_sec and audio_duration_sec >= _MIN_AUDIO_SEC_FOR_TIMESTAMP:
        max_end = max((float(s.get("end", 0) or 0) for s in segments), default=0.0)
        if max_end > audio_duration_sec * _TIMESTAMP_OVERRUN_RATIO:
            return "low"

    # 2) 비발화(비언어 마커) 지배 감지 + 발화 문자 집계
    total = len(segments)
    non_speech = 0
    speech_chars = 0
    for s in segments:
        text = str(s.get("text") or "").strip()
        if re.fullmatch(r"\[[^\]]*\]", text):
            non_speech += 1
        else:
            speech_chars += len(text)

    if total and (non_speech / total) >= _NON_SPEECH_RATIO_THRESHOLD:
        return "low"

    # 3) 발화량 부족
    if audio_duration_sec and audio_duration_sec >= _MIN_AUDIO_SEC_FOR_DENSITY:
        minutes = audio_duration_sec / 60.0
        if speech_chars / minutes < _MIN_SPEECH_CHARS_PER_MIN:
            return "low"

    return "high"


async def _emit_status(session_id: str, status: str, detail: dict | None = None):
    """WebSocket으로 처리 상태 브로드캐스트."""
    try:
        from app.ws.record_namespace import broadcast_record_status
        await broadcast_record_status(session_id, status, detail)
    except Exception:
        logger.warning("[stt_task] WebSocket emit failed: %s", status)


def _emit_report_progress(session_id: str, db: DBSession) -> None:
    """SDD-095: 리포트 생성 진행 상태(`report:progress`) 브로드캐스트.

    프론트 종료 화면 스텝퍼가 STT/요약 구간에서도 '처리 중'을 표시할 수 있게 한다.
    """
    try:
        from app.services import report_progress_service

        report_progress_service.emit_report_progress(session_id, db)
    except Exception:
        logger.warning("[stt_task] report:progress emit failed: %s", session_id)


def _notify_low_confidence(session: Session | None, db: DBSession) -> None:
    """신뢰도 낮음 — 호스트(상담사)에게 AI 리포트 미제공을 통지한다.

    AI 요약(분석)은 제공하지 않지만 원본 전사문은 유지되므로,
    안내 문구에 '전사문은 기록지에서 확인 가능'함을 명시한다.
    """
    if session is None or session.host_id is None:
        return
    try:
        from app.services import notification_service

        notification_service.notify_event(
            "report_low_confidence",
            session.host_id,
            {
                "title": "AI 리포트를 생성할 수 없습니다",
                "body": (
                    f"'{session.title or '세션'}' 세션의 오디오 분석 신뢰도가 낮아 "
                    "AI 자동 요약을 제공하지 않습니다. 녹음 원본 전사문은 기록지에서 확인할 수 있습니다."
                ),
                "extra": notification_service.build_standard_extra(
                    "report_low_confidence", "session", str(session.id),
                ),
            },
            db,
        )
    except Exception:
        logger.warning("[stt_task] 저신뢰 알림 실패: %s", session.id)


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
        _emit_report_progress(session_id, db)
        return

    # 세션 유형(프롬프트 분기) + 호스트(저신뢰 알림 대상) + 오디오 길이(신뢰도 판정)
    session = db.query(Session).filter(Session.id == sid).first()
    session_type = session.type if session else "clinical"
    audio_duration_sec = None
    if record.recording_started_at and record.recording_ended_at:
        audio_duration_sec = (record.recording_ended_at - record.recording_started_at).total_seconds()

    asyncio.run(_emit_status(session_id, "merging"))
    # SDD-095: 세션 종료 → 녹음 저장 완료/STT 진행을 진행 스텝퍼에 반영
    _emit_report_progress(session_id, db)

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
        _emit_report_progress(session_id, db)
        return

    asyncio.run(_emit_status(session_id, "transcribing"))
    _emit_report_progress(session_id, db)
    # STT-5TH-01: Gemini 실패를 일시/영구로 구분한다.
    #   - 일시 오류(backoff 재시도 소진 후): Whisper 폴백(비용 발생) 수행.
    #   - 영구 오류(4xx/응답 계약 위반): 전체 Whisper 재전사(비용 2배) 없이 즉시 실패 처리.
    try:
        result = _call_gemini_transcribe(chunk_paths, session_type, audio_duration_sec)
    except GeminiTransientError as exc:
        logger.exception("[stt_task] Gemini 일시 오류 재시도 소진 — Whisper 폴백: %s", exc)
        try:
            result = _call_whisper(chunk_paths)
        except Exception as exc2:
            # 가짜 stub 전사를 저장하지 않는다(SDD-085 G5 원칙) — 실패로 기록
            logger.exception("[stt_task] Whisper failed — STT 실패 처리: %s", exc2)
            record.status = "failed"
            db.commit()
            asyncio.run(_emit_status(session_id, "failed", {"reason": "stt_failed"}))
            _emit_report_progress(session_id, db)
            return
    except Exception as exc:
        # 영구 오류 — Whisper 재전사는 비용만 2배로 늘리고 결과가 없을 가능성이 높다.
        logger.exception("[stt_task] Gemini 영구 오류 — STT 실패 처리(폴백 생략): %s", exc)
        record.status = "failed"
        db.commit()
        asyncio.run(_emit_status(session_id, "failed", {"reason": "stt_failed"}))
        _emit_report_progress(session_id, db)
        return

    asyncio.run(_emit_status(session_id, "diarizing"))
    segments = result.get("segments", [])
    confidence = _assess_transcript_confidence(segments, audio_duration_sec)

    # STT-01: 누락 청크가 있으면 존재 청크만으로 전사하고 결손 구간을 결과에 표시한다.
    missing_chunks = int(result.get("missing_chunks") or 0)
    raw_text = result.get("raw_text")
    if missing_chunks:
        logger.warning(
            "[stt_task] [청크 누락] %d개 — 존재 청크만으로 전사 완료: %s",
            missing_chunks, session_id,
        )
        note = f"[청크 누락 {missing_chunks}개]"
        raw_text = f"{raw_text}\n{note}" if raw_text else note

    record.transcript = raw_text
    summary = dict(record.ai_summary or {})
    summary["segments"] = segments
    summary["transcript_confidence"] = confidence
    if missing_chunks:
        summary["stt_missing_chunks"] = missing_chunks
    # STT-5TH-03: Whisper 폴백이면 화자분리가 소실됐음을 결과·요약에 기록한다.
    if result.get("diarization_fallback"):
        summary["diarization_fallback"] = True
        summary["diarization_note"] = (
            "Whisper 폴백으로 전사 — 화자 분리(상담사/내담자) 소실, "
            "모든 발화가 speaker_0 로 통합됨"
        )
    record.ai_summary = summary
    db.commit()
    logger.info(
        "[stt_task] STT complete: %d segments, confidence=%s, 누락청크=%d",
        len(segments), confidence, missing_chunks,
    )
    # SDD-095: STT(전사·화자분리) 완료 → 다음 스텝(AI 요약) 진행 표시
    _emit_report_progress(session_id, db)

    # SDD-085 G5 확장: 신뢰도 낮으면 AI 요약(분석)을 제공하지 않고 호스트에게 통지.
    # 원본 STT(전사문)는 위에서 저장했으므로 그대로 유지된다.
    if confidence == "low":
        _notify_low_confidence(session, db)


try:
    from app.core.celery_app import celery_app

    # STT-5TH-04: 미처리 인프라 오류(일시)에 대해 Celery 레벨 재시도를 둔다.
    # report_email_task 와 동일 패턴(autoretry_for + retry_backoff + max_retries).
    @celery_app.task(
        name="tasks.stt",
        autoretry_for=(RuntimeError,),
        retry_backoff=True,
        retry_kwargs={"max_retries": 3},
    )
    def stt_task(session_id: str) -> None:
        from app.core.database import SessionLocal

        db = SessionLocal()
        try:
            run_stt_inline(session_id, db)
        finally:
            db.close()
except Exception:
    pass
