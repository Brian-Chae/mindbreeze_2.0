"""SDD-285 S3 — 업로드 신호 로그(동작 변경 없음, 로그 전용).

- `[raw-ack]`: biosignal-raw/ack 수신 1줄.
- `[upload-no-stream]`: 업로드(features/batch·raw ack)가 오는데 그 참가자의 capture_stream 이 하나도 없을 때의 경고.
  11/4 실패군은 "업로드는 되는데 stream 이 서버에 없거나 고정 안 됨" 상태였다 — 운영에서 이 줄 하나로 바로 찾는다.
  참가자 ID 는 앞 6자리만 남긴다. 같은 (session, participant) 는 60초에 1회만 경고한다(요청 폭주 방지).
- 로그 실패가 업로드를 막지 않는다(모든 예외 삼킴).
"""

from __future__ import annotations

import logging
import threading
import time
import uuid

from sqlalchemy import func, select

logger = logging.getLogger(__name__)

WARN_INTERVAL_S = 60.0
_MAX_KEYS = 5000
_last_warn: dict[tuple[str, str], float] = {}
_lock = threading.Lock()


def short_id(value) -> str:
    return str(value or "")[:6]


def _should_warn(session_id, participant_id, now: float) -> bool:
    key = (str(session_id), str(participant_id))
    with _lock:
        last = _last_warn.get(key)
        if last is not None and now - last < WARN_INTERVAL_S:
            return False
        if len(_last_warn) >= _MAX_KEYS:
            _last_warn.clear()
        _last_warn[key] = now
        return True


def reset_for_tests() -> None:
    with _lock:
        _last_warn.clear()


def warn_if_no_stream(db, session_id, participant_id, source: str, *, now: float | None = None) -> bool:
    """참가자의 capture_stream 이 0개면 경고 1줄(60초 억제). 경고를 냈으면 True."""
    try:
        t = time.monotonic() if now is None else now
        # 억제 구간이면 DB 조회도 하지 않는다(요청당 추가 쿼리 최소화).
        key = (str(session_id), str(participant_id))
        with _lock:
            last = _last_warn.get(key)
        if last is not None and t - last < WARN_INTERVAL_S:
            return False
        from app.models.live_state import CaptureStream

        n = db.execute(select(func.count()).select_from(CaptureStream).where(
            CaptureStream.session_id == uuid.UUID(str(session_id)),
            CaptureStream.participant_id == uuid.UUID(str(participant_id)))).scalar_one()
        if n:
            return False
        if not _should_warn(session_id, participant_id, t):
            return False
        logger.warning("[upload-no-stream] source=%s session=%s participant=%s — 업로드는 오는데 서버에 capture_stream 이 없다",
                       source, short_id(session_id), short_id(participant_id))
        return True
    except Exception:  # noqa: BLE001 — 로그 전용
        logger.debug("[upload-no-stream] 점검 실패", exc_info=True)
        return False


def _count(resp, key: str) -> int:
    v = resp.get(key) if isinstance(resp, dict) else getattr(resp, key, None)
    return int(v or 0)


def log_raw_ack(db, session_id, participant_id, resp, *, chunks: int, ms: float) -> None:
    """participant_id 가 요청에 없으면(서버가 인증 문맥에서 확정) 응답 청크 조회 없이 경고는 생략한다."""
    try:
        logger.info("[raw-ack] session=%s participant=%s chunks=%d acked=%d failed=%d ms=%.0f",
                    short_id(session_id), short_id(participant_id) or "-", chunks, _count(resp, "acked"),
                    _count(resp, "failed"), ms)
        if participant_id:
            warn_if_no_stream(db, session_id, participant_id, "raw-ack")
    except Exception:  # noqa: BLE001
        pass
