"""SDD-308 후속 — 100명 동시 입장 교착 근본 원인 재현/회귀.

dev 100명 시험(11/7)에서 교착이 난 경로를 그대로 재현한다:
REST 입장(클래스→회차 FOR UPDATE) + 소켓 entry.enter(epoch→클래스) + capture.start(회차 KEY SHARE→epoch)
+ 입장 직후 participant_changed 발행(lock_context)을 실제로 켠 상태. 외부 발행(소켓/LiveKit)만 막는다.
"""
from __future__ import annotations

import os
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import HTTPException

from app.services import class_participation_service as cps
from app.services import session_service
from app.services.session_live_commands import Actor, LiveCommand, apply_command
from tests.sdd308.helpers import build_scene

N = int(os.environ.get("S308_N", "100"))


@pytest.fixture(autouse=True)
def _quiet(monkeypatch):
    # participant_changed 는 lock_context(실제 잠금)까지 그대로 실행하고 소켓 방송만 막는다.
    from app.ws import session_live_namespace as live

    for name in dir(live):
        if name.startswith("emit") or name.startswith("publish") or name.startswith("broadcast"):
            if callable(getattr(live, name)):
                monkeypatch.setattr(live, name, lambda *a, **k: None, raising=False)
    monkeypatch.setattr(session_service, "_notify_promoted", lambda *a, **k: None)
    cps.register_live_handlers()


def _is_deadlock(exc: BaseException) -> bool:
    t = f"{type(exc).__name__} {exc}".lower()
    return "deadlock" in t or "40p01" in t


CAPTURE = {"device_profile": "linkband2", "algorithm_version": "a1", "model_version": "m1"}


def _flow(maker, sc, n):
    """회원마다 REST 입장 → entry.enter → capture.start 를 한 번에 시작(5초 내 폭주)."""
    barrier = threading.Barrier(n)
    out = {"deadlock": 0, "other": 0, "ok": 0, "errs": {}}
    lock = threading.Lock()

    def note(kind, exc=None):
        with lock:
            if kind == "ok":
                out["ok"] += 1
                return
            out[kind] += 1
            key = f"{type(exc).__name__}:{str(exc)[:160]}"
            out["errs"][key] = out["errs"].get(key, 0) + 1

    def run(i):
        uid, pid = sc.members[i]
        barrier.wait()
        try:
            with maker() as db:
                session_service.enter_session_as_invited(str(sc.session_id), str(uid), db, recording_consent=True,
                                                         recording_notice_version="rec-1")
            actor = Actor(actor_id=uid, role="member", participant_id=pid)
            with maker() as db:
                r = apply_command(db, actor, LiveCommand(command_id=uuid.uuid4(), session_id=sc.session_id,
                                                         kind="entry.enter", payload={}))
                assert r.committed
            with maker() as db:
                r = apply_command(db, actor, LiveCommand(command_id=uuid.uuid4(), session_id=sc.session_id,
                                                         kind="capture.start", payload=dict(CAPTURE)))
                assert r.committed
            note("ok")
        except HTTPException as exc:
            note("other", exc)
        except Exception as exc:  # noqa: BLE001
            note("deadlock" if _is_deadlock(exc) else "other", exc)

    with ThreadPoolExecutor(max_workers=n) as pool:
        list(pool.map(run, range(n)))
    return out


def test_R1_100명_입장_entry_enter_capture_start_교착0(maker):
    sc = build_scene(maker, N)
    with maker() as db:
        cps.seed_live_state(db, sc.session_id)
    res = _flow(maker, sc, N)
    print("RESULT", res)
    assert res["deadlock"] == 0, res
    assert res["other"] == 0, res
    assert res["ok"] == N, res
