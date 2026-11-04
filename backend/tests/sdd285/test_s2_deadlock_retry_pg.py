"""SDD-285 S2 — capture.start 교착 완화 (로컬 PG 임시 DB; SDD-246 하네스 재사용)."""
from __future__ import annotations

import threading
import time
import uuid

import sqlalchemy as sa
from sqlalchemy.exc import DBAPIError, OperationalError

from app.models.live_state import CaptureStream, LiveCommandLedger
from app.services import session_live_commands as slc
from app.services.session_live_commands import (
    LiveCommand, apply_command, apply_command_with_retry, is_retryable_db_error,
)
from app.services.session_live_ledger import lock_epoch

PAYLOAD = {"device_profile": "t", "algorithm_version": "1", "model_version": "1"}


class _PgErr(Exception):
    def __init__(self, pgcode):
        super().__init__("deadlock detected")
        self.pgcode = pgcode


def _deadlock():
    return OperationalError("stmt", {}, _PgErr("40P01"))


def _start(world, cid=None):
    return LiveCommand(command_id=cid or uuid.uuid4(), session_id=world.session_id, kind="capture.start", payload=dict(PAYLOAD))


def _count(maker, world, model):
    with maker() as s:
        return s.scalar(sa.select(sa.func.count()).select_from(model).where(model.session_id == world.session_id))


def test_S2_교착_판별(world):
    assert is_retryable_db_error(_deadlock())
    assert not is_retryable_db_error(OperationalError("stmt", {}, Exception("connection refused")))
    assert not is_retryable_db_error(ValueError("x"))


def test_S2_교착이_한번이면_서버_재시도로_정확히_1개_stream(maker, world, monkeypatch):
    real = slc._HANDLERS["capture.start"]
    calls = {"n": 0}

    def flaky(ctx):
        calls["n"] += 1
        real(ctx)
        if calls["n"] == 1:
            raise _deadlock()

    monkeypatch.setitem(slc._HANDLERS, "capture.start", flaky)
    cmd = _start(world)
    with maker() as s:
        res = apply_command_with_retry(s, world.member(0), cmd)
    assert res.status == "applied" and res.committed and not res.transient
    assert calls["n"] == 2
    assert _count(maker, world, CaptureStream) == 1 and _count(maker, world, LiveCommandLedger) == 1  # 중복 generation·원장 없음


def test_S2_재시도_소진시_예외없이_db_busy_transient(maker, world, monkeypatch):
    def always(ctx):
        raise _deadlock()

    monkeypatch.setitem(slc._HANDLERS, "capture.start", always)
    with maker() as s:
        res = apply_command_with_retry(s, world.member(0), _start(world))
    assert res.transient and res.code == "db_busy" and not res.committed
    assert _count(maker, world, CaptureStream) == 0 and _count(maker, world, LiveCommandLedger) == 0


def test_S2_db_busy는_retryable_ACK(maker, world, monkeypatch):
    from app.services import class_participation_service as cps
    from tests.sdd246.commands.conftest import World  # noqa: F401

    def always(ctx):
        raise _deadlock()

    monkeypatch.setitem(slc._HANDLERS, "capture.start", always)
    monkeypatch.setattr(cps, "seed_live_state", lambda *a, **k: None)
    with maker() as s:
        out = cps.run_live_command(s, world.member(0), _start(world), live=object())
    assert out.ack["status"] == "retryable" and out.ack["committed"] is False
    assert out.ack["code"] == "db_busy" and out.ack["retry_after_ms"] > 0


def test_S2_재시도불가_오류는_그대로_전파(maker, world, monkeypatch):
    def bad(ctx):
        raise OperationalError("stmt", {}, Exception("connection refused"))

    monkeypatch.setitem(slc._HANDLERS, "capture.start", bad)
    with maker() as s:
        try:
            apply_command_with_retry(s, world.member(0), _start(world))
            raise AssertionError("전파되어야 한다")
        except DBAPIError:
            pass


def test_S2_락순서_sessions먼저_epoch나중_호스트경로와_교착없음(maker, world):
    """기존 R4(epoch→sessions KEY SHARE vs sessions→epoch 교착)가 같은 시나리오에서 더 이상 교착하지 않는다."""
    with maker() as s:
        apply_command(s, world.member(1), _start(world))  # epoch 행 선생성
    out: dict[str, object] = {}
    a_locked, b_started = threading.Event(), threading.Event()

    def contender():  # 호스트/REST 경로 흉내: sessions FOR UPDATE → epoch 락
        with maker() as s:
            try:
                s.execute(sa.text("select id from sessions where id=:i for update"), {"i": world.session_id})
                a_locked.set()
                b_started.wait(5)
                time.sleep(0.6)
                lock_epoch(s, world.session_id)
                s.commit()
                out["A"] = "ok"
            except DBAPIError as exc:
                s.rollback()
                out["A"] = "deadlock" if "deadlock" in str(exc).lower() else repr(exc)

    def start():
        a_locked.wait(5)
        with maker() as s:
            b_started.set()
            try:
                out["B_res"] = apply_command(s, world.member(0), _start(world))
                out["B"] = "ok"
            except DBAPIError as exc:
                s.rollback()
                out["B"] = "deadlock" if "deadlock" in str(exc).lower() else repr(exc)

    ta, tb = threading.Thread(target=contender), threading.Thread(target=start)
    ta.start(); tb.start(); ta.join(30); tb.join(30)
    assert out.get("A") == "ok" and out.get("B") == "ok", out
    assert out["B_res"].status == "applied"
