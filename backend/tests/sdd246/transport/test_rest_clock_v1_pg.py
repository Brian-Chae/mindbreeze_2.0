"""SDD-246 T05 — REST 폴백·clock_probe→reanchor·v1 REST 연결·Redis 장애·플래그 off (PG + Redis 실제)."""
from __future__ import annotations

import asyncio
import uuid

import pytest
import sqlalchemy as sa
from fastapi.testclient import TestClient

from app.models.live_state import CaptureStream, LiveOutbox
from app.models.session import Session as SessionModel, SessionParticipant
from app.services import class_participation_service as cps
from app.services.session_live_legacy import PROTOCOL_V2, pin_session_protocol
from tests.sdd246.transport.conftest import wire_cmd
from tests.sdd246.transport.harness import Client, SECRET, hello, join_msg, token_for
from tests.sdd246.transport.test_ws_state_machine_pg import servers, v2world  # noqa: F401


@pytest.fixture
def api(maker, monkeypatch):
    from app.config import settings
    from app.core.database import get_db
    from app.main import app

    monkeypatch.setattr(settings, "jwt_secret_key", SECRET)

    def _db():
        s = maker()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = _db
    yield TestClient(app)
    app.dependency_overrides.pop(get_db, None)


def _auth(uid):
    return {"Authorization": f"Bearer {token_for(uid)}"}


def _auth_v2(uid):
    """v2 를 지원하는 클라이언트(REST 에는 hello 가 없어 X-Live-Protocol 헤더로 능력을 알린다)."""
    return {**_auth(uid), "X-Live-Protocol": "1,2"}


def test_REST_snapshot은_WS와_같은_완전_snapshot을_준다(api, v2world):
    uid = v2world.members[0][0]
    r = api.get(f"/api/v1/sessions/{v2world.session_id}/live-v2/snapshot", headers=_auth(uid), params={"generation": "7"})
    assert r.status_code == 200, r.text
    snap = r.json()
    assert snap["protocol_version"] == 2 and snap["connection_generation"] == "7"
    assert snap["session"]["data"]["status"] == "in_progress"
    assert snap["audiences"] == ["public", f"member:{v2world.members[0][1]}"]


def test_REST_Redis_불가시_503이고_메모리_폴백이_없다(api, v2world, monkeypatch):
    from app.services import session_live_outbox as ob
    from app.services.live_redis.client import LiveRedisUnavailable

    def boom(*a, **k):
        raise LiveRedisUnavailable("redis_unreachable")

    monkeypatch.setattr(ob, "snapshot_ready", boom)
    r = api.get(f"/api/v1/sessions/{v2world.session_id}/live-v2/snapshot", headers=_auth(v2world.members[0][0]))
    assert r.status_code == 503 and r.json()["code"] == "live_unavailable"


def test_REST_명령_본문이_다르면_같은_ID라도_409_충돌(api, v2world):
    uid = v2world.members[0][0]
    cid = uuid.uuid4()
    a = api.post(f"/api/v1/sessions/{v2world.session_id}/live-v2/commands", headers=_auth(uid),
                 json=wire_cmd(v2world, "hand.set", {"raised": True}, command_id=cid))
    b = api.post(f"/api/v1/sessions/{v2world.session_id}/live-v2/commands", headers=_auth(uid),
                 json=wire_cmd(v2world, "hand.set", {"raised": False}, command_id=cid))
    assert a.status_code == 200 and a.json()["status"] == "applied"
    assert b.status_code == 409 and b.json()["code"] == "idempotency_conflict"


def test_REST_계약_위반은_400이고_부작용_0(api, maker, v2world):
    uid = v2world.members[0][0]
    bad = wire_cmd(v2world, "hand.set", {"raised": True, "extra": 1})
    r = api.post(f"/api/v1/sessions/{v2world.session_id}/live-v2/commands", headers=_auth(uid), json=bad)
    assert r.status_code == 400 and r.json()["code"] == "unknown_field"
    assert api.post(f"/api/v1/sessions/{v2world.session_id}/live-v2/commands", headers=_auth(uid),
                    json={**wire_cmd(v2world, "hand.set", {"raised": True}), "protocol_version": 3}).json()["code"] == "upgrade_required"


