"""V-02/08: 실제 FK 거부와 독립 PostgreSQL 두 연결 경합."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4
import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DBSession
from app.models.session import Session
from app.models.class_program import ClassInstructor
from app.services.class_instructor_service import validate_instructor
from fastapi import HTTPException
from tests.pg.sdd216_helpers import world
from tests.pg.test_sdd216_write import command, NOW

pytestmark = pytest.mark.pg


def test_raw_fk_rejects_other_class_host_but_removed_row_needs_app_guard(pg_session):
    org, a, b, parent = world(pg_session)
    row = Session(
        type="meditation",
        host_id=a.id,
        class_id=parent.id,
        seq=1,
        status="scheduled",
        host_state="assigned",
        duration_min=60,
    )
    pg_session.add(row)
    pg_session.flush()
    with pytest.raises(IntegrityError), pg_session.begin_nested():
        pg_session.execute(
            text("UPDATE sessions SET host_id=:host WHERE id=:sid"),
            {"host": b.id, "sid": row.id},
        )
    with pytest.raises(IntegrityError), pg_session.begin_nested():
        pg_session.execute(
            text("UPDATE sessions SET host_id=NULL WHERE id=:sid"), {"sid": row.id}
        )
    instructor = (
        pg_session.query(ClassInstructor)
        .filter(ClassInstructor.class_id == parent.id, ClassInstructor.user_id == a.id)
        .one()
    )
    instructor.status = "removed"
    pg_session.flush()
    pg_session.execute(
        text("UPDATE sessions SET host_id=:host WHERE id=:sid"),
        {"host": a.id, "sid": row.id},
    )
    with pytest.raises(HTTPException) as raised:
        validate_instructor(pg_session, parent, a.id)
    assert raised.value.status_code == 409


def test_two_connections_same_key_create_exactly_one_eight_session_class(pg_engine):
    from app.services.class_write_service import create_class

    with DBSession(pg_engine) as seed:
        org, a, b, parent = world(seed)
        actor_id = a.id
        cmd = command(a)
        seed.commit()
    barrier = Barrier(2)

    def run():
        with DBSession(pg_engine) as db:
            db.execute(text("SET LOCAL lock_timeout='5s'"))
            barrier.wait(timeout=10)
            return create_class(db, actor_id, cmd, now=NOW)

    with ThreadPoolExecutor(max_workers=2) as pool:
        tasks = [pool.submit(run) for _ in range(2)]
        results = [t.result(timeout=20) for t in tasks]
    assert results[0] == results[1]
    with DBSession(pg_engine) as db:
        assert (
            db.query(Session).filter(Session.class_id == results[0]["class_id"]).count()
            == 8
        )
