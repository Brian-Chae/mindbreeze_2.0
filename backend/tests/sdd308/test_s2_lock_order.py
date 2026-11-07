"""SDD-308 ② 잠금 순서 — REST 입장(sessions→participants)과 live 명령(epoch→participants→sessions UPDATE)의 반대 순서 재현."""
from __future__ import annotations

import threading
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import HTTPException

from app.services import class_participation_service as cps
from app.services import session_service
from app.services.session_live_commands import Actor, LiveCommand, apply_command
from tests.sdd308.helpers import build_scene


@pytest.fixture(autouse=True)
def _quiet(monkeypatch):
    monkeypatch.setattr(session_service, "_notify_participant_changed", lambda *a, **k: None)
    monkeypatch.setattr(session_service, "_notify_promoted", lambda *a, **k: None)
    cps.register_live_handlers()


def _is_deadlock(exc: BaseException) -> bool:
    text = f"{type(exc).__name__} {exc}".lower()
    return "deadlock" in text or "40p01" in text


def _mixed(maker, sc, n, *, rounds=1):
    """절반은 REST 입장, 절반은 entry.enter 명령을 동시에 낸다. 반환 = (교착 수, 기타 오류 수, 성공 수)."""
    barrier = threading.Barrier(n)
    out = {"deadlock": 0, "other": 0, "ok": 0, "errs": set()}
    lock = threading.Lock()

    def run(i):
        uid, pid = sc.members[i]
        barrier.wait()
        try:
            with maker() as db:
                if i % 2 == 0:
                    session_service.enter_session_as_invited(str(sc.session_id), str(uid), db, recording_consent=True, recording_notice_version="rec-1")
                else:
                    r = apply_command(db, Actor(actor_id=uid, role="member", participant_id=pid),
                                      LiveCommand(command_id=uuid.uuid4(), session_id=sc.session_id, kind="entry.enter", payload={}))
                    assert r.committed
            with lock:
                out["ok"] += 1
        except HTTPException as exc:  # 비즈니스 거절은 교착이 아니다
            with lock:
                out["other"] += 1
                out["errs"].add(f"HTTP{exc.status_code}:{exc.detail}")
        except Exception as exc:  # noqa: BLE001
            with lock:
                out["deadlock" if _is_deadlock(exc) else "other"] += 1
                out["errs"].add(f"{type(exc).__name__}:{str(exc)[:1500]}")

    with ThreadPoolExecutor(max_workers=n) as pool:
        list(pool.map(run, range(n)))
    import os
    if os.environ.get("S308_DUMP"):
        open(os.environ["S308_DUMP"], "w").write("\n=====\n".join(sorted(out["errs"])))
    return out


def test_V22_REST입장과_entry_enter_명령_교차_50스레드_교착0(maker):
    sc = build_scene(maker, 50)
    with maker() as db:
        cps.seed_live_state(db, sc.session_id)
    res = _mixed(maker, sc, 50)
    assert res["deadlock"] == 0, res
    assert res["ok"] == 50, res


def test_V21_참가자_제거와_명령_교차_교착0(maker, monkeypatch):
    """remove_participant(참가자 행 갱신 → emit_participant_removed 의 epoch 잠금)와 member 명령(epoch → 참가자 행)의 순서 역전."""
    from app.services import session_live_legacy as legacy

    sc = build_scene(maker, 40)
    with maker() as db:
        cps.seed_live_state(db, sc.session_id)
    # 제거 경로가 v2 로 동작하도록 회차를 v2 로 고정
    with maker() as db:
        legacy.pin_session_protocol(db, sc.session_id, protocol=legacy.PROTOCOL_V2)
    for name in ("_notify_participants_event",):
        monkeypatch.setattr(session_service, name, lambda *a, **k: None)
    n = 40
    barrier = threading.Barrier(n)
    out = {"deadlock": 0, "other": 0, "ok": 0, "errs": set()}
    lock = threading.Lock()

    def run(i):
        uid, pid = sc.members[i]
        barrier.wait()
        try:
            with maker() as db:
                if i % 2 == 0:
                    session_service.remove_participant(str(sc.session_id), str(sc.host_id), str(uid), db)
                else:
                    apply_command(db, Actor(actor_id=uid, role="member", participant_id=pid),
                                  LiveCommand(command_id=uuid.uuid4(), session_id=sc.session_id, kind="entry.enter", payload={}))
            with lock:
                out["ok"] += 1
        except Exception as exc:  # noqa: BLE001
            with lock:
                out["deadlock" if _is_deadlock(exc) else "other"] += 1
                out["errs"].add(f"{type(exc).__name__}:{str(exc)[:200]}")

    with ThreadPoolExecutor(max_workers=n) as pool:
        list(pool.map(run, range(n)))
    assert out["deadlock"] == 0, out
    assert out["other"] == 0, out
