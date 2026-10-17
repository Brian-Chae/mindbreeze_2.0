"""PostgreSQL 전용 테스트 하네스 (SDD-211 P3).

SQLite create_all 로는 볼 수 없는 PG 제약·마이그레이션 결과를 검증한다. 기본 `pytest -q`(SQLite)에서는 전부 skip 하고,
`PG_SMOKE=1` 이면서 `DATABASE_URL` 이 로컬/서비스 컨테이너의 PostgreSQL 일 때만 실행한다.
대상 DB 는 이미 `alembic upgrade head` 가 끝난 상태여야 한다(CI `backend-pg-smoke` 잡이 먼저 적용).

실행: `PG_SMOKE=1 DATABASE_URL=postgresql://… pytest --confcutdir=tests/pg tests/pg`
(`--confcutdir` 는 SQLite 전용 루트 conftest 를 불러오지 않게 해 최소 패키지만으로 돌게 한다.)
"""

from __future__ import annotations

import os
from collections.abc import Iterator

import pytest
import sqlalchemy as sa
from sqlalchemy.engine import Connection, Engine, make_url
from sqlalchemy.orm import Session as OrmSession

# 개발/운영 DB 에 실수로 붙지 않도록 허용 호스트를 로컬로 제한한다.
ALLOWED_HOSTS = {"127.0.0.1", "localhost", "::1"}


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line("markers", "pg: PostgreSQL 에 연결해야 실행되는 테스트(PG_SMOKE=1)")


def _pg_url() -> str | None:
    if os.environ.get("PG_SMOKE") != "1":
        return None
    url = os.environ.get("DATABASE_URL", "")
    return url if url.startswith("postgresql") else None


@pytest.fixture(scope="session")
def pg_engine() -> Iterator[Engine]:
    url = _pg_url()
    if url is None:
        pytest.skip("PG_SMOKE=1 이고 DATABASE_URL 이 PostgreSQL 일 때만 실행한다")
    host = make_url(url).host
    assert host in ALLOWED_HOSTS, f"PG 테스트는 로컬 DB 에만 연결한다(host={host})"
    engine = sa.create_engine(url)
    yield engine
    engine.dispose()


@pytest.fixture
def pg_conn(pg_engine: Engine) -> Iterator[Connection]:
    """테스트마다 바깥 트랜잭션을 열고 끝에 롤백한다 — DB 에 아무것도 남기지 않는다."""
    with pg_engine.connect() as conn:
        outer = conn.begin()
        try:
            yield conn
        finally:
            outer.rollback()


@pytest.fixture
def pg_session(pg_conn: Connection) -> Iterator[OrmSession]:
    """바깥 트랜잭션에 참여하는 ORM 세션(commit 해도 savepoint 로 처리돼 롤백된다)."""
    session = OrmSession(bind=pg_conn, join_transaction_mode="create_savepoint")
    try:
        yield session
    finally:
        session.close()
