"""대기실 회원 미표시 회귀 — join 진행 중 도착한 waiting_room 유실 / 호스트 늦은 접속 replay."""

import asyncio

import app.ws.session_live_namespace as ns
from tests.test_class_waiting_room_presence import FakeSio, _wire


def _prepare(monkeypatch, fake, role, pid, delay=0.05):
    def resolve(session_id, user_id, participant_id, credential):
        import time

        time.sleep(delay)  # DB 조회 지연 모사(to_thread)
        return {"role": role, "participant_id": pid, "snapshot": {}}

    monkeypatch.setattr(ns, "_resolve_join", resolve)
    monkeypatch.setattr(ns, "_account_is_active", lambda uid: True)
    monkeypatch.setattr(ns, "_participation_socket", lambda sid, ctx, action: None)

    async def noop(*a, **k):
        return None

    monkeypatch.setattr(ns, "_refresh_instructor_rooms", noop)
    monkeypatch.setattr(ns, "publish_group_aggregate", noop)
    monkeypatch.setattr(ns, "publish_group_average", noop)
    ns.reset_waiting_room_presence()


def test_join_진행_중_도착한_waiting_room_도_유실되지_않는다(monkeypatch):
    fake = _wire(monkeypatch)
    _prepare(monkeypatch, fake, "participant", "p-1")
    join = fake.handlers[("/session-live", "join")]
    wr = fake.handlers[("/session-live", "waiting_room")]

    async def scenario():
        fake.sessions["sid-1"] = {"user_id": None}
        t = asyncio.create_task(join("sid-1", {"session_id": "sess-1", "participant_id": "p-1"}))
        await asyncio.sleep(0.01)  # join 이 컨텍스트를 비우고 DB 조회 중인 구간
        await wr("sid-1", {"session_id": "sess-1", "action": "join", "nickname": "민지"})
        await t

    asyncio.run(scenario())
    ev = fake.events("waiting_room_changed")
    assert len(ev) == 1 and ev[0]["data"]["participant_id"] == "p-1"


def test_호스트가_늦게_join_하면_대기_회원을_replay_받는다(monkeypatch):
    fake = _wire(monkeypatch, {"sid-1": {"user_id": None, "role": "participant", "participant_id": "p-1", "session_id": "sess-1"}})
    _prepare(monkeypatch, fake, "host", None, delay=0)
    wr = fake.handlers[("/session-live", "waiting_room")]
    join = fake.handlers[("/session-live", "join")]

    async def scenario():
        await wr("sid-1", {"session_id": "sess-1", "action": "join", "nickname": "민지"})
        fake.emits.clear()
        fake.sessions["sid-h"] = {"user_id": "u-host"}
        await join("sid-h", {"session_id": "sess-1"})

    asyncio.run(scenario())
    ev = [e for e in fake.events("waiting_room_changed") if e["to"] == "sid-h"]
    assert len(ev) == 1
    assert ev[0]["data"]["participant_id"] == "p-1" and ev[0]["data"]["nickname"] == "민지"


def test_leave_한_회원은_replay_되지_않는다(monkeypatch):
    fake = _wire(monkeypatch, {"sid-1": {"user_id": None, "role": "participant", "participant_id": "p-1", "session_id": "sess-1"}})
    _prepare(monkeypatch, fake, "host", None, delay=0)
    wr = fake.handlers[("/session-live", "waiting_room")]
    join = fake.handlers[("/session-live", "join")]

    async def scenario():
        await wr("sid-1", {"session_id": "sess-1", "action": "join"})
        await wr("sid-1", {"session_id": "sess-1", "action": "leave"})
        fake.emits.clear()
        fake.sessions["sid-h"] = {"user_id": "u-host"}
        await join("sid-h", {"session_id": "sess-1"})

    asyncio.run(scenario())
    assert [e for e in fake.events("waiting_room_changed") if e["to"] == "sid-h"] == []