def test_플래그_off면_REST_v2_경로는_404(api, v2world, monkeypatch):
    monkeypatch.setenv("LIVE_PROTOCOL_V2", "0")
    uid = v2world.members[0][0]
    assert api.get(f"/api/v1/sessions/{v2world.session_id}/live-v2/snapshot", headers=_auth(uid)).status_code == 404
    assert api.post(f"/api/v1/sessions/{v2world.session_id}/live-v2/commands", headers=_auth(uid),
                    json=wire_cmd(v2world, "hand.set", {"raised": True})).status_code == 404


def test_인증이_없으면_REST_v2는_401(api, v2world):
    assert api.get(f"/api/v1/sessions/{v2world.session_id}/live-v2/snapshot").status_code == 401


# ---- v1 REST → T10 어댑터 ----

def test_v2_회차의_v1_손들기_REST는_execute_v1을_거쳐_ledger와_outbox를_남기고_구_응답을_돌려준다(api, maker, v2world):
    uid, pid = v2world.members[0]
    r = api.post(f"/api/v1/sessions/{v2world.session_id}/participants/{pid}/raise-hand", headers=_auth_v2(uid))
    assert r.status_code == 200, r.text
    assert r.json()["raise_hand"] is True and r.json()["participant_id"] == str(pid)
    with maker() as s:
        n = s.scalar(sa.select(sa.func.count()).select_from(LiveOutbox).where(
            LiveOutbox.session_id == v2world.session_id, LiveOutbox.event_type == "speaking.changed"))
    assert n == 1
    low = api.post(f"/api/v1/sessions/{v2world.session_id}/participants/{pid}/lower-hand", headers=_auth_v2(uid))
    assert low.status_code == 200 and low.json()["raise_hand"] is False and low.json()["lowered_by"] == "self"


def test_v1_회차의_REST는_기존_경로_그대로_ledger를_만들지_않는다(api, maker, world):
    uid, pid = world.members[0]  # pin 없음 = v1
    r = api.post(f"/api/v1/sessions/{world.session_id}/participants/{pid}/raise-hand", headers=_auth(uid))
    assert r.status_code == 200 and r.json()["raise_hand"] is True
    with maker() as s:
        assert s.scalar(sa.select(sa.func.count()).select_from(LiveOutbox).where(LiveOutbox.session_id == world.session_id)) == 0


def test_플래그_off면_v2_회차라도_v1_REST는_기존_경로(api, maker, v2world, monkeypatch):
    monkeypatch.setenv("LIVE_PROTOCOL_V2", "0")
    uid, pid = v2world.members[0]
    r = api.post(f"/api/v1/sessions/{v2world.session_id}/participants/{pid}/raise-hand", headers=_auth(uid))
    assert r.status_code == 200
    with maker() as s:
        assert s.scalar(sa.select(sa.func.count()).select_from(LiveOutbox).where(LiveOutbox.session_id == v2world.session_id)) == 0


def test_v2_회차의_v1_종료는_cutoff와_completed_payload를_남긴다(api, maker, v2world):
    r = api.post(f"/api/v1/sessions/{v2world.session_id}/end", headers=_auth_v2(v2world.host_id))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "completed"
    with maker() as s:
        ev = s.execute(sa.select(LiveOutbox).where(LiveOutbox.session_id == v2world.session_id, LiveOutbox.domain == "session")
                       .order_by(LiveOutbox.revision.desc())).scalars().first()
    assert ev.payload["status"] == "completed"


# ---- clock_probe → capture.reanchor ----

pytestmark_ws = pytest.mark.asyncio(loop_scope="function")


