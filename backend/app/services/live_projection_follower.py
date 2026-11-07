"""SDD-319 round-5 — commit 이후 projection·방송을 ACK 와 분리해 회차당 1개 러너가 따라잡는다.

capture.close 는 100명이 동시에 보내면 ACK 앞의 single-flight 대기(wait_s)를 넘겨 projection_pending 이 된다.
명령은 이미 commit(outbox 기록)됐으므로 ACK 를 drain 완료에 묶지 않고, 목표 revision 만 등록한다.
러너는 목표(병합 최대값)에 도달할 때까지 ``step`` (drain→방송)을 반복한다. 정합성(락·fence·revision 단조)은
기존 ``ob.drain``/``publish_pending`` 이 보장하고, 이 모듈은 호출 시점만 바꾼다. 상한을 넘기면 heartbeat self-heal 이 방송한다.
"""
from __future__ import annotations

import logging
import threading
import time
from typing import Callable

_log = logging.getLogger(__name__)

MAX_FOLLOW_S = 60.0
_BACKOFF_S = (0.02, 0.05, 0.1, 0.2, 0.5)

_lock = threading.Lock()
_targets: dict[str, int] = {}  # 실행 중인 회차 → 목표 revision(최대값 병합)
stats = {"requests": 0, "runners": 0, "steps": 0, "gave_up": 0}


def request(session_id, revision: int, step: Callable[[int], bool]) -> bool:
    """목표 revision 등록. 러너가 없으면 시작(True), 있으면 병합만(False).

    ``step(target)``: 목표까지 drain 하고 방송한 뒤 목표 도달 여부(bool)를 돌려준다. 예외는 재시도한다.
    """
    key = str(session_id)
    with _lock:
        stats["requests"] += 1
        if key in _targets:
            _targets[key] = max(_targets[key], int(revision))
            return False
        _targets[key] = int(revision)
        stats["runners"] += 1
    threading.Thread(target=_run, args=(key, step), name=f"live-follow-{key[:8]}", daemon=True).start()
    return True


def _run(key: str, step: Callable[[int], bool]) -> None:
    deadline = time.monotonic() + MAX_FOLLOW_S
    attempt = 0
    try:
        while True:
            with _lock:
                target = _targets.get(key, 0)
            done = False
            try:
                stats["steps"] += 1
                done = bool(step(target))
            except Exception:  # noqa: BLE001 — 따라잡기는 best-effort, 상태는 이미 commit
                _log.warning("[live-v2] projection 따라잡기 실패(재시도)", exc_info=True)
            if done:
                attempt = 0
                with _lock:
                    if _targets.get(key, 0) <= target:
                        _targets.pop(key, None)
                        return
                continue  # 실행 중 더 큰 목표가 병합됨
            if time.monotonic() > deadline:
                stats["gave_up"] += 1
                _log.warning("[live-v2] projection 따라잡기 상한 초과 session=%s — heartbeat self-heal 에 맡김", key[:8])
                with _lock:
                    _targets.pop(key, None)
                return
            time.sleep(_BACKOFF_S[min(attempt, len(_BACKOFF_S) - 1)])
            attempt += 1
    except BaseException:  # noqa: BLE001 — 러너가 비정상 종료해도 다음 요청이 새 러너를 띄울 수 있게 정리
        with _lock:
            _targets.pop(key, None)
        raise
