"""SDD-285 S9 — stream 미고정 / 입구 거절 capture.* 로그 (로그 전용, 동작 변경 없음).

11/4 비교에서 갈린 지점: "첫 capture.start 가 적용됐지만 시계 기준 고정(anchor)이 안 된 채 열린 뒤, 재시작/재고정이 서버에 도달했는가".
- (a) 연결별로 capture.start 적용 시각을 기록하고, N초(기본 45) 안에 `capture.reanchor`/`capture.renew` 가 적용되지 않으면
  `[capture-unanchored]` 경고를 시작 1건당 1회 남긴다. 기존 5초 heartbeat 루프에서 점검한다(새 스케줄러 없음).
- (b) 입구 검사(token_expired·access_revoked·not_ready 등)에서 거절된 `capture.*` 는 원장에 남지 않으므로 `[capture-gate-reject]` 로 사유·종류를 남긴다.
참여행 ID 는 앞 6자리만 남긴다. 모든 함수는 예외를 삼킨다(로그가 명령 처리를 막지 않는다).
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

UNANCHORED_AFTER_S = 45.0
_ANCHOR_KINDS = ("capture.reanchor", "capture.renew")


def _short(value) -> str:
    return str(value or "")[:6]


@dataclass
class AnchorWatch:
    """연결 1개의 미고정 감시 상태. started_at 이 None 이면 감시할 start 가 없다."""

    started_at: float | None = None
    stream_short: str = ""
    warned: bool = False
    starts: int = 0
    pending: dict = field(default_factory=dict)


def note_result(watch: AnchorWatch, kind: str, ack: dict, *, now: float | None = None) -> None:
    """명령 처리 결과(ACK)를 반영한다. 적용된(applied, 중복 제외 포함) capture.start 는 감시 시작, reanchor/renew 적용은 감시 해제."""
    try:
        t = time.monotonic() if now is None else now
        if ack.get("status") not in ("applied", "duplicate") or not ack.get("committed", False):
            return
        if kind == "capture.start":
            if ack.get("status") == "duplicate" and watch.started_at is not None:
                return  # 같은 start 의 재전송은 시계를 다시 시작하지 않는다
            res = ack.get("result") or {}
            watch.started_at, watch.warned, watch.starts = t, False, watch.starts + 1
            watch.stream_short = _short(res.get("stream_id"))
        elif kind in _ANCHOR_KINDS:
            watch.started_at = None
    except Exception:  # noqa: BLE001
        pass


def check(watch: AnchorWatch, participant_id, *, now: float | None = None, after_s: float = UNANCHORED_AFTER_S) -> bool:
    """heartbeat 마다 호출. 미고정 경고를 냈으면 True(시작 1건당 1회)."""
    try:
        if watch.started_at is None or watch.warned:
            return False
        t = time.monotonic() if now is None else now
        elapsed = t - watch.started_at
        if elapsed < after_s:
            return False
        watch.warned = True
        logger.warning("[capture-unanchored] participant=%s stream=%s elapsed=%.0fs — capture.start 후 reanchor/renew 없음 (start 누적 %d회)",
                       _short(participant_id), watch.stream_short or "-", elapsed, watch.starts)
        return True
    except Exception:  # noqa: BLE001
        return False


def log_gate_reject(participant_id, kind: str, code: str, state: str | None = None) -> None:
    """입구 검사 거절된 capture.* 를 남긴다(원장에 없는 거절이라 이 줄이 유일한 흔적)."""
    try:
        if not str(kind).startswith("capture."):
            return
        logger.warning("[capture-gate-reject] participant=%s kind=%s code=%s state=%s", _short(participant_id), kind, code, state or "-")
    except Exception:  # noqa: BLE001
        pass
