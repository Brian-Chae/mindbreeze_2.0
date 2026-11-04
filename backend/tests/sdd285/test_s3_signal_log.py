"""SDD-285 S3 — stream 없는 참가자의 업로드 경고 / [raw-ack] 로그 (로컬 PG 임시 DB)."""
from __future__ import annotations

import logging
import uuid

from app.services import ingest_signal_log as sig
from app.services.session_live_commands import LiveCommand, apply_command

PAYLOAD = {"device_profile": "t", "algorithm_version": "1", "model_version": "1"}


def _warns(caplog):
    return [r for r in caplog.records if "[upload-no-stream]" in r.getMessage()]


def test_S3_stream없는_참가자는_경고_1줄_ID는_앞6자리(maker, world, caplog):
    sig.reset_for_tests()
    pid = world.members[0][1]
    caplog.set_level(logging.INFO, logger=sig.logger.name)
    with maker() as s:
        assert sig.warn_if_no_stream(s, world.session_id, pid, "features-batch", now=1000.0) is True
    msgs = [r.getMessage() for r in _warns(caplog)]
    assert len(msgs) == 1
    assert str(pid)[:6] in msgs[0] and str(pid) not in msgs[0]  # 전체 ID 는 남기지 않는다


def test_S3_같은_참가자_60초_안엔_1회만_경고(maker, world, caplog):
    sig.reset_for_tests()
    pid = world.members[0][1]
    caplog.set_level(logging.INFO, logger=sig.logger.name)
    with maker() as s:
        r = [sig.warn_if_no_stream(s, world.session_id, pid, "raw-ack", now=t) for t in (0.0, 10.0, 59.0, 61.0)]
    assert r == [True, False, False, True]
    assert len(_warns(caplog)) == 2


def test_S3_stream이_있으면_경고_없음(maker, world, caplog):
    sig.reset_for_tests()
    with maker() as s:
        apply_command(s, world.member(0), LiveCommand(command_id=uuid.uuid4(), session_id=world.session_id,
                                                      kind="capture.start", payload=dict(PAYLOAD)))
    caplog.set_level(logging.INFO, logger=sig.logger.name)
    with maker() as s:
        assert sig.warn_if_no_stream(s, world.session_id, world.members[0][1], "features-batch", now=5.0) is False
    assert _warns(caplog) == []


def test_S3_raw_ack_로그_1줄과_경고(maker, world, caplog):
    sig.reset_for_tests()
    pid = world.members[1][1]
    caplog.set_level(logging.INFO, logger=sig.logger.name)
    with maker() as s:
        sig.log_raw_ack(s, world.session_id, pid, {"acked": 3, "failed": 1}, chunks=4, ms=12.0)
    acks = [r.getMessage() for r in caplog.records if "[raw-ack]" in r.getMessage()]
    assert len(acks) == 1 and "chunks=4 acked=3 failed=1" in acks[0] and str(pid)[:6] in acks[0] and str(pid) not in acks[0]
    assert len(_warns(caplog)) == 1


def test_S3_점검_실패해도_예외_전파_없음(world):
    class Boom:
        def execute(self, *a, **k):
            raise RuntimeError("db down")

    sig.reset_for_tests()
    assert sig.warn_if_no_stream(Boom(), world.session_id, world.members[0][1], "x", now=1.0) is False
    sig.log_raw_ack(Boom(), world.session_id, world.members[0][1], None, chunks=1, ms=1.0)  # 예외 없음
