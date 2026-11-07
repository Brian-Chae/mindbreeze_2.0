"""SDD-308 ① seed_live_state — 이미 시드된 회차는 epoch 잠금 없이 반환, 동시 첫 입장은 잠금 안에서 재확인(멱등)."""
from __future__ import annotations

import threading
from concurrent.futures import ThreadPoolExecutor

import sqlalchemy as sa

from app.models.live_state import LiveOutbox
from app.services import class_participation_service as cps
from tests.sdd308.helpers import QueryCounter, build_scene


def _outbox(maker, sid, domain):
    with maker() as s:
        return s.scalar(sa.select(sa.func.count()).select_from(LiveOutbox).where(LiveOutbox.session_id == sid, LiveOutbox.domain == domain))


def _locking(statements):
    return [st for st in statements if " FOR UPDATE" in st or " FOR NO KEY UPDATE" in st]


def test_V11_이미_시드되면_잠금_문장이_0개(maker, pg_engine):
    sc = build_scene(maker, 3)
    with maker() as db:
        assert cps.seed_live_state(db, sc.session_id) is True
    with maker() as db, QueryCounter(pg_engine) as qc:
        assert cps.seed_live_state(db, sc.session_id) is False
    assert _locking(qc.statements) == [], qc.statements


def test_V12_동시_40스레드_첫접촉_시드는_정확히_한번(maker):
    sc = build_scene(maker, 5)
    barrier = threading.Barrier(40)

    def run(_):
        with maker() as db:
            barrier.wait()
            return cps.seed_live_state(db, sc.session_id)

    with ThreadPoolExecutor(max_workers=40) as pool:
        results = list(pool.map(run, range(40)))
    assert results.count(True) == 1 and results.count(False) == 39
    assert _outbox(maker, sc.session_id, "session") == 1
    assert _outbox(maker, sc.session_id, "policy") == 1
    assert _outbox(maker, sc.session_id, "participation") == 5
