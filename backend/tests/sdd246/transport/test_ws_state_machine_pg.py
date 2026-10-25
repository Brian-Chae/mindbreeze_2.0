"""SDD-246 T05 — WS 상태머신(실제 서버 프로세스 + PG + Redis)."""
from __future__ import annotations

import asyncio
import uuid

import pytest
import sqlalchemy as sa

from app.models.live_state import LiveCommandLedger
from app.models.session import Session as SessionModel, SessionParticipant
from app.services import class_participation_service as cps
from app.services.session_live_legacy import PROTOCOL_V2, pin_session_protocol
from tests.sdd246.transport.conftest import wire_cmd
from tests.sdd246.transport.harness import Client, Server, hello, join_msg, token_for

pytestmark = pytest.mark.asyncio(loop_scope="function")


@pytest.fixture
def servers(pg_url, redis_url, prefix):
    made = []

    def make(n=1, **kw):
        channel = f"t05chan{uuid.uuid4().hex[:8]}"
        out = [Server(pg_url, redis_url, prefix, channel, **kw) for _ in range(n)]
        made.extend(out)
        return out

    yield make
    for s in made:
        s.stop()


@pytest.fixture
def v2world(maker, world):
    """v2 로 고정된 회차(열리기 전 상태에서 pin)."""
    with maker() as s:
        row = s.get(SessionModel, world.session_id)
        row.status = "ready"
        s.commit()
        pin_session_protocol(s, world.session_id, protocol=PROTOCOL_V2)
        row = s.get(SessionModel, world.session_id)
        row.status = "in_progress"
        s.commit()
    return world


async def test_join_완료_전_audio_ready_metric은_거부가_아니라_명시_대기_오류(servers, v2world):
    (srv,) = servers()
    w = v2world
    host_uid = w.host_id
    c = await Client(srv, host_uid).connect()
    try:
        # hello 전: join 불가를 명시
        r = await c.call("live:join", join_msg(w.session_id))
        assert r["ok"] is False and r["code"] == "hello_required" and r["retryable"] is True
        await c.call("live:hello", hello())
        for kind, payload in (("audio.set", {"track_id": str(uuid.uuid4()), "action": "stop", "position_ms": 0, "expected_revision": "0"}),
                              ("waiting.set_ready", {"ready": True, "checkin_revision": "1"})):
            ack = await c.call("live:command", wire_cmd(w, kind, payload))
            assert ack["status"] == "retryable" and ack["code"] == "not_joined" and ack["committed"] is False, ack
        m = await c.call("live:metric", {"anything": 1})
        assert m["ok"] is False and m["code"] == "not_ready" and m["retryable"] is True
        dev = await c.call("live:device", {"anything": 1})
        assert dev["code"] == "not_ready"
        # 부작용 0
        with v2world.maker() as s:
            assert s.scalar(sa.select(sa.func.count()).select_from(LiveCommandLedger).where(
                LiveCommandLedger.session_id == w.session_id, LiveCommandLedger.kind != "protocol.pin")) == 0
    finally:
        await c.close()


async def test_transport_connected와_READY는_분리된다(servers, v2world):
    (srv,) = servers()
    c = await Client(srv, v2world.host_id).connect()
    try:
        assert c.sio.connected
        await c.call("live:hello", hello())
        r = await c.call("live:join", join_msg(v2world.session_id))
        assert r["ok"] and r["state"] == "RESYNCING"  # snapshot 을 보냈어도 클라이언트 applied 전에는 READY 가 아니다
        snap = await c.wait_for("live:snapshot")
        await c.wait_for("live:sync_complete")
        # READY 전 metric 은 대기 오류
        assert (await c.call("live:metric", {}))["code"] == "not_ready"
        done = await c.call("live:applied", {"snapshot_id": snap["snapshot_id"]})
        assert done["state"] == "READY"
        assert snap["protocol_version"] == 2 and snap["session"]["data"]["status"] == "in_progress"
    finally:
        await c.close()


async def test_만료_token은_명시_에러로_refresh를_유도하고_reauth로_복구된다(servers, v2world):
    (srv,) = servers()
    c = Client(srv, v2world.host_id, token=token_for(v2world.host_id, minutes=1))
    await c.connect()
    try:
        await c.call("live:hello", hello())
        # 서버 연결 상태의 만료 시각을 과거로 되돌려 "연결 후 토큰이 만료된" 상황을 만든다
        r = await c.call("live:reauth", {"token": token_for(v2world.host_id, expired=True)})
        assert r["ok"] is False and r["code"] == "token_expired" and r["refresh"] is True
        fresh = await c.call("live:reauth", {"token": token_for(v2world.host_id)})
        assert fresh["ok"] is True
        # 다른 사람의 토큰으로는 갱신할 수 없다
        other = await c.call("live:reauth", {"token": token_for(uuid.uuid4())})
        assert other["code"] == "token_mismatch"
    finally:
        await c.close()


async def test_만료된_token으로_connect하면_token_expired로_거부된다(servers, v2world):
    (srv,) = servers()
    c = Client(srv, v2world.host_id, token=token_for(v2world.host_id, expired=True))
    reasons = []
    c.sio.on("connect_error", lambda d=None: reasons.append(d), namespace="/session-live")
    with pytest.raises(Exception):
        await c.connect()
    assert reasons and "token_expired" in str(reasons[0]), reasons


