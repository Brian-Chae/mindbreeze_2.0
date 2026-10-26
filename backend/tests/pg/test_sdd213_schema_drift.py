"""SDD-213 드리프트 정리 리비전(e036a0000052) 검증.

로컬 PG 에 임시 DB 2개를 만든다: ① 덤프 픽스처 복원본(dev 모양) ② 빈 DB 에 체인을 `e036a0000051` 까지 적용한 것.
둘 다 NULL·배열 값이 섞인 합성 행을 넣은 뒤 `alembic upgrade head` 하고, 스키마·백필·멱등성을 본다.
"""

from __future__ import annotations

import os
import subprocess
import sys
from collections.abc import Iterator
from pathlib import Path

import pytest
import sqlalchemy as sa
from sqlalchemy.engine import Engine, make_url

pytestmark = pytest.mark.pg

BACKEND = Path(__file__).parents[2]
FIXTURE = next((BACKEND / "tests" / "fixtures" / "pg").glob("baseline_*.sql"))
PREV = "e036a0000051"
REV = "e036a0000052"
DEV_ONLY_COLUMNS = {
    "careers": {"description"},
    "qualifications": {"credential_number", "credential_url", "expires_at", "is_verified"},
}


def _url(base: str, database: str) -> str:
    u = make_url(base).set(database=database, drivername="postgresql")
    return u.render_as_string(hide_password=False)


def _alembic(url: str, *args: str) -> None:
    env = {**os.environ, "DATABASE_URL": url}
    proc = subprocess.run(
        [sys.executable, "-m", "alembic", *args], cwd=BACKEND, env=env, capture_output=True, text=True
    )
    assert proc.returncode == 0, f"alembic {' '.join(args)} 실패:\n{proc.stdout}\n{proc.stderr}"


SEED = """
INSERT INTO users (id, email, password_hash, name, role, verified_tier, auth_provider)
VALUES ('00000000-0000-0000-0000-0000000000a1', 'u1@example.com', 'x', '테스트', 'client', 'email', NULL),
       ('00000000-0000-0000-0000-0000000000a2', 'u2@example.com', 'x', '테스트', 'client', 'email', 'google');
INSERT INTO chat_rooms (id) VALUES ('00000000-0000-0000-0000-0000000000b1');
INSERT INTO careers (id, user_id, organization, created_at, updated_at, is_current)
VALUES ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', NULL, NULL, NULL, NULL);
INSERT INTO qualifications (id, user_id, name, issuer, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', '자격', '기관', NULL, NULL);
"""

# 덤프 DB: read_by 는 jsonb, recipient_count 는 NULL 허용. D-11 컬럼에 값을 넣어 보존을 확인한다.
SEED_DUMP = SEED + """
INSERT INTO chat_messages (id, room_id, type, read_by, recipient_count)
VALUES ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000b1', 'text', '["a","b"]'::jsonb, NULL);
UPDATE careers SET description = '설명 보존' WHERE id = '00000000-0000-0000-0000-0000000000c1';
UPDATE qualifications SET credential_number = 'N-1', is_verified = true WHERE id = '00000000-0000-0000-0000-0000000000d1';
"""

# 체인 DB(0051 시점): read_by 는 varchar(36)[]. careers/qualifications 는 NOT NULL 이라 NULL 시드를 넣지 않는다.
SEED_CHAIN = """
INSERT INTO users (id, email, password_hash, name, role, verified_tier)
VALUES ('00000000-0000-0000-0000-0000000000a1', 'u1@example.com', 'x', '테스트', 'client', 'email');
INSERT INTO chat_rooms (id) VALUES ('00000000-0000-0000-0000-0000000000b1');
INSERT INTO chat_messages (id, room_id, type, read_by, recipient_count)
VALUES ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000b1', 'text', ARRAY['a','b'], 2);
"""


