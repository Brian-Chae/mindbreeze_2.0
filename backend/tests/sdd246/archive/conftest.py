"""SDD-246 T09 — archive 시험용 실제 PostgreSQL 하네스(T03 하네스와 DB 이름만 다르다).

SQLite 로 동시성 증거를 대체하지 않는다. 로컬 PG(기본 postgresql://localhost/postgres 관리 접속)에 임시 DB 를 만들어
`alembic upgrade head` 를 적용하고 세션 종료 때 지운다. 로컬 호스트만 허용(dev DB 접속 금지).
환경변수 SDD246_PG_ADMIN_URL 로 관리 접속 URL 을 바꿀 수 있다.
"""
from __future__ import annotations

import os
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest
import sqlalchemy as sa
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session as OrmSession, sessionmaker

BACKEND = Path(__file__).parents[3]
ALLOWED_HOSTS = {"127.0.0.1", "localhost", "::1", None}


@pytest.fixture(scope="session")
def pg_url():
    admin_url = os.environ.get("SDD246_PG_ADMIN_URL", "postgresql://localhost/postgres")
    url = make_url(admin_url)
    assert url.host in ALLOWED_HOSTS, f"로컬 PG 에만 연결한다(host={url.host})"
    admin = sa.create_engine(url, isolation_level="AUTOCOMMIT")
    try:
        with admin.connect() as c:
            c.execute(sa.text("select 1"))
    except Exception as exc:  # noqa: BLE001
        admin.dispose()
        pytest.skip(f"로컬 PostgreSQL 에 연결할 수 없다: {exc.__class__.__name__}")
    name = f"sdd246_t09_{os.getpid()}"
    with admin.connect() as c:
        c.execute(sa.text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        c.execute(sa.text(f'CREATE DATABASE "{name}"'))
    target = url.set(database=name, drivername="postgresql").render_as_string(hide_password=False)
    env = {**os.environ, "DATABASE_URL": target}
    proc = subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], cwd=BACKEND, env=env,
                          capture_output=True, text=True)
    assert proc.returncode == 0, f"alembic upgrade head 실패:\n{proc.stdout}\n{proc.stderr}"
    yield target
    with admin.connect() as c:
        c.execute(sa.text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
    admin.dispose()


@pytest.fixture(scope="session")
def pg_engine(pg_url):
    engine = sa.create_engine(pg_url, pool_size=20, max_overflow=20)
    yield engine
    engine.dispose()


@pytest.fixture
def maker(pg_engine):
    return sessionmaker(bind=pg_engine, autoflush=False)


@pytest.fixture
def db(maker):
    s = maker()
    yield s
    s.rollback()
    s.close()


class World:
    """합성 데이터(회차 1, 호스트 1, 참가자 N) — 테스트마다 새로 만들어 서로 간섭하지 않는다."""

    def __init__(self, maker, n_participants: int = 2):
        from app.models.session import Session, SessionParticipant
        from app.models.user import User

        self.maker = maker
        with maker() as s:
            host = User(email=f"host-{uuid.uuid4().hex[:10]}@example.test", password_hash="x", name="h", role="counselor")
            s.add(host)
            s.flush()
            from app.models.class_program import Class, ClassInstructor
            parent = Class(created_by=host.id, title="합성 명상", default_duration_min=30)
            s.add(parent)
            s.flush()
            s.add(ClassInstructor(class_id=parent.id, user_id=host.id, role="lead"))
            s.flush()
            sess = Session(host_id=host.id, class_id=parent.id, seq=1, host_state="assigned", type="meditation", duration_min=30, status="in_progress",
                           participant_mode="group", max_participants=20)
            s.add(sess)
            s.flush()
            parts = []
            for i in range(n_participants):
                u = User(email=f"m{i}-{uuid.uuid4().hex[:10]}@example.test", password_hash="x", name=f"m{i}", role="client")
                s.add(u)
                s.flush()
                p = SessionParticipant(session_id=sess.id, user_id=u.id, eeg_collection_consented=True)
                s.add(p)
                parts.append((u.id, p))
            s.flush()
            self.host_id, self.session_id = host.id, sess.id
            self.members = [(uid, p.id) for uid, p in parts]
            s.commit()

    def host(self):
        from app.services.session_live_commands import Actor
        return Actor(actor_id=self.host_id, role="host")

    def member(self, i: int = 0):
        from app.services.session_live_commands import Actor
        uid, pid = self.members[i]
        return Actor(actor_id=uid, role="member", participant_id=pid)


@pytest.fixture
def world(maker):
    return World(maker)


@pytest.fixture(autouse=True)
def _isolate_handlers():
    """테스트가 등록한 handler 가 다른 테스트로 새지 않게 레지스트리를 저장·복원한다."""
    from app.services import session_live_commands as slc

    saved = dict(slc._HANDLERS)
    yield
    slc._HANDLERS.clear()
    slc._HANDLERS.update(saved)