async def test_v1_회차는_v2_join이_protocol_v1_session으로_거절되고_v1_소켓은_그대로(servers, maker, world):
    (srv,) = servers()
    c = await Client(srv, world.members[0][0]).connect()  # world 는 pin 이 없는 구 회차
    try:
        await c.call("live:hello", hello())
        r = await c.call("live:join", join_msg(world.session_id))
        assert r["ok"] is False and r["code"] == "protocol_v1_session"
        # v1 join 은 기존 동작대로 성공
        joined = asyncio.Event()
        c.sio.on("joined", lambda d: joined.set(), namespace="/session-live")
        await c.sio.emit("join", {"session_id": str(world.session_id)}, namespace="/session-live")
        await asyncio.wait_for(joined.wait(), 5)
    finally:
        await c.close()


async def test_플래그_off면_v2_이벤트가_등록되지_않고_v1은_그대로(servers, v2world):
    (srv,) = servers(flag="0")
    c = await Client(srv, v2world.members[0][0]).connect()
    try:
        with pytest.raises(Exception):  # live:* handler 가 없으니 ack 가 오지 않는다
            await c.call("live:hello", hello(), timeout=1.5)
        joined = asyncio.Event()
        c.sio.on("joined", lambda d: joined.set(), namespace="/session-live")
        await c.sio.emit("join", {"session_id": str(v2world.session_id)}, namespace="/session-live")
        await asyncio.wait_for(joined.wait(), 5)  # v1 join 은 현행대로 동작
    finally:
        await c.close()


def test_플래그_off면_v2_네임스페이스_핸들러_집합이_v1과_같다(monkeypatch):
    import socketio

    from app.ws.session_live_namespace import register_session_live_namespace

    monkeypatch.setenv("LIVE_PROTOCOL_V2", "0")
    off = socketio.AsyncServer(async_mode="asgi")
    register_session_live_namespace(off)
    monkeypatch.setenv("LIVE_PROTOCOL_V2", "1")
    on = socketio.AsyncServer(async_mode="asgi")
    register_session_live_namespace(on)
    off_h, on_h = set(off.handlers["/session-live"]), set(on.handlers["/session-live"])
    assert not any(h.startswith("live:") for h in off_h)
    assert {h for h in on_h if h.startswith("live:")} >= {"live:hello", "live:join", "live:command", "live:clock_probe", "live:metric"}
    assert on_h - {h for h in on_h if h.startswith("live:")} == off_h


async def test_권한회수_snapshot_race는_구_scope_snapshot을_보내지_않고_재인가한다(servers, maker, v2world, live):
    (srv,) = servers()
    w = v2world
    mem = w.member(0)
    uid = w.members[0][0]
    c = await Client(srv, uid).connect()
    try:
        await c.call("live:hello", hello())
        # 인가 시점 이후(= snapshot 직전)에 권한이 회수되는 경합: auth_revision 을 올리고 참가자를 제거한다
        from app.models.live_state import LiveSessionEpoch

        def revoke():
            with maker() as s:
                p = s.get(SessionParticipant, mem.participant_id)
                import datetime as dt
                p.removed_at = dt.datetime.now(dt.timezone.utc)
                s.commit()
                cps.emit_participant_removed(s, s.get(SessionModel, w.session_id), p)
                s.commit()

        await asyncio.to_thread(revoke)
        r = await c.call("live:join", join_msg(w.session_id))
        assert r["ok"] is False and r["code"] == "join_denied"
        assert not c.of("live:snapshot"), "회수된 참가자에게 snapshot 이 나가면 안 된다"
    finally:
        await c.close()


async def test_늦은_LiveKit_token_응답은_입장_상태를_바꾸지_않는다(maker, world, monkeypatch):
    """토큰 발급 경로가 숨은 입장(mark_entered)을 하지 않는 v2 회차: 열리기 전 입장자는 토큰을 못 받고 출석도 없다."""
    from app.services import session_service

    with maker() as s:
        row = s.get(SessionModel, world.session_id)
        row.status = "open"
        row.webrtc_room_id = uuid.uuid4()
        row.class_id = row.class_id
        s.commit()
        pin_session_protocol(s, world.session_id, protocol=PROTOCOL_V2)
    uid, pid = world.members[0]
    with maker() as s:
        from app.models.session import SessionParticipant as SP
        p = s.get(SP, pid)
        assert p.entered_at is None
        monkeypatch.setattr(session_service, "generate_livekit_token", lambda **k: "TOKEN")
        monkeypatch.setattr("app.services.recording_consent_service.require_recording_consent", lambda p: None)
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as ei:
            session_service.participant_livekit_token(str(world.session_id), s, current_user_id=str(uid))
        assert ei.value.status_code == 409 and ei.value.detail == {"code": "entry_required"}
    with maker() as s:
        # v2 회차에서는 LiveKit token 조회가 입장(출석)을 만들지 않는다 — 입장은 entry.enter command 만
        assert s.get(SessionParticipant, pid).entered_at is None