@pytestmark_ws
async def test_clock_probe_서버오차가_reanchor의_clock_uncertain을_해소한다(servers, maker, v2world):
    (srv,) = servers()
    w = v2world
    uid, pid = w.members[0]
    c = await Client(srv, uid).connect()
    try:
        snap = await c.join_ready(w.session_id)
        start = await c.call("live:command", wire_cmd(w, "capture.start", {"device_profile": "lb2", "algorithm_version": "a1", "model_version": "m1"},
                                                      epoch=snap["epoch"]))
        assert start["status"] == "applied", start
        stream_id = start and (await asyncio.to_thread(_active_stream, maker, pid))
        probe_id = str(uuid.uuid4())
        pr = await c.call("live:clock_probe", {"protocol_version": 2, "schema_version": 1, "probe_id": probe_id,
                                               "client_monotonic_us": "123456", "server_receive_ms": None, "server_send_ms": None})
        assert pr["ok"] and isinstance(pr["server_receive_ms"], int) and pr["server_send_ms"] >= pr["server_receive_ms"]
        ra = await c.call("live:command", wire_cmd(w, "capture.reanchor", {"stream_id": stream_id, "clock_probe_id": probe_id,
                                                                            "device_ticks": "1000", "monotonic_us": "123456"}, epoch=snap["epoch"]))
        assert ra["status"] == "applied", ra
        with maker() as s:
            st = s.get(CaptureStream, uuid.UUID(stream_id))
            assert st.clock_uncertain is False and st.clock_uncertainty_ms is not None and st.clock_uncertainty_ms <= 10_000
        # 서버가 보증하지 않은 probe(모르는 ID)는 clock_uncertain 유지
        bad = await c.call("live:command", wire_cmd(w, "capture.reanchor", {"stream_id": stream_id, "clock_probe_id": str(uuid.uuid4()),
                                                                             "device_ticks": "2000", "monotonic_us": "999"}, epoch=snap["epoch"]))
        assert bad["status"] == "applied"
        with maker() as s:
            assert s.get(CaptureStream, uuid.UUID(stream_id)).clock_uncertain is True
        # 남의 probe 는 쓸 수 없다
        other = await Client(srv, w.host_id).connect()
        try:
            await other.call("live:hello", hello())
            await other.join_ready(w.session_id)
            op = str(uuid.uuid4())
            await other.call("live:clock_probe", {"protocol_version": 2, "schema_version": 1, "probe_id": op, "client_monotonic_us": "1",
                                                   "server_receive_ms": None, "server_send_ms": None})
            steal = await c.call("live:command", wire_cmd(w, "capture.reanchor", {"stream_id": stream_id, "clock_probe_id": op,
                                                                                   "device_ticks": "3000", "monotonic_us": "7"}, epoch=snap["epoch"]))
            assert steal["status"] == "applied"
            with maker() as s:
                assert s.get(CaptureStream, uuid.UUID(stream_id)).clock_uncertain is True
        finally:
            await other.close()
    finally:
        await c.close()


def _active_stream(maker, pid) -> str:
    with maker() as s:
        return str(s.scalar(sa.select(CaptureStream.id).where(CaptureStream.participant_id == pid, CaptureStream.status == "active")))


@pytestmark_ws
async def test_v2_회차에_hello_없는_구_클라이언트는_upgrade_required(servers, v2world):
    (srv,) = servers()
    c = await Client(srv, v2world.members[0][0]).connect()
    try:
        r = await c.call("live:join", join_msg(v2world.session_id))
        assert r["code"] == "hello_required"
        h = hello()
        h["supported_protocol_versions"] = [2]
        assert (await c.call("live:hello", h))["ok"]
        assert (await c.call("live:join", join_msg(v2world.session_id)))["ok"]
    finally:
        await c.close()


def test_v2_회차에_X_Live_Protocol_없는_구_클라이언트의_v1_REST는_426이고_부작용_0(api, maker, v2world):
    uid, pid = v2world.members[0]
    r = api.post(f"/api/v1/sessions/{v2world.session_id}/participants/{pid}/raise-hand", headers=_auth(uid))
    assert r.status_code == 426
    with maker() as s:
        assert s.get(SessionParticipant, pid).raise_hand is False
