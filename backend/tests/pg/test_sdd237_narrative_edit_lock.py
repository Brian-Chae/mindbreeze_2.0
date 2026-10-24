"""SDD-237 E10: 서사 수정 동시 요청 — 리포트 행 잠금으로 직렬화, base_edited_at 불일치는 409."""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from threading import Barrier

import pytest
from fastapi import HTTPException
from sqlalchemy.orm import Session as DBSession

from app.models.record import Report
from app.models.session import Session
from app.services import class_report_narrative as nar
from app.services import class_summary_service as svc
from tests.pg.sdd216_helpers import world

pytestmark = pytest.mark.pg

START = datetime(2026, 10, 23, 9, 0, 0, tzinfo=timezone.utc)


def _seed(pg_engine):
    with DBSession(pg_engine) as seed:
        org, host, _o, parent = world(seed)
        s = Session(type="meditation", host_id=host.id, class_id=parent.id, seq=1, status="completed",
                    host_state="assigned", duration_min=45, started_at=START,
                    ended_at=START + timedelta(minutes=45))
        seed.add(s)
        seed.flush()
        rep = Report(session_id=s.id, user_id=host.id, type="counselor", status="pending_review",
                     generation_status="ready", content={"class_report": nar.error_block()})
        seed.add(rep)
        seed.commit()
        return host.id, s.id, rep.id


def test_동시_수정_두_건은_하나만_성공하고_다른_하나는_edit_conflict(pg_engine):
    host_id, session_id, report_id = _seed(pg_engine)
    barrier = Barrier(2)

    def run(label):
        with DBSession(pg_engine) as db:
            barrier.wait(timeout=10)
            try:
                svc.edit_narrative(db, session_id, host_id, field="headline", text=f"문장 {label}",
                                   revert=False, base_edited_at=None, check_base=True)
                return "ok"
            except HTTPException as exc:
                return exc.detail["code"]

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = sorted(f.result(timeout=30) for f in [pool.submit(run, i) for i in range(2)])
    assert results == ["edit_conflict", "ok"]
    with DBSession(pg_engine) as db:
        f = db.get(Report, report_id).content["class_report"]["narrative"]["fields"]["headline"]
        assert f["source"] == "edited" and f["edited_text"] in ("문장 0", "문장 1")


def test_충돌_검사를_하지_않으면_마지막_쓰기가_남고_둘_다_성공(pg_engine):
    host_id, session_id, report_id = _seed(pg_engine)
    barrier = Barrier(2)

    def run(label):
        with DBSession(pg_engine) as db:
            barrier.wait(timeout=10)
            svc.edit_narrative(db, session_id, host_id, field="headline", text=f"문장 {label}",
                               revert=False, base_edited_at=None, check_base=False)
            return "ok"

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert [f.result(timeout=30) for f in [pool.submit(run, i) for i in range(2)]] == ["ok", "ok"]
    with DBSession(pg_engine) as db:
        f = db.get(Report, report_id).content["class_report"]["narrative"]["fields"]["headline"]
        assert f["edited_text"] in ("문장 0", "문장 1")
