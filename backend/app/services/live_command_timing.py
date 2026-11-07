"""SDD-319: 명령 지연 원인 계측. 회차·명령 종류별 10초 집계, payload/인증값 기록 없음."""
from __future__ import annotations

import logging
import threading
import time
from collections import Counter
from dataclasses import dataclass, field

_log = logging.getLogger(__name__)
_lock = threading.Lock()
_INTERVAL_S = 10.0


@dataclass
class _Window:
    started: float
    count: int = 0
    reasons: Counter[str] = field(default_factory=Counter)
    maxima: dict[str, float] = field(default_factory=dict)


_windows: dict[tuple[str, str], _Window] = {}


def observe(session_id, kind: str, reason: str, timings: dict[str, float], *, now: float | None = None) -> None:
    """완료된 명령만 집계한다. 마지막 미완료 집계 구간은 다음 요청이 올 때 출력한다."""
    stamp = time.monotonic() if now is None else now
    key = (str(session_id), kind)
    with _lock:
        if key not in _windows and len(_windows) >= 5000:
            _windows.clear()  # 종료된 회차 자료를 무제한 보유하지 않는다(계측은 best-effort).
        window = _windows.setdefault(key, _Window(stamp))
        window.count += 1
        window.reasons[reason] += 1
        for phase, elapsed in timings.items():
            window.maxima[phase] = max(window.maxima.get(phase, 0.0), round(elapsed, 3))
        if stamp - window.started < _INTERVAL_S:
            return
        _windows[key] = _Window(stamp)
    _log.info('[live-v2] live_command_timing session=%s kind=%s count=%s reasons=%s max_ms=%s',
              key[0][:8], kind, window.count, dict(window.reasons), window.maxima)
