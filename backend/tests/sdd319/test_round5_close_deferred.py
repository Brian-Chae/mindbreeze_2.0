"""SDD-319 round-5 — capture.close 비차단 ACK + 회차당 1개 따라잡기 러너 단위 시험."""
from __future__ import annotations

import threading
import time
from types import SimpleNamespace

from app.services import live_projection_follower as lpf


def _wait(cond, t=3.0):
    end = time.monotonic() + t
    while time.monotonic() < end:
        if cond():
            return True
        time.sleep(0.01)
    return False


def test_러너는_목표_도달까지_반복하고_정리한다():
    calls = []

    def step(target):
        calls.append(target)
        return len(calls) >= 3  # 앞 2회 busy

    assert lpf.request("s-a", 7, step) is True
    assert _wait(lambda: len(calls) >= 3 and "s-a" not in lpf._targets)
    assert calls == [7, 7, 7]


def test_동시_요청은_러너_1개로_병합되고_최대_목표를_따라간다():
    gate = threading.Event()
    seen = []

    def step(target):
        seen.append(target)
        gate.wait(1)
        return True

    assert lpf.request("s-b", 5, step) is True
    time.sleep(0.05)
    for r in (6, 9, 8):
        assert lpf.request("s-b", r, step) is False  # 러너 추가 없음
    gate.set()
    assert _wait(lambda: "s-b" not in lpf._targets)
    assert seen[0] == 5 and seen[-1] == 9  # 실행 중 병합된 최대 목표까지 한 번 더


def test_step_예외_후에도_계속한다():
    n = []

    def step(target):
        n.append(1)
        if len(n) < 3:
            raise RuntimeError("boom")
        return True

    lpf.request("s-c", 2, step)
    assert _wait(lambda: len(n) >= 3 and "s-c" not in lpf._targets)


def test_상한_초과시_포기하고_정리한다(monkeypatch):
    monkeypatch.setattr(lpf, "MAX_FOLLOW_S", 0.05)
    lpf.request("s-d", 1, lambda t: False)
    assert _wait(lambda: "s-d" not in lpf._targets)
    assert lpf.stats["gave_up"] >= 1


def test_close_ACK는_drain_대기_없이_반환하고_deferred_revision을_돌려준다(monkeypatch):
    from app.services import class_participation_service as cps
    import inspect

    src = inspect.getsource(cps.run_live_command)
    assert "defer_close_projection" in src and "deferred_revision" in src
    # 기본값(REST 등)은 기존 동작: 지연 없음
    assert inspect.signature(cps.run_live_command).parameters["defer_close_projection"].default is False
    assert cps.RunOutcome(ack={}).deferred_revision is None
