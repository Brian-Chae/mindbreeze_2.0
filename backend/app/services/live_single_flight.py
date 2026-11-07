"""SDD-319 — 회차 단위 projection drain / 방송 합류(single-flight).

소켓 프로세스는 metric·device·명령마다 같은 회차의 ``ob.drain`` 과 ``publish_pending`` 을 건별로 직렬 실행해
projector 락 대기(20ms 폴링)와 DB/Redis 왕복이 CPU·지연의 대부분을 차지했다. 한 번의 drain 은 밀린 revision 을
모두 반영하므로 프로세스 안에서는 회차당 하나만 돌리고 나머지는 합류시킨다. 정합성(락·fence·revision 단조)은
기존 ``ob.drain`` 이 그대로 보장한다 — 이 모듈은 호출 횟수만 줄인다.
"""
from __future__ import annotations

import threading
from typing import Any, Callable

_MAX_RERUN = 20  # dirty 재실행 상한(입력이 계속 들어와도 한 호출자가 무한히 붙들리지 않게)


class _Flight:
    __slots__ = ("done", "result", "error")

    def __init__(self) -> None:
        self.done = threading.Event()
        self.result: Any = None
        self.error: BaseException | None = None


_lock = threading.Lock()
_pub_running: dict[Any, bool] = {}
_pub_dirty: dict[Any, bool] = {}
_drain_flight: dict[Any, _Flight] = {}
stats = {"publish_runs": 0, "publish_coalesced": 0, "drain_runs": 0, "drain_shared": 0, "drain_fallback": 0}


def run_coalesced(key: Any, fn: Callable[[], Any]) -> Any:
    """같은 key 로 실행 중이면 dirty 만 표시하고 즉시 반환(None). 실행자는 끝난 뒤 dirty 면 한 번 더 실행한다.

    반환: 실행자는 마지막 실행의 결과, 합류한 호출자는 None. 합류 호출이 요청한 변경은 실행자의 재실행이 반드시 반영한다.
    """
    with _lock:
        if _pub_running.get(key):
            _pub_dirty[key] = True
            stats["publish_coalesced"] += 1
            return None
        _pub_running[key] = True
        _pub_dirty[key] = False
    result = None
    try:
        for _ in range(_MAX_RERUN):
            stats["publish_runs"] += 1
            result = fn()
            with _lock:
                if not _pub_dirty.get(key):
                    break
                _pub_dirty[key] = False
        else:  # 상한 도달: dirty 가 남았어도 다음 호출/heartbeat 가 이어서 방송한다
            pass
    finally:
        with _lock:
            _pub_running.pop(key, None)
            _pub_dirty.pop(key, None)
    return result


def coalesced_drain(key: Any, do_drain: Callable[[], Any], need_revision: int, *, wait_s: float = 2.0) -> Any:
    """진행 중인 drain 이 있으면 끝날 때까지 기다려 결과를 공유한다.

    공유 조건: leader 가 예외 없이 끝났고, busy 가 아니며, ``applied_revision >= need_revision``.
    아니면 직접 ``do_drain`` 을 실행한다(폴백 — 새 leader). 결과 객체는 ``ob.DrainResult`` 모양
    (``busy``, ``applied_revision``)을 가정한다.
    """
    with _lock:
        flight = _drain_flight.get(key)
        leader = flight is None
        if leader:
            flight = _Flight()
            _drain_flight[key] = flight
    if not leader:
        if flight.done.wait(timeout=wait_s) and flight.error is None:
            res = flight.result
            if res is not None and not getattr(res, "busy", False) and int(getattr(res, "applied_revision", 0)) >= need_revision:
                stats["drain_shared"] += 1
                return res
        # leader 가 이 revision 까지 못 갔거나 실패/지연 — 직접 실행(잇따라 새 leader 가 될 수 있다)
        stats["drain_fallback"] += 1
        return coalesced_drain_direct(key, do_drain)
    return _lead(key, flight, do_drain)


def coalesced_drain_direct(key: Any, do_drain: Callable[[], Any]) -> Any:
    """폴백: leader 슬롯이 비어 있으면 leader 가 되고, 아니면 슬롯 없이 그냥 실행(락 경합은 ob.drain 이 처리)."""
    with _lock:
        flight = _drain_flight.get(key)
        if flight is None:
            flight = _Flight()
            _drain_flight[key] = flight
            lead = True
        else:
            lead = False
    if lead:
        return _lead(key, flight, do_drain)
    stats["drain_runs"] += 1
    return do_drain()


def _lead(key: Any, flight: _Flight, do_drain: Callable[[], Any]) -> Any:
    try:
        stats["drain_runs"] += 1
        flight.result = do_drain()
        return flight.result
    except BaseException as exc:  # noqa: BLE001 — follower 에 실패를 알리고 호출자에게 그대로 전파
        flight.error = exc
        raise
    finally:
        with _lock:
            if _drain_flight.get(key) is flight:
                _drain_flight.pop(key, None)
        flight.done.set()
