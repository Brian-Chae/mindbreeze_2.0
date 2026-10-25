"""SDD-246 T05 — 서로 다른 OS 프로세스(AsyncRedisManager)·remote revoke·REST/WS 동일 command_id (PG + Redis 실제)."""
from __future__ import annotations

import asyncio
import uuid

import pytest
import sqlalchemy as sa
from fastapi.testclient import TestClient

from app.models.live_state import LiveCommandLedger, LiveOutbox
from app.models.session import Session as SessionModel, SessionParticipant
from app.services import class_participation_service as cps
from app.services.session_live_legacy import PROTOCOL_V2, pin_session_protocol
from tests.sdd246.transport.conftest import wire_cmd
from tests.sdd246.transport.harness import Client, Server, SECRET, token_for
from tests.sdd246.transport.test_ws_state_machine_pg import servers, v2world  # noqa: F401

pytestmark = pytest.mark.asyncio(loop_scope="function")


async def test_host와_member가_서로_다른_프로세스에_연결돼도_손들기_왕복이_host에_순서대로_도착한다(servers, v2world):
    a, b = servers(2)  # 같은 Redis 채널(AsyncRedisManager)을 공유하는 두 프로세스
    w = v2world
    host = await Client(a, w.host_id).connect()
    member = await Client(b, w.members[0][0]).connect()
    try:
        await host.join_ready(w.session_id)
        await member.join_ready(w.session_id)
        pid = w.members[0][1]
        for raised in (True, False, True, False):
            ack = await member.call("live:command", wire_cmd(w, "hand.set", {"raised": raised}, epoch=member.of("live:snapshot")[0]["epoch"]))
            assert ack["status"] == "applied", ack
        await host.wait_for("live:event", lambda e: e["domain"] == "speaking" and e["audience"] == "host"
                            and e["entity_id"] == str(pid) and e["payload"]["hand_raised"] is False and int(e["seq"]) >= 4)
        got = [e for e in host.of("live:event") if e["domain"] == "speaking" and e["audience"] == "host"]
        assert [e["payload"]["hand_raised"] for e in got][-4:] == [True, False, True, False]
        seqs = [int(e["seq"]) for e in got]
        assert seqs == sorted(seqs) and len(set(seqs)) == len(seqs), "seq 는 단조 증가·중복 없음"
        # member 는 타인 audience 이벤트를 받지 않는다
        assert all(e["audience"] in ("public", f"member:{pid}") for e in member.of("live:event"))
    finally:
        await host.close()
        await member.close()


async def test_remote_revoke는_다른_프로세스의_member_소켓에도_access_revoked와_room_차단을_적용한다(servers, maker, v2world):
    a, b = servers(2)
    w = v2world
    member = await Client(b, w.members[0][0]).connect()
    try:
        await member.join_ready(w.session_id)
        pid = w.members[0][1]

        def remove():
            with maker() as s:
                import datetime as dt
                p = s.get(SessionParticipant, pid)
                p.removed_at = dt.datetime.now(dt.timezone.utc)
                s.commit()
                cps.emit_participant_removed(s, s.get(SessionModel, w.session_id), p)
                s.commit()

        await asyncio.to_thread(remove)
        # 제거를 일으킨 쪽은 프로세스 a 가 아닌 외부(REST). 방송은 어느 프로세스든 한 번 돌리면 모든 worker 에 전파된다.
        host = await Client(a, w.host_id).connect()
        await host.call("live:hello", {"protocol_version": 2, "schema_version": 1, "supported_protocol_versions": [2], "app_build": "t",
                                       "client_instance_id": str(uuid.uuid4()), "capabilities": [], "core_version": None})
        await host.call("live:join", {"protocol_version": 2, "schema_version": 1, "session_id": str(w.session_id),
                                      "request_id": str(uuid.uuid4()), "generation": "1", "last_cursors": [], "entry_credential": None})
        await member.wait_for("live:access_revoked", timeout=10)
        # 회수 후 member 명령은 다른 프로세스 상태와 무관하게 거절
        ack = await member.call("live:command", wire_cmd(w, "hand.set", {"raised": True}))
        assert ack["status"] == "rejected" and ack["code"] in ("access_revoked", "forbidden")
        with maker() as s:
            assert s.get(SessionParticipant, pid, execution_options={"include_removed": True}).raise_hand is False
        await host.close()
    finally:
        await member.close()


async def test_REST와_WS가_같은_command_id를_보내면_부작용은_한번이다(servers, maker, v2world, monkeypatch):
    (srv,) = servers()
    w = v2world
    uid, pid = w.members[0]
    member = await Client(srv, uid).connect()
    try:
        snap = await member.join_ready(w.session_id)
        cid = uuid.uuid4()
        env = wire_cmd(w, "hand.set", {"raised": True}, command_id=cid, epoch=snap["epoch"])
        ws_ack = await member.call("live:command", env)
        assert ws_ack["status"] == "applied"
        # 같은 command_id 를 REST 로 재전송(다른 연결·다른 전송) → duplicate, 부작용 증가 없음
        from app.main import app
        from app.core.database import get_db

        def _db():
            s = maker()
            try:
                yield s
            finally:
                s.close()

        from app.config import settings
        monkeypatch.setattr(settings, "jwt_secret_key", SECRET)
        app.dependency_overrides[get_db] = _db
        try:
            def post():
                tc = TestClient(app)  # lifespan 없이(백그라운드 poll 루프 기동 안 함)
                if True:
                    return tc.post(f"/api/v1/sessions/{w.session_id}/live-v2/commands", json=env,
                                   headers={"Authorization": f"Bearer {token_for(uid)}"})
            r = await asyncio.to_thread(post)
        finally:
            app.dependency_overrides.pop(get_db, None)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "duplicate" and r.json()["committed"] is True
        with maker() as s:
            n = s.scalar(sa.select(sa.func.count()).select_from(LiveOutbox).where(LiveOutbox.command_id == cid))
            l = s.scalar(sa.select(sa.func.count()).select_from(LiveCommandLedger).where(LiveCommandLedger.command_id == cid))
        assert (n, l) == (1, 1)
    finally:
        await member.close()
