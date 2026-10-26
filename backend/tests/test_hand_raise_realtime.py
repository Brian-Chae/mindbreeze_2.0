"""손들기 REST → 호스트 룸 speaking_changed 발행 재현 (fix/hand-raise-realtime)."""

import asyncio
import threading
import time

import pytest

import app.ws.session_live_namespace as ns
from tests.test_class_quiet_signal import _participant_row
from tests.test_member_livekit_token import _guest_token_body, _start_group_class
from tests.test_sdd024_session_live_ws import _register, _wire


@pytest.fixture
def live_loop():
    loop = asyncio.new_event_loop()
    t = threading.Thread(target=loop.run_forever, daemon=True)
    t.start()
    yield loop
    loop.call_soon_threadsafe(loop.stop)
    t.join(2)


def _wait(pred, sec=2.0):
    end = time.time() + sec
    while time.time() < end:
        if pred():
            return True
        time.sleep(0.02)
    return False


def test_REST_손들기가_호스트룸에_speaking_changed_발행(client, monkeypatch, live_loop):
    counselor = _register(client, "hr01c@test.com")
    cls, joined = _start_group_class(client, counselor, participant_mode="group", max_participants=20)
    pid = joined["participant_id"]
    fake = _wire(monkeypatch)
    monkeypatch.setattr(ns, "_loop", live_loop)

    res = client.post(
        f"/api/v1/sessions/{cls['id']}/participants/{pid}/raise-hand",
        headers={"X-Entry-Credential": joined["entry_credential"]},
    )
    assert res.status_code == 200, res.text

    got = lambda: [e for e in fake.emits if e["event"] == "speaking_changed"]
    assert _wait(lambda: len(got()) >= 1), "REST 손들기 후 speaking_changed 가 발행되지 않음"
    host = [e for e in got() if e["room"] == f"session:{cls['id']}"]
    assert host and host[0]["data"]["raise_hand"] is True and host[0]["data"]["participant_id"] == pid


def test_예약된_발행이_실패하면_경고로그를_남긴다(monkeypatch, live_loop, caplog):
    async def boom():
        raise RuntimeError("emit 실패")

    monkeypatch.setattr(ns, "_loop", live_loop)
    with caplog.at_level("WARNING", logger=ns.logger.name):
        ns._schedule(boom())
        assert _wait(lambda: any("예약 발행 실패" in r.getMessage() for r in caplog.records))


def test_루프가_없으면_조용히_삼키지_않고_경고한다(monkeypatch, caplog):
    async def noop():
        return None

    monkeypatch.setattr(ns, "_loop", None)
    with caplog.at_level("WARNING", logger=ns.logger.name):
        ns._schedule(noop())
    assert any("이벤트 루프 없음" in r.getMessage() for r in caplog.records)
