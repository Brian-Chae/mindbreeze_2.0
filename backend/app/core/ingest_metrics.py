"""SDD-260 S7 — 저장 경로 계측(프로세스 내 카운터 · Prometheus 미사용).

REST 배치 접수 건수·창별 결과/거절 코드·처리 ms 분포, DB 풀 상태, 스레드풀 대기를 모아 두고
`GET /api/v1/admin/ingest-metrics`(platform_admin) 와 배치당 구조화 로그(`[ingest-batch]`)로 노출한다.
개인정보·payload 는 담지 않는다(건수·ms 만).
"""
from __future__ import annotations

import threading
import time
from collections import Counter

_lock = threading.Lock()
_started = time.time()
_batches = 0
_windows = Counter()   # accepted|duplicate|rejected
_codes = Counter()     # rejected 코드별
_errors = 0            # 요청 전체 실패(5xx 등)
_ms: list[float] = []  # 최근 배치 처리 ms (링 버퍼)
_MS_KEEP = 2000


def record_batch(results: list[dict], elapsed_ms: float) -> None:
    global _batches
    with _lock:
        _batches += 1
        for r in results:
            _windows[r["status"]] += 1
            if r["status"] == "rejected":
                _codes[r.get("code", "unknown")] += 1
        _ms.append(elapsed_ms)
        if len(_ms) > _MS_KEEP:
            del _ms[: len(_ms) - _MS_KEEP]


def record_error() -> None:
    global _errors
    with _lock:
        _errors += 1


def _pct(vals: list[float], p: float) -> float | None:
    if not vals:
        return None
    s = sorted(vals)
    return round(s[min(len(s) - 1, int(len(s) * p))], 1)


def snapshot() -> dict:
    from app.core.database import engine

    with _lock:
        ms = list(_ms)
        out = {
            "uptime_s": int(time.time() - _started), "batches": _batches, "windows": dict(_windows),
            "rejected_codes": dict(_codes), "errors": _errors,
            "batch_ms": {"count": len(ms), "p50": _pct(ms, 0.5), "p95": _pct(ms, 0.95), "max": round(max(ms), 1) if ms else None},
        }
    pool = getattr(engine, "pool", None)
    try:
        out["db_pool"] = {"size": pool.size(), "checked_out": pool.checkedout(), "overflow": pool.overflow()}
    except Exception:  # noqa: BLE001 — SQLite 등 풀 통계가 없는 환경
        out["db_pool"] = None
    try:
        import anyio.to_thread

        lim = anyio.to_thread.current_default_thread_limiter()
        out["anyio_threads"] = {"tokens": lim.total_tokens, "borrowed": lim.borrowed_tokens}
    except Exception:  # noqa: BLE001 — 이벤트 루프 밖
        out["anyio_threads"] = None
    return out


def reset() -> None:  # 시험용
    global _batches, _errors
    with _lock:
        _batches = _errors = 0
        _windows.clear()
        _codes.clear()
        _ms.clear()
