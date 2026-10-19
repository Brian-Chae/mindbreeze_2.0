"""V-17/19/23/25/41/45: 별도 연결·동시 시작·최종 불변식 검증."""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from threading import Barrier
from uuid import uuid4

import pytest
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session as DBSession

from app.models.class_program import Class, ClassInstructor, ClassMember
from app.models.class_scheduling import ClassEffect, SessionHostRequest
from app.models.record import Report
from app.models.session import Session
from app.models.user import User
from app.schemas.class_scheduling import (
    MembersCommand,
    ResolveHostCommand,
    WriteCommand,
)
from tests.pg.sdd216_helpers import user, world
from tests.pg.test_sdd216_review_regressions import setup_class
from tests.pg.test_sdd216_write import NOW

pytestmark = pytest.mark.pg


def race(engine, *actions):
    barrier = Barrier(len(actions))

    def run(action):
        with DBSession(engine) as db:
            db.execute(text("SET LOCAL lock_timeout='5s'"))
            barrier.wait(timeout=10)
            try:
                result = action(db)
                db.commit()
                return 200, result
            except HTTPException as exc:
                db.rollback()
                return exc.status_code, exc.detail

    with ThreadPoolExecutor(max_workers=len(actions)) as pool:
        futures = [pool.submit(run, action) for action in actions]
        return [future.result(timeout=20) for future in futures]


@pytest.fixture
def frozen(monkeypatch):
    from app.api.v1 import classes
    from app.services import report_service, session_service

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return NOW

    monkeypatch.setattr(classes, "datetime", Clock)
    monkeypatch.setattr(session_service, "_now", lambda: NOW)
    monkeypatch.setattr(session_service, "_notify_session_state", lambda *args: None)
    monkeypatch.setattr(
        report_service, "_enqueue_client_email_on_approval", lambda *args: None
    )


def test_two_lead_removals_keep_one_lead(pg_engine):
    from app.api.v1.classes import remove_instructor

    with DBSession(pg_engine) as db:
        org, a, b, cls = world(db)
        admin = user(db, org, role="org_admin")
        db.add(ClassInstructor(class_id=cls.id, user_id=b.id, role="lead"))
        ids = cls.id, a.id, b.id, admin.id, cls.revision
        db.commit()
    cid, aid, bid, admin_id, revision = ids

    def remove(target):
        return lambda db: remove_instructor(
            cid,
            target,
            WriteCommand(
                operation_key=str(uuid4()),
                expected_revision=revision,
                reason="합성 경합",
            ),
            {"id": str(admin_id)},
            db,
        )

    results = race(pg_engine, remove(aid), remove(bid))
    assert sorted(code for code, _ in results) == [200, 409]
    with DBSession(pg_engine) as db:
        assert (
            db.query(ClassInstructor)
            .filter_by(class_id=cid, role="lead", status="active")
            .count()
            == 1
        )


def test_last_seat_two_invites_never_overfill(pg_engine, frozen):
    from app.api.v1.classes import invite_members

    with DBSession(pg_engine) as db:
        a, b, cls, _ = setup_class(db)
        cls.capacity = 1
        members = [user(db, role="client").id for _ in range(2)]
        cid, aid, revision = cls.id, a.id, cls.revision
        db.commit()

    def invite(mid):
        return lambda db: invite_members(
            cid,
            MembersCommand(
                operation_key=str(uuid4()), expected_revision=revision, user_ids=[mid]
            ),
            background_tasks=BackgroundTasks(),
            current_user={"id": str(aid)},
            db=db,
        )

    results = race(pg_engine, *[invite(mid) for mid in members])
    assert sorted(code for code, _ in results) == [200, 409]
    with DBSession(pg_engine) as db:
        assert (
            db.query(ClassMember).filter_by(class_id=cid, status="active").count() == 1
        )
        loser = members[next(i for i, (code, _) in enumerate(results) if code == 409)]
        with pytest.raises(HTTPException) as exc:
            invite_members(
                cid,
                MembersCommand(
                    operation_key=str(uuid4()),
                    expected_revision=db.get(Class, cid).revision,
                    user_ids=[loser],
                ),
                background_tasks=BackgroundTasks(),
                current_user={"id": str(aid)},
                db=db,
            )
        assert exc.value.status_code == 409


def pending_seed(engine):
    from app.services.class_instructor_service import apply_host_request

    with DBSession(engine) as db:
        a, b, cls, rows = setup_class(db)
        row = rows[0]
        row.scheduled_at = NOW + timedelta(minutes=30)
        request = apply_host_request(
            db,
            cls,
            row,
            {"candidate_host_id": b.id, "expected_state_version": row.state_version},
            a,
            NOW,
        )
        ids = cls.id, row.id, a.id, b.id, request.id, cls.revision
        db.commit()
        return ids


def accept_action(ids):
    from app.api.v1.classes import resolve_host

    cid, sid, aid, bid, rid, revision = ids
    return lambda db: resolve_host(
        cid,
        sid,
        rid,
        ResolveHostCommand(
            operation_key=str(uuid4()), expected_revision=revision, action="accept"
        ),
        {"id": str(bid)},
        db,
    )


