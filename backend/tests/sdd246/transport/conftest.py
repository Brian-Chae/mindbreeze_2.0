"""SDD-246 T05 — transport 시험 하네스: 실제 PostgreSQL + 실제 Redis(격리 DB 11·시험별 prefix).

T03/T04 fixture 를 재사용한다. 로컬 호스트만 허용, FLUSH 미사용.
"""
from __future__ import annotations

import os
import uuid

import pytest

from app.services import class_participation_service as cps
from tests.sdd246.state.conftest import (  # noqa: F401  (fixture 재노출)
    World, _isolate_handlers, db, live, maker, pg_engine, pg_url, prefix, redis_url, world,
)


@pytest.fixture(autouse=True)
def _v2_runtime(live, monkeypatch):
    """운영 handler 등록 + 프로세스 공용 LiveRedis 를 시험용 prefix 로 교체 + 플래그 on."""
    monkeypatch.setenv("LIVE_PROTOCOL_V2", "1")
    cps.register_live_handlers()
    cps.set_live_redis(live)
    yield
    cps.set_live_redis(None)


def make_cmd(world, kind, payload=None, *, command_id=None, target_id=None, **kw):
    from app.services.session_live_commands import LiveCommand

    return LiveCommand(command_id=command_id or uuid.uuid4(), session_id=world.session_id, kind=kind, payload=payload or {},
                       target_id=target_id, **kw)


def wire_cmd(world, kind, payload=None, *, command_id=None, epoch="1", target_id=None, generation="1"):
    """계약 envelope(JSON) — transport 가 받는 형태."""
    body = {"protocol_version": 2, "schema_version": 1, "command_id": str(command_id or uuid.uuid4()),
            "session_id": str(world.session_id), "expected_epoch": epoch, "kind": kind, "client_generation": generation,
            "payload": payload or {}}
    if target_id:
        body["target_id"] = str(target_id)
    return body