def _snapshot(engine: Engine) -> dict[str, list]:
    q = {
        "columns": """select table_name, column_name, data_type, udt_name, character_maximum_length, is_nullable,
                      column_default from information_schema.columns where table_schema='public'
                      order by table_name, column_name""",
        "constraints": """select conrelid::regclass::text, conname, pg_get_constraintdef(oid)
                          from pg_constraint where connamespace='public'::regnamespace
                          order by 1, 2""",
        "indexes": "select tablename, indexname, indexdef from pg_indexes where schemaname='public' order by 1, 2",
    }
    with engine.connect() as c:
        return {k: [tuple(r) for r in c.execute(sa.text(v))] for k, v in q.items()}


@pytest.fixture(scope="module")
def scratch(pg_engine: Engine) -> Iterator[dict[str, str]]:
    base = pg_engine.url.render_as_string(hide_password=False)
    names = {"dump": f"sdd213_dump_{os.getpid()}", "chain": f"sdd213_chain_{os.getpid()}"}
    admin = pg_engine.execution_options(isolation_level="AUTOCOMMIT")
    with admin.connect() as c:
        for n in names.values():
            c.execute(sa.text(f'DROP DATABASE IF EXISTS "{n}"'))
            c.execute(sa.text(f'CREATE DATABASE "{n}"'))
    urls = {k: _url(base, v) for k, v in names.items()}
    try:
        yield urls
    finally:
        with admin.connect() as c:
            for n in names.values():
                c.execute(sa.text(f'DROP DATABASE IF EXISTS "{n}" WITH (FORCE)'))


def _psql(url: str, sql: str) -> None:
    proc = subprocess.run(
        ["psql", url, "-X", "-q", "-v", "ON_ERROR_STOP=1"], input=sql, capture_output=True, text=True
    )
    assert proc.returncode == 0, proc.stderr


@pytest.fixture(scope="module")
def migrated(scratch: dict[str, str]) -> dict[str, dict]:
    """각 DB 를 0051 상태로 만들고 시드 → head 적용. 적용 전후 스키마 스냅샷을 돌려준다."""
    if subprocess.run(["which", "psql"], capture_output=True).returncode != 0:
        pytest.skip("psql 이 필요하다")
    dump_sql = "\n".join(
        line for line in FIXTURE.read_text(encoding="utf-8").splitlines() if not line.startswith(("\\restrict", "\\unrestrict"))
    )
    _psql(scratch["dump"], dump_sql)
    _psql(scratch["dump"], SEED_DUMP)
    _alembic(scratch["chain"], "upgrade", PREV)
    _psql(scratch["chain"], SEED_CHAIN)

    result: dict[str, dict] = {}
    for key, url in scratch.items():
        engine = sa.create_engine(url)
        before = _snapshot(engine)
        _alembic(url, "upgrade", REV)  # SDD-214 이후 head 는 더 앞서므로 이 리비전까지만 적용한다
        first = _snapshot(engine)
        _alembic(url, "downgrade", PREV)  # downgrade 는 no-op → 리비전 재실행
        _alembic(url, "upgrade", REV)  # SDD-214 이후 head 는 더 앞서므로 이 리비전까지만 적용한다
        second = _snapshot(engine)
        result[key] = {"engine": engine, "before": before, "first": first, "second": second}
    yield result
    for v in result.values():
        v["engine"].dispose()


@pytest.mark.parametrize("key", ["dump", "chain"])
def test_head_가_52_이고_리비전을_두번_적용해도_스키마가_같다(migrated, key):
    r = migrated[key]
    with r["engine"].connect() as c:
        assert c.execute(sa.text("select version_num from alembic_version")).scalars().all() == [REV]
    assert r["first"] == r["second"]


