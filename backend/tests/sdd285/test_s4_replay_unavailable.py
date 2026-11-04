"""SDD-285 S4 — 방송 되감기 불가(log_truncated) 반복 차단 (실제 PG + Redis, SDD-246 transport 하네스 재사용)."""
from __future__ import annotations

import logging

from app.services import class_participation_service as cps
from app.services.session_live_state import LiveStateService, ReplayUnavailable
from tests.sdd246.transport.conftest import *  # noqa: F401,F403
from tests.sdd246.transport.conftest import _v2_runtime, make_cmd  # noqa: F401  (autouse 픽스처 재노출)


def _warns(caplog):
    return [r for r in caplog.records if "방송 되감기 불가" in r.getMessage()]


def _hand(maker, world, raised):
    with maker() as s:
        return cps.run_live_command(s, world.member(0), make_cmd(world, "hand.set", {"raised": raised}))


def test_S4_되감기_불가여도_예외없이_워터마크가_전진한다(maker, world, live, monkeypatch, caplog):
    with maker() as s:
        cps.seed_live_state(s, world.session_id)
        cps.publish_pending(s, live, world.session_id, lambda e: None)  # seed 소진
    cps._replay_warned.clear()

    def boom(self, *a, **k):
        raise ReplayUnavailable("log_truncated")

    monkeypatch.setattr(LiveStateService, "replay", boom)
    caplog.set_level(logging.WARNING, logger=cps.__name__)
    o = _hand(maker, world, True); assert o.ack["status"] == "applied", o.ack
    got: list = []
    with maker() as s:
        cps.publish_pending(s, live, world.session_id, got.append)  # 예외가 전파되면 시험 실패
    meta = live.read_meta(world.session_id)
    assert int(live.r.get(live.emitted_key(world.session_id))) == int(meta["applied_revision"])  # 반복 재시도 방지
    assert got == []  # 재방송 생략(snapshot 경로 위임)
    assert len(_warns(caplog)) >= 1


def test_S4_같은_session_aud_dom_경고는_60초에_1회():
    cps._replay_warned.clear()
    r = [cps._warn_replay_unavailable("s1", "host", "speaking", "x", now=t) for t in (0.0, 5.0, 59.9, 60.1)]
    assert r == [True, False, False, True]
    assert cps._warn_replay_unavailable("s1", "host", "device", "x", now=1.0) is True  # dom 이 다르면 별도
    assert cps._warn_replay_unavailable("s2", "host", "speaking", "x", now=1.0) is True  # session 이 다르면 별도


def test_S4_반복_publish에도_경고는_60초_안에_1줄(maker, world, live, monkeypatch, caplog):
    with maker() as s:
        cps.seed_live_state(s, world.session_id)
        cps.publish_pending(s, live, world.session_id, lambda e: None)
    cps._replay_warned.clear()
    monkeypatch.setattr(LiveStateService, "replay", lambda self, *a, **k: (_ for _ in ()).throw(ReplayUnavailable("log_truncated")))
    caplog.set_level(logging.WARNING, logger=cps.__name__)
    for flag in (True, False, True, False, True):
        _hand(maker, world, flag)
        with maker() as s:
            cps.publish_pending(s, live, world.session_id, lambda e: None)
    # 호스트·멤버 audience 별로 (aud,dom) 이 다르므로 키 수만큼만(= 이벤트 수와 무관하게 상한이 있다)
    assert len(_warns(caplog)) <= 4
    assert len(_warns(caplog)) < 5 * 2  # 5회 반복 × audience 수보다 확실히 적다
