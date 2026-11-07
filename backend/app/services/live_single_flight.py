"""SDD-319 — 회차 단위 projection drain / 방송 합류(single-flight).

소켓 프로세스는 metric·device·명령마다 같은 회차의 ``ob.drain`` 과 ``publish_pending`` 을 건별로 직렬 실행해
projector 락 대기(20ms 폴링)와 DB/Redis 왕복이 CPU·지연의 대부분을 차지했다. 한 번의 drain 은 밀린 revision 을
모두 반영하므로 프로세스 안에서는 회차당 하나만 돌리고 나머지는 합류시킨다. 정합성(락·fence·revision 단조)은
기존 ``ob.drain`` 이 그대로 보장한다 — 이 모듈은 호출 횟수만 줄인다.
"""
from __future__ import annotations

import threading
import time
from typing import Any, Callable

_MAX_RERUN = 5  # dirty 재실행 상한(입력이 계속 들어와도 한 호출자가 무한히 붙들리지 않게 — 누락분은 다음 호출/heartbeat self-heal 이 방송)
_RERUN_YIELD_S = 0.005  # 재실행 사이 양보(스레드풀·DB 연결 독점 방지)


class _Waiter:
    """drain 대기자. ``lead`` 가 True 로 깨워지면 다음 leader 가 되어 직접 실행한다(handoff)."""
    __slots__ = ("need", "event", "result", "error", "lead")

    def __init__(self, need: int) -> None:
        self.need = need
        self.event = threading.Event()
        self.result: Any = None
        self.error: BaseException | None = None
        self.lead = False


_lock = threading.Lock()
_pub_running: dict[Any, bool] = {}
_pub_dirty: dict[Any, bool] = {}
_drain_running: dict[Any, bool] = {}
_drain_waiters: dict[Any, list[_Waiter]] = {}
stats = {"publish_runs": 0, "publish_coalesced": 0, "drain_runs": 0, "drain_shared": 0, "drain_fallback": 0,
         "drain_handoff": 0, "drain_timeout": 0, "drain_skipped": 0}


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
            time.sleep(_RERUN_YIELD_S)
        else:  # 상한 도달: dirty 가 남았어도 다음 호출/heartbeat 가 이어서 방송한다
            pass
    finally:
        with _lock:
            _pub_running.pop(key, None)
            _pub_dirty.pop(key, None)
    return result


def coalesced_drain(key: Any, do_drain: Callable[[], Any], need_revision: int, *, wait_s: float = 2.0,
                    before_wait: Callable[[], None] | None = None) -> Any:
    """회차당 drain 을 하나만 돌리고, 나머지는 대기열에 등록해 결과를 공유하거나 leader 를 이어받는다(handoff).

    - ``need_revision > 0``(명령): 자기 revision 까지 반영된 결과를 받을 때까지 대기. leader 가 끝났는데 자기 revision 에
      못 미쳤으면(leader 시작 뒤에 commit) **폴백 직접 실행이 아니라 다음 leader 로 지명**되어 한 번 더 돈다 → 이중 대기·락 경합 없음.
    - ``need_revision == 0``(방송 경로): 이미 drain 이 돌고 있으면 기다리지 않고 건너뛴다(그 drain 과 다음 방송이 반영).
    - 대기가 ``wait_s`` 를 넘으면 ``busy`` 결과를 돌려준다(호출자가 projection_pending 으로 처리, 클라이언트 재시도).
    - ``before_wait``: 대기 전에 호출(DB 연결 반납 — 대기자가 풀을 쥐고 leader 의 연결 획득을 막는 것을 방지).
    결과 객체는 ``ob.DrainResult`` 모양(``busy``, ``applied_revision``)을 가정한다.
    """
    me = _Waiter(need_revision)
    with _lock:
        if _drain_running.get(key):
            if need_revision <= 0:
                stats["drain_skipped"] += 1
                return _busy_result("publish_skip")
            _drain_waiters.setdefault(key, []).append(me)
            leader = False
        else:
            _drain_running[key] = True
            leader = True
    if not leader:
        if before_wait is not None:
            try:
                before_wait()
            except Exception:  # noqa: BLE001 — 반납 실패는 대기에 영향 없음
                pass
        deadline = time.monotonic() + wait_s
        while True:
            if me.event.wait(timeout=max(0.0, deadline - time.monotonic())):
                if me.lead:
                    stats["drain_handoff"] += 1
                    break  # 이어받음 — 아래에서 leader 로 실행
                if me.error is not None:
                    raise me.error
                stats["drain_shared"] += 1
                return me.result
            with _lock:  # 대기 시한 초과
                if me.event.is_set():
                    continue
                ws = _drain_waiters.get(key)
                if ws is not None and me in ws:
                    ws.remove(me)
                stats["drain_timeout"] += 1
            return _busy_result("single_flight_wait")
    return _lead(key, do_drain, me)


def _busy_result(reason: str = "unknown") -> Any:
    from app.services import session_live_outbox as ob

    return ob.DrainResult(busy=True, wait_reason=reason)


def _lead(key: Any, do_drain: Callable[[], Any], me: _Waiter) -> Any:
    res: Any = None
    err: BaseException | None = None
    try:
        stats["drain_runs"] += 1
        res = do_drain()
    except BaseException as exc:  # noqa: BLE001 — 호출자에게 그대로 전파(대기자는 다음 leader 가 처리)
        err = exc
    finally:
        with _lock:
            ws = _drain_waiters.get(key) or []
            ok = err is None and not getattr(res, "busy", False)
            applied = int(getattr(res, "applied_revision", 0)) if ok else -1
            # 이번 drain 으로 충분한 대기자는 결과 공유, 나머지는 남겨 다음 leader 가 처리
            rest: list[_Waiter] = []
            for w in ws:
                if ok and w.need <= applied:
                    w.result = res
                    w.event.set()
                else:
                    rest.append(w)
            nxt = None
            if rest:
                rest.sort(key=lambda w: -w.need)  # revision 이 큰(최신 commit) 명령을 먼저 — 한 번에 나머지도 덮는다
                nxt = rest.pop(0)
                nxt.lead = True
                _drain_waiters[key] = rest
                # _drain_running 은 True 유지(leader 자리를 넘김)
            else:
                _drain_waiters.pop(key, None)
                _drain_running.pop(key, None)
        if nxt is not None:
            nxt.event.set()
    if err is not None:
        raise err
    return res
