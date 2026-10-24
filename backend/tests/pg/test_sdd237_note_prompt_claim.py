"""SDD-237 B1/S21: 진행 기록 안내 claim 의 PG 원자성 — 동시 요청 중 정확히 1건만 show=True."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from sqlalchemy.orm import Session as DBSession

from app.models.session import Session
from app.services import class_summary_service as svc
from tests.pg.sdd216_helpers import world

pytestmark = pytest.mark.pg


def _seed(pg_engine):
    with DBSession(pg_engine) as seed:
        org, host, _other, parent = world(seed)
        row = Session(type="meditation", host_id=host.id, class_id=parent.id, seq=1,
                      status="completed", host_state="assigned", duration_min=60)
        seed.add(row)
        seed.commit()
        return host.id, row.id


def test_동시_claim_8개_중_정확히_1개만_true(pg_engine):
    host_id, session_id = _seed(pg_engine)
    n = 8
    barrier = Barrier(n)

    def run():
        with DBSession(pg_engine) as db:
            barrier.wait(timeout=10)
            return svc.claim_note_prompt(db, session_id, host_id)

    with ThreadPoolExecutor(max_workers=n) as pool:
        results = [f.result(timeout=30) for f in [pool.submit(run) for _ in range(n)]]
    assert results.count(True) == 1
    with DBSession(pg_engine) as db:
        assert db.get(Session, session_id).note_prompt_seen_at is not None


def test_dismiss_동시_호출도_같은_시각(pg_engine):
    host_id, session_id = _seed(pg_engine)
    barrier = Barrier(4)

    def run():
        with DBSession(pg_engine) as db:
            barrier.wait(timeout=10)
            return svc.dismiss_note_prompt(db, session_id, host_id)

    with ThreadPoolExecutor(max_workers=4) as pool:
        results = [f.result(timeout=30) for f in [pool.submit(run) for _ in range(4)]]
    assert len({r for r in results}) == 1
