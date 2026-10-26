"""SDD-224 V3~V6: `_refresh_instructor_rooms` 권한 재검사 throttle."""

import pytest

import app.ws.session_live_namespace as ns


class _FakeSio:
    def __init__(self):
        self.emitted = []
        self.left = []

    async def get_session(self, sid, namespace=None):
        return {"role": "host", "user_id": "u1", "participant_id": None}

    async def emit(self, event, data=None, **kw):
        self.emitted.append((event, kw.get("to")))

    async def leave_room(self, sid, room, namespace=None):
        self.left.append((sid, room))

    async def save_session(self, sid, data, namespace=None):
        pass


@pytest.fixture(autouse=True)
def _wire(monkeypatch):
    ns.clear_group_aggregates()
    sio = _FakeSio()
    clock = {"t": 1000.0}
    calls = []
    monkeypatch.setattr(ns, "_get_sio", lambda: sio)
    monkeypatch.setattr(ns.time, "monotonic", lambda: clock["t"])
    monkeypatch.setattr(ns, "_sid_session_ids", {"s1": "sess", "s2": "sess", "other": "x"})

    def resolve(session_id, user_id, participant_id, credential=None):
        calls.append(session_id)
        return {"role": "host"}

    monkeypatch.setattr(ns, "_resolve_join", resolve)
    monkeypatch.setattr(ns, "_participation_socket", lambda *a, **k: None)
    yield sio, clock, calls
    ns.clear_group_aggregates()


@pytest.mark.asyncio
async def test_v3_second_call_within_interval_is_skipped(_wire):
    _, clock, calls = _wire
    await ns._refresh_instructor_rooms("sess")
    assert len(calls) == 2  # 소켓당 1회
    clock["t"] += ns.REFRESH_MIN_INTERVAL_SEC - 0.1
    await ns._refresh_instructor_rooms("sess")
    assert len(calls) == 2
    clock["t"] += 0.2
    await ns._refresh_instructor_rooms("sess")
    assert len(calls) == 4


@pytest.mark.asyncio
async def test_v4_force_always_runs(_wire):
    _, _, calls = _wire
    await ns._refresh_instructor_rooms("sess")
    await ns._refresh_instructor_rooms("sess", force=True)
    assert len(calls) == 4


@pytest.mark.asyncio
async def test_v5_clear_session_state_resets_throttle(_wire):
    _, _, calls = _wire
    await ns._refresh_instructor_rooms("sess")
    ns.clear_session_state("sess")
    assert "sess" not in ns._last_refresh_at
    await ns._refresh_instructor_rooms("sess")
    assert len(calls) == 4


@pytest.mark.asyncio
async def test_in_flight_duplicate_is_skipped(_wire):
    _, _, calls = _wire
    ns._refresh_in_flight.add("sess")
    await ns._refresh_instructor_rooms("sess")
    assert calls == []


@pytest.mark.asyncio
async def test_v6_forced_refresh_revokes_right_after_throttled_one(monkeypatch, _wire):
    sio, _, _ = _wire
    await ns._refresh_instructor_rooms("sess")  # 정상 → throttle 시작
    monkeypatch.setattr(ns, "_resolve_join", lambda *a, **k: None)  # 권한 회수
    await ns._refresh_instructor_rooms("sess")  # throttle → 변화 없음
    assert not any(e == "access_revoked" for e, _ in sio.emitted)
    await ns._refresh_instructor_rooms("sess", force=True)
    assert [t for e, t in sio.emitted if e == "access_revoked"] == ["s1", "s2"]
