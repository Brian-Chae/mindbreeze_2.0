"""SDD-308 ③ 입장·join 교착 재시도 — 최대 3회, 50~150ms 지터, 롤백 후 재실행, 부작용 중복 0."""
from __future__ import annotations

import logging
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
import sqlalchemy as sa
from fastapi import HTTPException
from sqlalchemy.exc import OperationalError

from app.models.session import SessionParticipant
from app.services import class_participation_service as cps
from app.services import session_service
from tests.sdd308.helpers import build_scene


class _PgErr(Exception):
    def __init__(self, pgcode):
        super().__init__("deadlock detected")
        self.pgcode = pgcode


def _deadlock():
    return OperationalError("stmt", {}, _PgErr("40P01"))


@pytest.fixture(autouse=True)
def _quiet(monkeypatch):
    monkeypatch.setattr(session_service, "_notify_participant_changed", lambda *a, **k: None)
    monkeypatch.setattr(session_service, "_notify_promoted", lambda *a, **k: None)
    sleeps: list[float] = []
    monkeypatch.setattr(session_service.time, "sleep", lambda s: sleeps.append(s))
    return sleeps


def _enter(maker, sc, i=0):
    uid, _ = sc.members[i]
    with maker() as db:
        return session_service.enter_session_as_invited(
            str(sc.session_id), str(uid), db, recording_consent=True, recording_notice_version="rec-1")


def _rows(maker, sc):
    with maker() as s:
        return s.scalar(sa.select(sa.func.count()).select_from(SessionParticipant).where(SessionParticipant.session_id == sc.session_id))


def _flaky_lock(monkeypatch, times):
    real = session_service._lock_session_for_capacity
    calls = {"n": 0}

    def flaky(s_id, db):
        calls["n"] += 1
        if calls["n"] <= times:
            raise _deadlock()
        return real(s_id, db)

    monkeypatch.setattr(session_service, "_lock_session_for_capacity", flaky)
    return calls


def test_V31_교착_두번_뒤_성공_행_하나_로그(maker, monkeypatch, caplog, _quiet):
    sc = build_scene(maker, 3)
    calls = _flaky_lock(monkeypatch, 2)
    with caplog.at_level(logging.INFO):
        res = _enter(maker, sc)
    assert res["participant_id"] and calls["n"] == 3
    assert _rows(maker, sc) == 3  # 사전 등록 3명 그대로 — 중복 행 없음
    assert any("lock_retry=2" in r.getMessage() for r in caplog.records)
    assert len(_quiet) == 2


def test_V32_재시도_상한_4회_뒤_503(maker, monkeypatch, _quiet):
    sc = build_scene(maker, 2)
    calls = _flaky_lock(monkeypatch, 99)
    with pytest.raises(HTTPException) as ei:
        _enter(maker, sc)
    assert ei.value.status_code == 503 and ei.value.detail["code"] == "lock_busy"
    assert calls["n"] == 4 and len(_quiet) == 3


def test_V33_지터_50_150ms(maker, monkeypatch, _quiet):
    sc = build_scene(maker, 2)
    _flaky_lock(monkeypatch, 3)
    _enter(maker, sc)
    assert len(_quiet) == 3 and all(0.05 <= s <= 0.15 for s in _quiet)


def test_V34_비교착_오류는_재시도_0(maker, monkeypatch, _quiet):
    sc = build_scene(maker, 2)
    calls = {"n": 0}

    def boom(s_id, db):
        calls["n"] += 1
        raise HTTPException(409, detail="x")

    monkeypatch.setattr(session_service, "_lock_session_for_capacity", boom)
    with pytest.raises(HTTPException) as ei:
        _enter(maker, sc)
    assert ei.value.status_code == 409 and calls["n"] == 1 and _quiet == []

    def other(s_id, db):
        calls["n"] += 1
        raise OperationalError("stmt", {}, Exception("connection refused"))

    calls["n"] = 0
    monkeypatch.setattr(session_service, "_lock_session_for_capacity", other)
    with pytest.raises(OperationalError):
        _enter(maker, sc)
    assert calls["n"] == 1 and _quiet == []


def test_V35_join_session도_재시도(maker, monkeypatch, _quiet):
    sc = build_scene(maker, 2, status="in_progress")
    uid, _ = sc.members[0]
    real = session_service.get_session_authorized
    calls = {"n": 0}

    def flaky(*a, **k):
        calls["n"] += 1
        if calls["n"] <= 1:
            raise _deadlock()
        return real(*a, **k)

    monkeypatch.setattr(session_service, "get_session_authorized", flaky)
    monkeypatch.setattr(session_service, "generate_livekit_token", lambda *a, **k: "tok")
    with maker() as db:
        try:
            session_service.join_session(str(sc.session_id), str(uid), "회원", db)
        except HTTPException as exc:  # 합성 데이터의 비즈니스 거절은 무관 — 재시도 횟수만 본다
            assert exc.status_code != 503
    assert calls["n"] >= 2 and len(_quiet) == 1

    calls["n"] = 0
    monkeypatch.setattr(session_service, "get_session_authorized", lambda *a, **k: (_ for _ in ()).throw(_deadlock()))
    with maker() as db, pytest.raises(HTTPException) as ei:
        session_service.join_session(str(sc.session_id), str(uid), "회원", db)
    assert ei.value.status_code == 503


def test_V36_50스레드_동시_입장_5xx0_교착0(maker, monkeypatch):
    monkeypatch.undo()  # sleep/notify 가짜 해제 — 실제 지터·실제 경로
    monkeypatch.setattr(session_service, "_notify_participant_changed", lambda *a, **k: None)
    monkeypatch.setattr(session_service, "_notify_promoted", lambda *a, **k: None)
    sc = build_scene(maker, 50)
    with maker() as db:
        cps.seed_live_state(db, sc.session_id)
    barrier = threading.Barrier(50)
    out = {"ok": 0, "err": []}
    lock = threading.Lock()

    def run(i):
        barrier.wait()
        try:
            _enter(maker, sc, i)
            with lock:
                out["ok"] += 1
        except Exception as exc:  # noqa: BLE001
            with lock:
                out["err"].append(f"{type(exc).__name__}:{str(exc)[:150]}")

    with ThreadPoolExecutor(max_workers=50) as pool:
        list(pool.map(run, range(50)))
    assert out["err"] == [] and out["ok"] == 50, out
    assert _rows(maker, sc) == 50
