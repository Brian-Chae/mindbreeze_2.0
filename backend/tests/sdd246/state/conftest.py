"""SDD-246 T04 — 실제 PostgreSQL + 실제 Redis 하네스.

PG 하네스(임시 DB, alembic upgrade head)는 T03 conftest 를 그대로 재사용한다. Redis 는 로컬(기본
redis://localhost:6379)의 **별도 DB 번호(11)** 와 테스트별 고유 키 prefix 로 격리하고, 정리는 그 prefix 의 키만
SCAN 삭제한다(FLUSHALL/FLUSHDB 금지). 로컬 호스트만 허용.
"""
from __future__ import annotations

import os
import uuid

import pytest
import redis as redis_lib
from sqlalchemy.engine import make_url

from app.services.live_redis.client import LiveRedis
from tests.sdd246.commands.conftest import (  # noqa: F401  (fixture 재노출)
    World, _isolate_handlers, db, maker, pg_engine, pg_url, world,
)

TEST_REDIS_URL = os.environ.get("SDD246_REDIS_URL", "redis://localhost:6379/11")


@pytest.fixture(scope="session")
def redis_url():
    url = make_url(TEST_REDIS_URL)
    assert url.host in {"127.0.0.1", "localhost", "::1", None}, "로컬 Redis 에만 연결한다"
    assert url.database not in (None, "", "0"), "테스트는 DB 0 을 쓰지 않는다(별도 DB 번호 필요)"
    client = redis_lib.Redis.from_url(TEST_REDIS_URL)
    try:
        client.ping()
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"로컬 Redis 에 연결할 수 없다: {exc.__class__.__name__}")
    finally:
        client.close()
    return TEST_REDIS_URL


@pytest.fixture
def prefix():
    return f"t04test:{uuid.uuid4().hex[:12]}"


@pytest.fixture
def live(redis_url, prefix):
    lr = LiveRedis.from_url(redis_url, prefix=prefix)
    yield lr
    raw = redis_lib.Redis.from_url(redis_url)
    for k in raw.scan_iter(match=f"{prefix}:*", count=500):
        raw.delete(k)
    raw.close()
    lr.r.close()
