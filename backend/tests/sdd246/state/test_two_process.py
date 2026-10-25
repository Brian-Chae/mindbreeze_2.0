"""SDD-246 T04 — 두 OS 프로세스 + 실제 Redis/PG: 동시 projector, 한쪽 kill(-9) 후 인계, snapshot 일관성."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest
import redis as redis_lib

from app.services.live_redis import keys
from app.services.live_redis.client import LiveRedis
from app.services.session_live_state import LiveStateService, Scope
from tests.sdd246.state.helpers import install_hand_handler, send

BACKEND = Path(__file__).parents[3]

WORKER = r"""
import sys, time, uuid
import sqlalchemy as sa
from sqlalchemy.orm import sessionmaker
from app.services.live_redis.client import LiveRedis
from app.services import session_live_outbox as ob
pg, rurl, prefix, sid, mode = sys.argv[1:6]
sid = uuid.UUID(sid)
live = LiveRedis.from_url(rurl, prefix=prefix)
db = sessionmaker(bind=sa.create_engine(pg))()
hooks = None
if mode == "hang_after_redis":
    def hang(row):
        if row.revision == 10:
            print("HANG", flush=True)
            time.sleep(600)
    hooks = ob.Hooks(after_redis=hang)
res = ob.drain(db, live, sid, wait_s=15.0, hooks=hooks)
print("DONE", res.projected, res.duplicates, res.applied_revision, flush=True)
"""


def _spawn(pg_url, redis_url, prefix, sid, mode="normal"):
    env = {**os.environ, "PYTHONPATH": os.pathsep.join(filter(None, [str(BACKEND), os.environ.get("PYTHONPATH", "")])),
           "DATABASE_URL": pg_url}
    return subprocess.Popen([sys.executable, "-c", WORKER, pg_url, redis_url, prefix, str(sid), mode], cwd=BACKEND,
                            env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)


@pytest.fixture(autouse=True)
def _handler():
    install_hand_handler()


def test_두_프로세스_동시_projection_exactly_once(world, pg_url, redis_url, live, prefix):
    N = 60
    for i in range(N):
        send(world, i % 2, ver=i // 2 + 1)
    procs = [_spawn(pg_url, redis_url, prefix, world.session_id) for _ in range(2)]
    outs = [p.communicate(timeout=60) for p in procs]
    assert all(p.returncode == 0 for p in procs), outs
    done = [o[0].strip().split() for o in outs]
    assert sum(int(d[1]) for d in done) == N, done
    host_seq = int(live.r.get(keys.seq(live.prefix, world.session_id, "host", "speaking")))
    assert host_seq == N
    xs = live.r.xrange(keys.events(live.prefix, world.session_id, "host", "speaking"))
    assert len({e[1]["event_id"] for e in xs}) == N  # event_id 중복 없음


def test_projector_kill9_후_다른_프로세스가_이어받고_중복_없음(world, maker, pg_url, redis_url, live, prefix):
    N = 20
    for i in range(N):
        send(world, 0, ver=i + 1)
    victim = _spawn(pg_url, redis_url, prefix, world.session_id, "hang_after_redis")
    deadline = time.time() + 30
    line = ""
    while time.time() < deadline and "HANG" not in line:
        line = victim.stdout.readline()
    assert "HANG" in line, victim.stderr.read() if victim.poll() is not None else "no hang"
    assert int(live.r.get(keys.seq(live.prefix, world.session_id, "host", "speaking"))) == 10  # rev10 은 Redis 반영됨
    victim.kill()  # kill -9: DB 표기 전 사망
    victim.wait()
    live.r.delete(keys.lock(live.prefix, world.session_id))  # 락 TTL 만료와 동일
    takeover = _spawn(pg_url, redis_url, prefix, world.session_id)
    out, err = takeover.communicate(timeout=60)
    assert takeover.returncode == 0, err
    parts = out.strip().split()
    assert int(parts[1]) == N - 10 and int(parts[3]) == N
    assert int(live.r.get(keys.seq(live.prefix, world.session_id, "host", "speaking"))) == N  # rev10 이중 반영 없음


def test_두_프로세스_Redis_소실후_단일_재구축(world, maker, pg_url, redis_url, live, prefix):
    send(world, 0, ver=1, with_session=True)
    send(world, 1, ver=1)
    procs = [_spawn(pg_url, redis_url, prefix, world.session_id)]
    procs[0].communicate(timeout=60)
    raw = redis_lib.Redis.from_url(redis_url)
    for k in raw.scan_iter(match=f"{prefix}:*"):
        raw.delete(k)
    raw.close()
    procs = [_spawn(pg_url, redis_url, prefix, world.session_id) for _ in range(3)]
    outs = [p.communicate(timeout=60) for p in procs]
    assert all(p.returncode == 0 for p in procs), outs
    meta = live.read_meta(world.session_id)
    assert meta["epoch"] == "2" and meta["status"] == "active"
    snap = LiveStateService(live).snapshot(world.session_id, Scope("host"))
    assert snap["epoch"] == "2" and len(snap["speaking"]["entities"]) == 2
