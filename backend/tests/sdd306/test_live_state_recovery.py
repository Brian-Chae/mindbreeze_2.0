"""SDD-306 — 소켓 연결 상태머신: 일시 지연(projection_pending)이 연결을 영구 DEGRADED 로 만들지 않는다.

11/5 dev 40명 시험에서 capture.renew 의 projection_pending(committed 일시 지연) 때문에 연결이 DEGRADED 가 되고,
서버에 DEGRADED→READY 복귀 경로가 없어 이후 metric 의 52% 가 not_ready 로 거절됐다.
"""
from __future__ import annotations

from types import SimpleNamespace

from app.ws import session_live_namespace as ns


def _outcome(code=None, degraded=True):
    return SimpleNamespace(degraded=degraded, ack={"code": code} if code else {})


def test_V1_projection_pending_은_READY_를_유지한다():
    assert ns.state_after_command("READY", _outcome("projection_pending")) == "READY"


def test_V2_live_unavailable_은_DEGRADED_로_전환한다():
    assert ns.state_after_command("READY", _outcome("live_unavailable")) == "DEGRADED"


def test_V2b_degraded_아님이면_상태_유지():
    for st in ("READY", "RESYNCING", "DEGRADED", "REVOKED"):
        assert ns.state_after_command(st, _outcome(None, degraded=False)) == st


def test_V2c_코드가_없는_degraded_는_보수적으로_DEGRADED():
    assert ns.state_after_command("READY", _outcome(None, degraded=True)) == "DEGRADED"


def test_V3_DEGRADED_에서_heartbeat_성공이면_재동기화를_요청한다():
    assert ns.heartbeat_needs_resync("DEGRADED") is True
    for st in ("READY", "RESYNCING", "CONNECTING", "REVOKED", "TERMINAL"):
        assert ns.heartbeat_needs_resync(st) is False


def test_V4_READY_가_아닌_연결의_metric_은_여전히_거절된다():
    import asyncio
    import inspect

    src = inspect.getsource(ns)
    # 게이트 완화 금지: _ingest 는 READY 만 통과시킨다
    assert 'conn.state != "READY"' in src
    assert asyncio.iscoroutinefunction(ns.register_session_live_namespace) is False
