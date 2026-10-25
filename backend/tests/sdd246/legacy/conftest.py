"""SDD-246 T10 — 실제 PostgreSQL 하네스(T03 와 같은 방식, 임시 DB 이름만 분리).

T03 conftest 의 임시 DB 이름과 겹치면 서로 `DROP DATABASE ... FORCE` 하므로 `sdd246_t10_<pid>` 를 쓴다.
로컬 호스트만 허용한다(dev DB 접속 금지).
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest
import sqlalchemy as sa
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

from tests.sdd246.commands.conftest import World  # noqa: F401  (합성 회차 팩토리 재사용)

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
    name = f"sdd246_t10_{os.getpid()}"
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