@pytest.mark.parametrize("key", ["dump", "chain"])
def test_두_DB_모두_동일_스키마로_수렴한다(migrated, key):
    other = "chain" if key == "dump" else "dump"
    a, b = migrated[key]["first"], migrated[other]["first"]

    def pick(snap, table_cols):
        return [row for row in snap["columns"] if (row[0], row[1]) in table_cols]

    cols = {
        ("chat_messages", "read_by"), ("chat_messages", "recipient_count"), ("users", "auth_provider"),
        ("careers", "organization"), ("careers", "created_at"), ("careers", "updated_at"), ("careers", "is_current"),
        ("qualifications", "created_at"), ("qualifications", "updated_at"),
        ("qualifications", "name"), ("qualifications", "issuer"),
    }
    assert pick(a, cols) == pick(b, cols)


@pytest.mark.parametrize("key", ["dump", "chain"])
def test_컬럼_타입_NOT_NULL_기본값(migrated, key):
    cols = {(r[0], r[1]): r for r in migrated[key]["first"]["columns"]}
    assert cols[("chat_messages", "read_by")][2] == "jsonb"
    for t, c in [
        ("chat_messages", "recipient_count"), ("users", "auth_provider"),
        ("careers", "organization"), ("careers", "created_at"), ("careers", "updated_at"), ("careers", "is_current"),
        ("qualifications", "created_at"), ("qualifications", "updated_at"),
    ]:
        assert cols[(t, c)][5] == "NO", (t, c)
    assert cols[("qualifications", "name")][4] == 200
    assert cols[("qualifications", "issuer")][4] == 200
    assert cols[("careers", "is_current")][6] == "false"


@pytest.mark.parametrize("key", ["dump", "chain"])
def test_FK_CASCADE_와_인덱스(migrated, key):
    r = migrated[key]
    with r["engine"].connect() as c:
        rows = c.execute(sa.text(
            """select conrelid::regclass::text, confdeltype from pg_constraint
               where contype='f' and confrelid='users'::regclass
                 and conrelid::regclass::text in ('careers','qualifications')"""
        )).all()
    assert sorted(rows) == [("careers", "c"), ("qualifications", "c")]
    names = {row[1] for row in r["first"]["indexes"]}
    assert {"ix_careers_user_id", "ix_qualifications_user_id"} <= names


def test_덤프DB_NULL_백필과_행_보존(migrated):
    with migrated["dump"]["engine"].connect() as c:
        assert c.execute(sa.text("select auth_provider from users order by email")).scalars().all() == ["email", "google"]
        assert c.execute(sa.text("select recipient_count from chat_messages")).scalar_one() == 0
        row = c.execute(sa.text("select organization, is_current, created_at is not null, updated_at is not null from careers")).one()
        assert tuple(row) == ("", False, True, True)
        row = c.execute(sa.text("select created_at is not null, updated_at is not null from qualifications")).one()
        assert tuple(row) == (True, True)
        assert c.execute(sa.text("select read_by from chat_messages")).scalar_one() == ["a", "b"]


def test_체인DB_read_by_배열값_보존(migrated):
    with migrated["chain"]["engine"].connect() as c:
        assert c.execute(sa.text("select read_by, recipient_count from chat_messages")).one() == (["a", "b"], 2)


def test_dev전용_컬럼_5개는_보존된다(migrated):
    with migrated["dump"]["engine"].connect() as c:
        cols = {(r[0], r[1]) for r in migrated["dump"]["first"]["columns"]}
        for table, names in DEV_ONLY_COLUMNS.items():
            for n in names:
                assert (table, n) in cols
        assert c.execute(sa.text("select description from careers")).scalar_one() == "설명 보존"
        assert tuple(c.execute(sa.text("select credential_number, is_verified from qualifications")).one()) == ("N-1", True)
    # 리비전이 dev 전용 컬럼을 건드리지 않았다(전후 컬럼 정의 동일).
    def dev_only(snap):
        return [r for r in snap["columns"] if r[1] in {c for s in DEV_ONLY_COLUMNS.values() for c in s} and r[0] in DEV_ONLY_COLUMNS]
    assert dev_only(migrated["dump"]["before"]) == dev_only(migrated["dump"]["first"])
