"""SDD-289 PG 시험 하네스 — tests/pg 의 로컬 전용 픽스처 재사용 (PG_SMOKE=1, 로컬 DB 한정)."""

from tests.pg.conftest import pg_conn, pg_engine, pg_session  # noqa: F401
