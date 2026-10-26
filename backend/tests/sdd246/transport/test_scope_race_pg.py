"""SDD-246 T05 — 인가 후 snapshot 직전 권한회수 race (in-process 핸들러 직접 호출, 실제 PG + Redis)."""
from __future__ import annotations

import uuid

import pytest

from app.services import class_participation_service as cps
from app.services import session_live_outbox as ob
from app.services.session_live_legacy import PROTOCOL_V2, pin_session_protocol
from app.services.session_live_state import ScopeStale
from tests.sdd246.transport.harness import hello, join_msg
from tests.sdd246.transport.test_ws_state_machine_pg import v2world  # noqa: F401

pytestmark = pytest.mark.asyncio(loop_scope="function")


class StubSio:
    """register_v2_handlers 가 쓰는 최소 표면. 핸들러 dict 와 emit/room 기록을 노출한다."""

    def __init__(self, user_id):
        self.handlers, self.emitted, self.rooms, self.sess = {}, [], set(), {"user_id": user_id, "token_exp": None}

    def on(self, name, namespace=None):
        def deco(fn):
            self.handlers[name] = fn
            return fn
        return deco

    async def get_session(self, sid, namespace=None):
        return self.sess

    async def emit(self, event, data=None, to=None, room=None, namespace=None):
        self.emitted.append((event, data))

    async def enter_room(self, sid, room, namespace=None):
        self.rooms.add(room)

    async def leave_room(self, sid, room, namespace=None):
        self.rooms.discard(room)

    async def close_room(self, room, namespace=None):
        self.rooms.discard(room)


@pytest.fixture
def stub(v2world, live, monkeypatch):
    from app.ws import session_live_namespace as ns

    s = StubSio(v2world.members[0][0])
    monkeypatch.setattr(ns, "_open_db", lambda: v2world.maker())
    ns._v2_conns.clear()
    ns.register_v2_handlers(s, ns._NAMESPACE)
    monkeypatch.setattr(ns, "_get_sio", lambda: s)
    yield s
    ns._v2_conns.clear()


async def _hello_and_join(stub, w, **kw):
    assert (await stub.handlers["live:hello"]("sid1", hello()))["ok"]
    return await stub.handlers["live:join"]("sid1", join_msg(w.session_id))


async def test_snapshot_직전_권한이_회수되면_구_scope_snapshot을_보내지_않고_access_revoked(stub, v2world, monkeypatch):
    import datetime as dt

    from app.models.session import SessionParticipant

    def remove_during_snapshot(db, live, sid, scope, **kw):
        # 인가는 끝났고 snapshot 을 읽는 순간 권한이 회수됐다(참가자 제거 + auth_revision 증가)
        with v2world.maker() as s:
            p = s.get(SessionParticipant, v2world.members[0][1])
            p.removed_at = dt.datetime.now(dt.timezone.utc)
            s.commit()
        raise ScopeStale(0, 1)

    monkeypatch.setattr(ob, "snapshot_ready", remove_during_snapshot)
    r = await _hello_and_join(stub, v2world)
    assert r["ok"] is False and r["code"] == "access_revoked", r
    assert not [e for e, _ in stub.emitted if e == "live:snapshot"], "회수된 scope 의 snapshot 이 나가면 안 된다"
    assert any(e == "live:access_revoked" for e, _ in stub.emitted)
    assert not stub.rooms, "회수 후 어떤 room 에도 남지 않는다"


async def test_권한이_유지되면_ScopeStale_후_재인가해_새_scope로_snapshot을_보낸다(stub, v2world, monkeypatch):
    real = ob.snapshot_ready
    calls = {"n": 0}

    def once_stale(db, live, sid, scope, **kw):
        calls["n"] += 1
        if calls["n"] == 1:
            raise ScopeStale(0, 1)
        return real(db, live, sid, scope, **kw)

    monkeypatch.setattr(ob, "snapshot_ready", once_stale)
    r = await _hello_and_join(stub, v2world)
    assert r["ok"] is True and calls["n"] == 2
    assert len([e for e, _ in stub.emitted if e == "live:snapshot"]) == 1


async def test_command_직전_ScopeStale이면_재인가하고_resync_required를_알린다(stub, v2world, monkeypatch):
    r = await _hello_and_join(stub, v2world)
    assert r["ok"]
    snap = [d for e, d in stub.emitted if e == "live:snapshot"][0]
    await stub.handlers["live:applied"]("sid1", {"snapshot_id": snap["snapshot_id"]})
    # 다른 경로가 권한 변경(다른 참가자 추방 → outbox event + auth_revision 증가)을 projection 했다
    from app.models.session import Session as SessionModel, SessionParticipant
    import datetime as dt

    with v2world.maker() as s:
        other = s.get(SessionParticipant, v2world.members[1][1])
        other.removed_at = dt.datetime.now(dt.timezone.utc)
        s.commit()
        cps.emit_participant_removed(s, s.get(SessionModel, v2world.session_id), other)
        s.commit()
        ob.drain(s, cps.get_live_redis(), v2world.session_id)
    from tests.sdd246.transport.conftest import wire_cmd

    ack = await stub.handlers["live:command"]("sid1", wire_cmd(v2world, "hand.set", {"raised": True}, epoch=snap["epoch"]))
    assert ack["status"] in ("applied", "retryable"), ack
    assert any(e == "live:resync_required" for e, _ in stub.emitted)


async def test_Redis_불가시_join은_503_DEGRADED이고_snapshot을_만들지_않는다(stub, v2world, monkeypatch):
    from app.services.live_redis.client import LiveRedisUnavailable

    def boom(*a, **k):
        raise LiveRedisUnavailable("redis_unreachable")

    monkeypatch.setattr(ob, "snapshot_ready", boom)
    r = await _hello_and_join(stub, v2world)
    assert r["ok"] is False and r["code"] == "live_unavailable" and r["http_status"] == 503 and r["degraded"] is True
    assert not [e for e, _ in stub.emitted if e == "live:snapshot"]


async def test_이전_epoch의_duplicate_ACK는_현재_epoch_cursors를_싣는다(stub, v2world):
    from tests.sdd246.transport.conftest import wire_cmd

    r = await _hello_and_join(stub, v2world)
    snap = [d for e, d in stub.emitted if e == "live:snapshot"][0]
    await stub.handlers["live:applied"]("sid1", {"snapshot_id": snap["snapshot_id"]})
    env = wire_cmd(v2world, "hand.set", {"raised": True}, epoch=snap["epoch"])
    first = await stub.handlers["live:command"]("sid1", env)
    again = await stub.handlers["live:command"]("sid1", env)
    assert first["status"] == "applied" and again["status"] == "duplicate"
    assert again["cursors"], "duplicate ACK 는 현재 cursors 를 제공해 과거 ACK 가 현재 상태를 덮지 못하게 한다"
    assert again["cursors"] == first["cursors"] or int(again["cursors"][0]["seq"]) >= int(first["cursors"][0]["seq"])
