"""SDD-285 S9 — stream 미고정 경고 / 입구 거절 capture.* 로그 (로그 전용, 외부 의존 없음)."""
from __future__ import annotations

import logging

from app.services import capture_anchor_watch as caw

START_ACK = {"status": "applied", "committed": True, "result": {"stream_id": "abcdef12-0000-0000-0000-000000000000"}}
PID = "123456ff-0000-0000-0000-000000000000"


def _w(caplog, tag):
    return [r.getMessage() for r in caplog.records if tag in r.getMessage()]


def test_S9_start_후_45초_안에_reanchor_없으면_경고_1회(caplog):
    caplog.set_level(logging.INFO, logger=caw.logger.name)
    w = caw.AnchorWatch()
    caw.note_result(w, "capture.start", START_ACK, now=100.0)
    assert caw.check(w, PID, now=130.0) is False  # 30초: 아직
    assert caw.check(w, PID, now=146.0) is True  # 46초
    assert caw.check(w, PID, now=200.0) is False  # 시작 1건당 1회
    msgs = _w(caplog, "[capture-unanchored]")
    assert len(msgs) == 1 and "123456" in msgs[0] and PID not in msgs[0] and "abcdef" in msgs[0]


def test_S9_reanchor_또는_renew가_적용되면_경고_없음(caplog):
    caplog.set_level(logging.INFO, logger=caw.logger.name)
    for kind in ("capture.reanchor", "capture.renew"):
        w = caw.AnchorWatch()
        caw.note_result(w, "capture.start", START_ACK, now=0.0)
        caw.note_result(w, kind, {"status": "applied", "committed": True}, now=20.0)
        assert caw.check(w, PID, now=500.0) is False
    assert _w(caplog, "[capture-unanchored]") == []


def test_S9_거절된_reanchor는_감시를_풀지_않는다():
    w = caw.AnchorWatch()
    caw.note_result(w, "capture.start", START_ACK, now=0.0)
    caw.note_result(w, "capture.reanchor", {"status": "rejected", "committed": True, "code": "stream_not_active"}, now=10.0)
    assert caw.check(w, PID, now=60.0) is True


def test_S9_재시작하면_새_start부터_다시_감시(caplog):
    w = caw.AnchorWatch()
    caw.note_result(w, "capture.start", START_ACK, now=0.0)
    assert caw.check(w, PID, now=50.0) is True
    caw.note_result(w, "capture.start", START_ACK, now=60.0)  # 새 명령 ID 의 재시작
    assert caw.check(w, PID, now=90.0) is False and w.starts == 2
    assert caw.check(w, PID, now=106.0) is True


def test_S9_중복_ACK_재전송은_감시시계를_다시_시작하지_않는다():
    w = caw.AnchorWatch()
    caw.note_result(w, "capture.start", START_ACK, now=0.0)
    caw.note_result(w, "capture.start", {**START_ACK, "status": "duplicate"}, now=40.0)
    assert caw.check(w, PID, now=46.0) is True


def test_S9_start가_적용되지_않았으면_감시_없음():
    w = caw.AnchorWatch()
    caw.note_result(w, "capture.start", {"status": "rejected", "committed": True, "code": "session_ended"}, now=0.0)
    caw.note_result(w, "capture.start", {"status": "retryable", "committed": False}, now=0.0)
    assert caw.check(w, PID, now=999.0) is False


def test_S9_입구거절_capture는_사유와_종류를_남기고_ID는_6자리(caplog):
    caplog.set_level(logging.INFO, logger=caw.logger.name)
    caw.log_gate_reject(PID, "capture.start", "token_expired", "READY")
    caw.log_gate_reject(PID, "hand.set", "token_expired", "READY")  # capture.* 가 아니면 남기지 않는다
    msgs = _w(caplog, "[capture-gate-reject]")
    assert len(msgs) == 1
    assert "kind=capture.start" in msgs[0] and "code=token_expired" in msgs[0] and "123456" in msgs[0] and PID not in msgs[0]


def test_S9_로그_코드는_예외를_내지_않는다():
    caw.note_result(None, "capture.start", None)  # type: ignore[arg-type]
    assert caw.check(None, PID) is False  # type: ignore[arg-type]
    caw.log_gate_reject(None, None, None)  # type: ignore[arg-type]


def test_S9_소켓_핸들러가_감시를_연결했다():
    """소켓 파일 배선 확인(정적): 거절 로그·결과 기록·heartbeat 점검이 각각 1곳 이상 연결."""
    from pathlib import Path

    src = (Path(__file__).parents[2] / "app/ws/session_live_namespace.py").read_text()
    assert src.count("caw.log_gate_reject") == 1 and src.count("caw.note_result") == 1 and src.count("caw.check(") == 1
    assert src.count("_gate_reject(conn, cmd, cid,") == 5