def test_accept_and_open_cannot_transfer_an_open_session(pg_engine, frozen):
    from app.services.session_service import transition_status

    ids = pending_seed(pg_engine)
    cid, sid, aid, bid, rid, _ = ids
    results = race(
        pg_engine,
        accept_action(ids),
        lambda db: transition_status(str(sid), str(aid), "open", db),
    )
    assert sum(code == 200 for code, _ in results) == 1
    assert all(code in (200, 403, 409) for code, _ in results)
    with DBSession(pg_engine) as db:
        row, request = db.get(Session, sid), db.get(SessionHostRequest, rid)
        if row.status == "open":
            assert row.host_id == aid and request.status == "expired"
        else:
            assert (
                row.status == "scheduled"
                and row.host_id == bid
                and request.status == "accepted"
            )


def test_suspend_candidate_and_accept_never_leave_ineligible_assignment(
    pg_engine, frozen
):
    from app.services.admin_service import suspend_user

    ids = pending_seed(pg_engine)
    cid, sid, aid, bid, rid, _ = ids
    with DBSession(pg_engine) as db:
        admin_id = user(db, role="platform_admin").id
        db.commit()
    results = race(
        pg_engine,
        accept_action(ids),
        lambda db: suspend_user(bid, "합성 동시 정지", admin_id, db),
    )
    assert results[1][0] == 200
    # 정지가 먼저면 부모 비가시 계약에 따라 404다.
    assert results[0][0] in (200, 403, 404, 409)
    with DBSession(pg_engine) as db:
        row = db.get(Session, sid)
        assert db.get(User, bid).status == "suspended"
        assert row.host_id == aid or row.host_state == "needs_reassign"
        assert row.hidden_at is None


def test_approval_and_correction_freeze_approved_owner(pg_engine, frozen):
    from app.services.class_write_service import correct_host
    from app.services.report_service import approve_report

    with DBSession(pg_engine) as db:
        a, b, cls, rows = setup_class(db)
        row = rows[0]
        row.status = "completed"
        report = Report(
            session_id=row.id,
            user_id=a.id,
            type="counselor",
            status="pending_review",
            content={},
        )
        db.add(report)
        db.flush()
        cid, sid, aid, bid, rid = cls.id, row.id, a.id, b.id, report.id
        command = {
            "operation_key": str(uuid4()),
            "expected_revision": cls.revision,
            "session_id": str(sid),
            "expected_state_version": row.state_version,
            "candidate_host_id": str(bid),
            "mode": "correct",
            "reason": "합성 귀속 정정",
        }
        db.commit()
    results = race(
        pg_engine,
        lambda db: approve_report(str(rid), str(aid), db),
        lambda db: correct_host(db, aid, cid, command, NOW),
    )
    # SDD-218 D-36: 주강사는 타인 진행 회차도 대행 승인한다. 따라서 "승인자 == 진행자" 는
    # 더 이상 전제가 아니고, 정정이 먼저 커밋되면 승인은 바뀐 진행자 위에서 성공할 수 있다.
    # 이 테스트가 지키는 것은 **승인 후에는 귀속을 바꿀 수 없다**는 동결 규칙이다.
    assert all(code in (200, 403, 409) for code, _ in results)
    approve_code, correct_code = (code for code, _ in results)
    with DBSession(pg_engine) as db:
        row, report = db.get(Session, sid), db.get(Report, rid)
        # 상담사 리포트의 귀속은 언제나 현재 진행자를 따른다.
        assert row.host_id == report.user_id
        if correct_code == 200:
            # 정정이 이겼다 — 진행자는 b 로 바뀐다.
            assert row.host_id == bid
            if approve_code == 200:
                # 대행 승인: 승인자는 실제 승인자(a)로 남고 진행자로 위장하지 않는다.
                assert report.approved_by_user_id == aid
                assert report.status == "completed"
            else:
                assert report.status == "pending_review"
        else:
            # 승인이 이겼다 — 동결이 걸려 정정은 막힌다.
            assert approve_code == 200
            assert correct_code == 409
            assert row.host_id == aid
            assert report.approved_by_user_id == aid


def test_two_rolling_workers_generate_one_next_week(pg_engine):
    from app.services.class_rolling_service import roll_forward

    with DBSession(pg_engine) as db:
        _, _, cls, rows = setup_class(db, rolling=True)
        cid, original_count = cls.id, len(rows)
        db.commit()
    results = race(
        pg_engine,
        *[lambda db: roll_forward(db, cid, NOW + timedelta(days=7)) for _ in range(2)]
    )
    assert all(code == 200 for code, _ in results)
    assert sum(len(result["session_ids"]) for _, result in results) == 1
    with DBSession(pg_engine) as db:
        rows = db.query(Session).filter_by(class_id=cid).all()
        assert len(rows) == original_count + 1
        assert len({row.seq for row in rows}) == len(rows)
        assert len({row.scheduled_at for row in rows}) == len(rows)
        assert db.query(ClassEffect).filter_by(
            class_id=cid, kind="session_prepare"
        ).count() == len(rows)
