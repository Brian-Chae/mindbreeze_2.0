"""SDD-319 — 회차 단위 drain/방송 합류(single-flight) 단위 시험."""
from __future__ import annotations

import threading
import time
from types import SimpleNamespace

from app.services import live_single_flight as sf


def _res(rev, busy=False):
    return SimpleNamespace(applied_revision=rev, busy=busy)


def test_S4_publish_동시_호출은_하나만_실행하고_누락없이_재실행한다():
    running, peak, runs = 0, 0, []
    lock = threading.Lock()
    gate = threading.Event()

    def fn():
        nonlocal running, peak
        with lock:
            running += 1
            peak = max(peak, running)
        runs.append(time.monotonic())
        if len(runs) == 1:
            gate.wait(1)  # 첫 실행 중에 나머지 호출이 몰리게 한다
        with lock:
            running -= 1
        return len(runs)

    ts = [threading.Thread(target=sf.run_coalesced, args=(("p", "k1"), fn)) for _ in range(10)]
    ts[0].start()
    time.sleep(0.1)
    for t in ts[1:]:
        t.start()
    time.sleep(0.1)
    gate.set()
    for t in ts:
        t.join(3)
    assert peak == 1, "동시 실행은 1개"
    assert len(runs) == 2, "합류 호출은 실행자가 정확히 한 번 더 실행해 반영(누락 0, 폭주 0)"


def test_S4_합류_뒤에도_실행중_플래그가_정리된다():
    n = []
    sf.run_coalesced(("p", "k2"), lambda: n.append(1))
    sf.run_coalesced(("p", "k2"), lambda: n.append(1))
    assert len(n) == 2


def test_S1_drain_followers는_leader_결과를_공유한다():
    calls = []
    gate = threading.Event()

    def do():
        calls.append(1)
        gate.wait(1)
        return _res(10)

    out = []
    ts = [threading.Thread(target=lambda: out.append(sf.coalesced_drain(("d", "a"), do, 5, wait_s=2))) for _ in range(8)]
    ts[0].start()
    time.sleep(0.1)
    for t in ts[1:]:
        t.start()
    time.sleep(0.1)
    gate.set()
    for t in ts:
        t.join(3)
    assert len(calls) == 1 and len(out) == 8
    assert all(o.applied_revision == 10 for o in out)


def test_S5_leader가_필요한_revision에_못미치면_follower가_직접_drain한다():
    calls = []
    gate = threading.Event()

    def leader():
        calls.append("L")
        gate.wait(1)
        return _res(3)

    def follower():
        calls.append("F")
        return _res(9)

    got = {}
    t1 = threading.Thread(target=lambda: got.setdefault("l", sf.coalesced_drain(("d", "b"), leader, 1)))
    t1.start()
    time.sleep(0.1)
    t2 = threading.Thread(target=lambda: got.setdefault("f", sf.coalesced_drain(("d", "b"), follower, 9, wait_s=2)))
    t2.start()
    time.sleep(0.1)
    gate.set()
    t1.join(3)
    t2.join(3)
    assert got["f"].applied_revision == 9 and calls == ["L", "F"]


def test_S5_leader가_예외면_follower는_직접_실행하고_leader에는_예외가_전파된다():
    gate = threading.Event()

    def bad():
        gate.wait(1)
        raise RuntimeError("boom")

    err = []

    def run_leader():
        try:
            sf.coalesced_drain(("d", "c"), bad, 1)
        except RuntimeError as e:
            err.append(e)

    t1 = threading.Thread(target=run_leader)
    t1.start()
    time.sleep(0.1)
    got = []
    t2 = threading.Thread(target=lambda: got.append(sf.coalesced_drain(("d", "c"), lambda: _res(4), 4, wait_s=2)))
    t2.start()
    time.sleep(0.1)
    gate.set()
    t1.join(3)
    t2.join(3)
    assert err and got and got[0].applied_revision == 4


def test_leader가_busy를_돌려주면_공유하지_않는다():
    gate = threading.Event()

    def leader():
        gate.wait(1)
        return _res(10, busy=True)

    t1 = threading.Thread(target=lambda: sf.coalesced_drain(("d", "e"), leader, 1))
    t1.start()
    time.sleep(0.1)
    got = []
    t2 = threading.Thread(target=lambda: got.append(sf.coalesced_drain(("d", "e"), lambda: _res(10), 1, wait_s=2)))
    t2.start()
    time.sleep(0.1)
    gate.set()
    t1.join(3)
    t2.join(3)
    assert got[0].busy is False
