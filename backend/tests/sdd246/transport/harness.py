"""WS 시험 하네스: 서브프로세스 서버 기동 + python-socketio AsyncClient 헬퍼."""
from __future__ import annotations

import asyncio
import os
import socket
import subprocess
import sys
import time
import uuid
from pathlib import Path

import socketio

BACKEND = Path(__file__).parents[3]
NS = "/session-live"
SECRET = "sdd246-test-secret-not-for-prod-0123456789"


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Server:
    def __init__(self, pg_url: str, redis_url: str, prefix: str, channel: str, *, heartbeat_s: float = 0.4, flag: str = "1"):
        self.port = free_port()
        env = {**os.environ, "DATABASE_URL": pg_url, "REDIS_URL": redis_url, "SOCKETIO_REDIS_CHANNEL": channel,
               "LIVE_REDIS_URL": redis_url, "LIVE_REDIS_PREFIX": prefix, "JWT_SECRET_KEY": SECRET,
               "LIVE_PROTOCOL_V2": flag, "LIVE_V2_HEARTBEAT_S": str(heartbeat_s), "PYTHONPATH": os.environ.get("PYTHONPATH", ".")}
        env.pop("PYTEST_CURRENT_TEST", None)
        self.proc = subprocess.Popen([sys.executable, "-m", "tests.sdd246.transport.server_app", str(self.port)], cwd=BACKEND, env=env,
                                     stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        deadline = time.time() + 40
        while time.time() < deadline:
            if self.proc.poll() is not None:
                raise RuntimeError(f"서버 기동 실패:\n{self.proc.stdout.read()}")
            try:
                with socket.create_connection(("127.0.0.1", self.port), timeout=0.3):
                    break
            except OSError:
                time.sleep(0.15)
        else:
            raise RuntimeError("서버 기동 시간 초과")

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def stop(self) -> None:
        self.proc.terminate()
        try:
            self.proc.wait(timeout=8)
        except subprocess.TimeoutExpired:
            self.proc.kill()


def token_for(user_id, *, expired: bool = False, minutes: int = 60) -> str:
    from datetime import datetime, timedelta, timezone
    from jose import jwt

    exp = datetime.now(timezone.utc) + (timedelta(seconds=-5) if expired else timedelta(minutes=minutes))
    return jwt.encode({"sub": str(user_id), "exp": exp, "type": "access"}, SECRET, algorithm="HS256")


def hello(caps=("paint_ack", "http_fallback")) -> dict:
    return {"protocol_version": 2, "schema_version": 1, "supported_protocol_versions": [1, 2], "app_build": "test",
            "client_instance_id": str(uuid.uuid4()), "capabilities": list(caps), "core_version": None}


def join_msg(session_id, *, gen="1", cred=None) -> dict:
    return {"protocol_version": 2, "schema_version": 1, "session_id": str(session_id), "request_id": str(uuid.uuid4()),
            "generation": gen, "last_cursors": [], "entry_credential": cred}


class Client:
    """이벤트를 모두 기록하는 AsyncClient 래퍼."""

    def __init__(self, server: Server, user_id, *, token: str | None = None):
        self.server, self.user_id = server, user_id
        self.sio = socketio.AsyncClient(reconnection=False)
        self.events: list[tuple[str, dict]] = []
        self._token = token

    async def connect(self):
        for name in ("live:snapshot", "live:event", "live:sync_complete", "live:heartbeat", "live:access_revoked", "live:terminal",
                     "live:resync_required", "live:degraded", "live:auth_expired", "waiting_room_reminder"):
            self.sio.on(name, self._rec(name), namespace=NS)
        await self.sio.connect(self.server.url, namespaces=[NS], socketio_path="socket.io", transports=["websocket"],
                               auth={"token": self._token or token_for(self.user_id)}, wait_timeout=10)
        return self

    def _rec(self, name):
        async def h(data=None):
            self.events.append((name, data))
        return h

    async def call(self, event: str, data, timeout: float = 10):
        return await self.sio.call(event, data, namespace=NS, timeout=timeout)

    def of(self, name: str) -> list[dict]:
        return [d for n, d in self.events if n == name]

    async def wait_for(self, name: str, pred=lambda d: True, timeout: float = 8.0):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            for n, d in self.events:
                if n == name and pred(d):
                    return d
            await asyncio.sleep(0.03)
        raise AssertionError(f"{name} 미수신 (받은 이벤트: {[n for n, _ in self.events]})")

    async def join_ready(self, session_id, *, caps=("paint_ack",)):
        r = await self.call("live:hello", hello(caps))
        assert r.get("ok"), r
        r = await self.call("live:join", join_msg(session_id))
        assert r.get("ok"), r
        snap = await self.wait_for("live:snapshot")
        await self.wait_for("live:sync_complete")
        r = await self.call("live:applied", {"snapshot_id": snap["snapshot_id"]})
        assert r["state"] == "READY", r
        return snap

    async def close(self):
        if self.sio.connected:
            await self.sio.disconnect()
