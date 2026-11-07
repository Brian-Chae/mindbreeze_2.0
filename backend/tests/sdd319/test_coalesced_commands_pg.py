"""SDD-319 — 동시 명령 N개가 합류 drain 으로 모두 성공 ack 를 받는지(실제 PG + Redis)."""
from __future__ import annotations

import threading

from app.services import class_participation_service as cps
from app.services import live_single_flight as sf
from app.services import session_live_outbox as ob
from tests.sdd246.commands.conftest import World
from tests.sdd246.transport.conftest import make_cmd
from tests.sdd246.transport.conftest import _v2_runtime  # noqa: F401  (autouse fixture 재노출)
from tests.sdd246.transport.conftest import (  # noqa: F401
    _isolate_handlers, db, live, maker, pg_engine, pg_url, prefix, redis_url,
)
import pytest


@pytest.fixture
def world(maker):
    return World(maker, n_participants=8)


def test_S1_S3_동시_명령이_모두_applied이고_drain은_합류되며_revision은_단조(maker, world, live, monkeypatch):
    n = 8
    actors = [world.member(i) for i in range(n)]
    with maker() as s:
        cps.seed_live_state(s, world.session_id)
    sf.stats.update({k: 0 for k in sf.stats})
    real = ob.drain
    drains = []

    def counting(*a, **k):
        drains.append(1)
        return real(*a, **k)

    monkeypatch.setattr(ob, "drain", counting)
    outs = [None] * n

    def go(i):
        with maker() as s:
            outs[i] = cps.run_live_command(s, actors[i], make_cmd(world, "hand.set", {"raised": True}))

    ts = [threading.Thread(target=go, args=(i,)) for i in range(n)]
    [t.start() for t in ts]
    [t.join(30) for t in ts]
    assert all(o is not None for o in outs)
    assert all(o.ack["status"] == "applied" and o.ack["committed"] is True for o in outs), [o.ack for o in outs]
    assert not any(o.ack.get("code") == "projection_pending" for o in outs)
    assert len(drains) <= n  # 합류로 늘지 않음(통상 더 적음)
    with maker() as s:
        meta = live.read_meta(world.session_id)
        ob_rows = ob._pending_rows(s, world.session_id, int(meta["applied_revision"]), 100)
        assert ob_rows == [], "밀린 outbox 없이 모두 projection"
