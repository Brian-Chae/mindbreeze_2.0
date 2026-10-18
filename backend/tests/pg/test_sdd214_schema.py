"""SDD-214 Phase 1 스키마 검증 (Task S5): 리비전 e036a0000053~055.

verify 의 SC·MG·CN·RB 항목을 로컬/CI PostgreSQL 에서 증명한다. 임시 DB 는 `scratch_db` 로 만들고 끝에 지운다.
  - t052: 체인을 e036a0000052 까지 적용한 템플릿 DB(이후 복제만 한다 — alembic 재실행 최소화)
  - head: t052 복제 + upgrade head (대부분의 제약 테스트가 사용, 테스트마다 롤백)
"""

from __future__ import annotations

import ast
import importlib.util
import re
import uuid
from collections.abc import Iterator
from pathlib import Path

import pytest
import sqlalchemy as sa
from sqlalchemy.engine import Connection, Engine, make_url
from sqlalchemy.exc import DBAPIError

from tests.pg.conftest import BACKEND, alembic_ok, run_alembic

pytestmark = pytest.mark.pg

REPO = BACKEND.parent
VERSIONS = BACKEND / "alembic" / "versions"
CONTRACT = REPO / "specs" / "sdd-214-class-structure-phase1" / "schema-contract.md"
PREV = "e036a0000052"
REVS = {"053": "e036a0000053", "054": "e036a0000054", "055": "e036a0000055"}
HEAD = REVS["055"]

NEW_TABLES = {
    "classes", "class_instructors", "class_members", "class_member_events",
    "counseling_guests", "counseling_relationships", "counseling_relationship_counselors",
    "counseling_relationship_events", "guest_claim_events", "session_host_history",
}
ADDED_COLUMNS = {
    "sessions": {"class_id", "counseling_relationship_id", "seq", "session_kind", "host_state"},
    "session_participants": {
        "member_id", "guest_client_id", "attendance_status", "attendance_kind",
        "makeup_for_session_id", "attendance_marked_by", "absence_reason",
    },
    "reports": {"approved_by_user_id", "approved_at"},
}
TOUCHED_TABLES = NEW_TABLES | set(ADDED_COLUMNS)


# ── 공통 도구 ────────────────────────────────────────────────────────────────


def _snapshot(engine: Engine) -> dict[str, list]:
    q = {
        "columns": """select table_name, column_name, data_type, udt_name, character_maximum_length, is_nullable,
                      column_default from information_schema.columns where table_schema='public'
                      order by table_name, column_name""",
        "constraints": """select conrelid::regclass::text, conname, pg_get_constraintdef(oid)
                          from pg_constraint where connamespace='public'::regnamespace order by 1, 2""",
        "indexes": "select tablename, indexname, indexdef from pg_indexes where schemaname='public' order by 1, 2",
    }
    with engine.connect() as c:
        return {k: [tuple(r) for r in c.execute(sa.text(v))] for k, v in q.items()}


def _db_name(url: str) -> str:
    name = make_url(url).database
    assert name
    return name


@pytest.fixture(scope="module")
def t052_url(scratch_db) -> str:
    url = scratch_db("t052")
    alembic_ok(url, "upgrade", PREV)
    return url


@pytest.fixture(scope="module")
def head_url(scratch_db, t052_url) -> str:
    url = scratch_db("head", template=_db_name(t052_url))
    alembic_ok(url, "upgrade", "head")
    return url


@pytest.fixture(scope="module")
def t052_snapshot(t052_url) -> dict[str, list]:
    engine = sa.create_engine(t052_url)
    try:
        return _snapshot(engine)
    finally:
        engine.dispose()


@pytest.fixture(scope="module")
def head_engine(head_url) -> Iterator[Engine]:
    engine = sa.create_engine(head_url)
    yield engine
    engine.dispose()


@pytest.fixture
def conn(head_engine) -> Iterator[Connection]:
    """테스트마다 바깥 트랜잭션을 열고 끝에 롤백한다."""
    with head_engine.connect() as c:
        outer = c.begin()
        try:
            yield c
        finally:
            if outer.is_active:
                outer.rollback()


def _uid() -> str:
    return str(uuid.uuid4())


def mk_user(c: Connection, tag: str = "u") -> str:
    uid = _uid()
    c.execute(sa.text(
        "INSERT INTO users (id, email, password_hash, name, role, verified_tier) "
        "VALUES (:id, :email, 'x', '테스트', 'counselor', 'email')"
    ), {"id": uid, "email": f"{tag}-{uid[:8]}@example.com"})
    return uid


def mk_class(c: Connection, creator: str, **over) -> str:
    cid = _uid()
    fields = {"id": cid, "created_by": creator, "default_duration_min": 50, **over}
    cols = ", ".join(fields)
    vals = ", ".join(f":{k}" for k in fields)
    c.execute(sa.text(f"INSERT INTO classes ({cols}) VALUES ({vals})"), fields)
    return cid


def mk_instructor(c: Connection, class_id: str, user_id: str, **over) -> str:
    iid = _uid()
    fields = {"id": iid, "class_id": class_id, "user_id": user_id, **over}
    c.execute(sa.text(
        f"INSERT INTO class_instructors ({', '.join(fields)}) VALUES ({', '.join(':' + k for k in fields)})"
    ), fields)
    return iid


def mk_relationship(c: Connection, counselor: str, **over) -> str:
    rid = _uid()
    fields = {"id": rid, "counselor_id": counselor, "is_placeholder": True, **over}
    c.execute(sa.text(
        f"INSERT INTO counseling_relationships ({', '.join(fields)}) VALUES ({', '.join(':' + k for k in fields)})"
    ), fields)
    return rid


def mk_rel_counselor(c: Connection, relationship_id: str, counselor: str) -> None:
    c.execute(sa.text(
        "INSERT INTO counseling_relationship_counselors (id, relationship_id, counselor_id) VALUES (:id, :r, :c)"
    ), {"id": _uid(), "r": relationship_id, "c": counselor})


def mk_session(c: Connection, host: str, **over) -> str:
    sid = _uid()
    fields = {
        "id": sid, "type": "meditation", "status": "scheduled", "host_id": host,
        "duration_min": 50, "max_participants": 10, **over,
    }
    c.execute(sa.text(
        f"INSERT INTO sessions ({', '.join(fields)}) VALUES ({', '.join(':' + k for k in fields)})"
    ), fields)
    return sid


def mk_class_session(c: Connection, class_id: str, host: str, seq: int = 1, **over) -> str:
    return mk_session(c, host, class_id=class_id, seq=seq, host_state="assigned", **over)


def mk_member(c: Connection, class_id: str, user_id: str | None = None) -> str:
    mid = _uid()
    c.execute(sa.text(
        "INSERT INTO class_members (id, class_id, user_id, kind, status, joined_via) "
        "VALUES (:id, :cid, :uid, :kind, 'active', 'host_invite')"
    ), {"id": mid, "cid": class_id, "uid": user_id, "kind": "member" if user_id else "guest"})
    return mid


def mk_participant(c: Connection, session_id: str, **over) -> str:
    pid = _uid()
    fields = {
        "id": pid, "session_id": session_id, "band_connected": False,
        "consent_audio": False, "consent_eeg": False, **over,
    }
    c.execute(sa.text(
        f"INSERT INTO session_participants ({', '.join(fields)}) VALUES ({', '.join(':' + k for k in fields)})"
    ), fields)
    return pid


def violation(c: Connection, fn, code: str, name: str | None = None) -> None:
    """savepoint 안에서 fn() 이 지정 SQLSTATE(와 제약 이름)로 실패하는지 확인한다."""
    with pytest.raises(DBAPIError) as raised:
        with c.begin_nested():
            fn()
    assert getattr(raised.value.orig, "pgcode", None) == code, str(raised.value.orig)
    if name is not None:
        assert getattr(raised.value.orig.diag, "constraint_name", None) == name, str(raised.value.orig)


# ── 계약 문서 파싱 (SC-1) ────────────────────────────────────────────────────


def _parse_contract() -> tuple[dict[str, dict[str, tuple]], dict[str, dict[str, str]]]:
    """schema-contract.md → (테이블별 컬럼 정의, 테이블별 제약·인덱스 이름→종류)."""
    columns: dict[str, dict[str, tuple]] = {}
    objects: dict[str, dict[str, str]] = {}
    table: str | None = None
    kind: str | None = None  # "col" | "obj"
    for line in CONTRACT.read_text(encoding="utf-8").splitlines():
        m = re.match(r"^### `(\w+)`", line)
        if m:
            table, kind = m.group(1), None
            columns.setdefault(table, {})
            objects.setdefault(table, {})
            continue
        if line.startswith("| 컬럼 |"):
            kind = "col"
            continue
        if line.startswith("| 이름 |"):
            kind = "obj"
            continue
        if not line.startswith("| `") or table is None or kind is None:
            if line.strip() == "" and kind is not None:
                kind = None
            continue
        cells = [x.strip() for x in line.strip().strip("|").split("|")]
        if kind == "col":
            name = cells[0].strip("`")
            columns[table][name] = (cells[1], cells[2], cells[3])
        else:
            objects[table][cells[0].strip("`")] = cells[1]
    return columns, objects


def _norm_type(data_type: str, udt: str, length: int | None) -> str:
    if data_type == "character varying":
        return f"varchar({length})"
    return {
        "uuid": "uuid", "text": "text", "integer": "int", "boolean": "bool",
        "timestamp with time zone": "timestamptz", "date": "date", "jsonb": "jsonb",
    }.get(data_type, f"?{data_type}/{udt}")


def _norm_default(raw: str | None) -> str:
    if raw is None:
        return "-"
    return re.sub(r"::[a-z ]+(\[\])?", "", raw)


# ── MG-1 · MG-5 · MG-9 · MG-10 · G4: 정적 검사 ─────────────────────────────


def _rev_file(num: str) -> Path:
    return next(VERSIONS.glob(f"e036a0000{num}_*.py"))


def test_단일_head_와_체인(request):
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND / "alembic"))
    script = ScriptDirectory.from_config(cfg)
    assert script.get_heads() == [HEAD]
    assert script.get_revision(REVS["053"]).down_revision == PREV
    assert script.get_revision(REVS["054"]).down_revision == REVS["053"]
    assert script.get_revision(REVS["055"]).down_revision == REVS["054"]
    assert not list(VERSIONS.glob("e036a0000056_*.py")) and not list(VERSIONS.glob("e036a0000057_*.py"))


def _upgrade_node(path: Path) -> ast.FunctionDef:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    return next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "upgrade")


@pytest.mark.parametrize("num", ["053", "054", "055"])
def test_리비전_정적_규칙(num):
    path = _rev_file(num)
    src = path.read_text(encoding="utf-8")
    up = _upgrade_node(path)
    # MG-9: 첫 문장이 lock_timeout
    first = up.body[0]
    assert "SET LOCAL lock_timeout" in ast.get_source_segment(src, first)
    # G4/TD3: 파괴적 op·SQL 없음
    assert not re.search(r"op\.(drop_\w+|alter_column)", ast.get_source_segment(src, up))
    # MG-9: CREATE TABLE/INDEX 는 IF NOT EXISTS
    upgrade_src = ast.get_source_segment(src, up)
    for stmt in re.findall(r"CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)\s+(?!IF NOT EXISTS)\w+", upgrade_src):
        pytest.fail(f"IF NOT EXISTS 없는 DDL: {stmt}")
    assert not re.search(r"ADD\s+COLUMN\s+(?!IF NOT EXISTS)", upgrade_src)
    # MG-10: downgrade 경고 문구
    assert "빈 환경" in (ast.get_docstring(ast.parse(src)) or "")


@pytest.mark.parametrize("num", ["053", "054", "055"])
def test_check_migrations_파괴적_아님(num):
    spec = importlib.util.spec_from_file_location("check_migrations", REPO / "deploy" / "ci" / "check_migrations.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    rev = mod.parse_revision(_rev_file(num))
    assert rev["warnings"] == []


# ── SC: 스키마 모양 ──────────────────────────────────────────────────────────


def test_신규_테이블은_정확히_10개이고_금지_테이블은_없다(head_engine, t052_snapshot):
    snap = _snapshot(head_engine)
    before = {r[0] for r in t052_snapshot["columns"]}
    after = {r[0] for r in snap["columns"]}
    assert after - before == NEW_TABLES
    assert not ({"class_templates", "session_migration_map"} & after)


def test_기존_테이블_컬럼은_변경_없이_지정_컬럼만_추가된다(head_engine, t052_snapshot):
    snap = _snapshot(head_engine)
    old = {(r[0], r[1]): r for r in t052_snapshot["columns"]}
    new = {(r[0], r[1]): r for r in snap["columns"]}
    for key, row in old.items():
        assert new[key] == row, f"기존 컬럼 변경: {key}"
    added: dict[str, set[str]] = {}
    for (t, c) in new.keys() - old.keys():
        if t not in NEW_TABLES:
            added.setdefault(t, set()).add(c)
    assert added == ADDED_COLUMNS
    cols = {(r[0], r[1]): r for r in snap["columns"]}
    assert cols[("sessions", "session_kind")][5] == "NO"
    for name in ("class_id", "counseling_relationship_id", "seq", "host_state"):
        assert cols[("sessions", name)][5] == "YES"


def test_컬럼_확정표와_카탈로그가_일치한다(head_engine):
    columns, _ = _parse_contract()
    snap = _snapshot(head_engine)
    actual: dict[str, dict[str, tuple]] = {}
    for table, col, data_type, udt, length, nullable, default in snap["columns"]:
        actual.setdefault(table, {})[col] = (
            _norm_type(data_type, udt, length), "NN" if nullable == "NO" else "NULL", _norm_default(default),
        )
    assert set(columns) == TOUCHED_TABLES
    for table, expected in columns.items():
        for col, (typ, nul, default) in expected.items():
            assert actual[table].get(col) is not None, f"{table}.{col} 없음"
            a_typ, a_nul, a_def = actual[table][col]
            assert (a_typ, a_nul) == (typ, nul), f"{table}.{col}: {(a_typ, a_nul)} != {(typ, nul)}"
            want = default.strip("'") if default != "-" else "-"
            got = a_def.strip("'") if a_def != "-" else "-"
            assert got == want, f"{table}.{col} 기본값: {a_def} != {default}"
        if table in NEW_TABLES:
            assert set(actual[table]) == set(expected), f"{table} 컬럼 집합 불일치"


def test_제약_인덱스_이름이_확정표와_일치한다(head_engine):
    _, objects = _parse_contract()
    snap = _snapshot(head_engine)
    cons = {(r[0], r[1]) for r in snap["constraints"]}
    idxs = {(r[0], r[1]) for r in snap["indexes"]}
    for table, objs in objects.items():
        for name in objs:
            assert (table, name) in cons or (table, name) in idxs, f"{table}.{name} 없음"
    for table in NEW_TABLES:
        listed = set(objects[table])
        found = {n for t, n in cons if t == table and not n.endswith("_pkey")}
        found |= {n for t, n in idxs if t == table and not n.endswith("_pkey")}
        # CHECK 의 NOT NULL 자동 제약(pg_constraint 에는 없음)은 제외하고, 이름 있는 객체가 모두 표에 있어야 한다
        assert found == listed, f"{table}: 표에 없는 객체 {found - listed}, 카탈로그에 없는 객체 {listed - found}"


def test_FK_삭제_규칙(head_engine):
    _, objects = _parse_contract()
    with head_engine.connect() as c:
        rows = {r[0]: r[1] for r in c.execute(sa.text(
            "select conname, confdeltype from pg_constraint where contype='f' and connamespace='public'::regnamespace"
        ))}
    # 표의 정의 텍스트가 아니라 SC-5 규칙(부모 FK=RESTRICT, 세션 선택 참조=SET NULL, 나머지 NO ACTION)을 이름으로 검증
    restrict = {
        "fk_class_instructors_class_id", "fk_class_members_class_id", "fk_sessions_class_id",
        "fk_sessions_counseling_relationship_id", "fk_sessions_class_host", "fk_sessions_relationship_host",
        "fk_session_participants_member_id", "fk_session_participants_guest_client_id",
        "fk_counseling_relationships_client_guest_id", "fk_counseling_relationships_predecessor",
        "fk_rel_counselors_relationship_id",
    }
    set_null = {
        "fk_class_instructors_scope_session_id", "fk_class_members_first_session_id",
        "fk_session_participants_makeup_for", "fk_counseling_relationships_link_id",
    }
    for name, kind in ((n, k) for t, objs in objects.items() for n, k in objs.items() if k.startswith("FK")):
        want = "r" if name in restrict else "n" if name in set_null else "a"
        assert rows[name] == want, f"{name}: {rows[name]} != {want}"
    assert rows["fk_reports_approved_by_user_id"] == "a"


def test_모든_제약이_유효_상태다(head_engine):
    with head_engine.connect() as c:
        bad = c.execute(sa.text(
            "select conrelid::regclass::text, conname from pg_constraint "
            "where connamespace='public'::regnamespace and not convalidated"
        )).all()
    assert bad == []


def test_ORM_메타데이터에_CHECK_와_복합_FK_가_없다():
    from app.core.database import Base
    from app.models import Session  # noqa: F401

    table = Base.metadata.tables["sessions"]
    names = {c.name for c in table.constraints}
    assert "ck_sessions_one_parent" not in names
    assert not [fk for fk in table.foreign_key_constraints if len(fk.columns) > 1]
    from sqlalchemy import CheckConstraint

    new_tables = [Base.metadata.tables[t] for t in NEW_TABLES]
    assert not [c for t in [table, *new_tables] for c in t.constraints if isinstance(c, CheckConstraint)]


# ── CN: 제약 동작 ────────────────────────────────────────────────────────────


def test_ck_sessions_one_parent(conn):
    host = mk_user(conn)
    klass = mk_class(conn, host)
    mk_instructor(conn, klass, host)
    rel = mk_relationship(conn, host)
    mk_rel_counselor(conn, rel, host)

    violation(conn, lambda: mk_session(conn, host, seq=1, host_state="assigned"), "23514", "ck_sessions_one_parent")
    violation(
        conn,
        lambda: mk_session(conn, host, class_id=klass, counseling_relationship_id=rel, seq=1, host_state="assigned"),
        "23514", "ck_sessions_one_parent",
    )
    mk_session(conn, host, class_id=klass, seq=1, host_state="assigned")
    violation(conn, lambda: mk_session(conn, host, class_id=klass, host_state="assigned"), "23514", "ck_sessions_one_parent")
    violation(conn, lambda: mk_session(conn, host, class_id=klass, seq=2), "23514", "ck_sessions_one_parent")
    mk_session(conn, host, counseling_relationship_id=rel, seq=1, host_state="assigned")
    mk_session(conn, host, is_template=True)
    mk_session(conn, host, is_template=True)


def test_복합_FK_진행자는_해당_부모의_담당자여야_한다(conn):
    host = mk_user(conn)
    other = mk_user(conn)
    klass = mk_class(conn, host)
    mk_instructor(conn, klass, host)
    rel = mk_relationship(conn, host)
    mk_rel_counselor(conn, rel, host)

    violation(conn, lambda: mk_class_session(conn, klass, other), "23503", "fk_sessions_class_host")
    violation(
        conn,
        lambda: mk_session(conn, other, counseling_relationship_id=rel, seq=1, host_state="assigned"),
        "23503", "fk_sessions_relationship_host",
    )
    sid = mk_class_session(conn, klass, host)
    violation(
        conn,
        lambda: conn.execute(sa.text("UPDATE sessions SET host_id = :h WHERE id = :s"), {"h": other, "s": sid}),
        "23503", "fk_sessions_class_host",
    )


def test_세션_회차_번호는_부모_안에서_유일하다(conn):
    host = mk_user(conn)
    c1, c2 = mk_class(conn, host), mk_class(conn, host)
    mk_instructor(conn, c1, host)
    mk_instructor(conn, c2, host)
    rel = mk_relationship(conn, host)
    mk_rel_counselor(conn, rel, host)

    mk_class_session(conn, c1, host, seq=1)
    violation(conn, lambda: mk_class_session(conn, c1, host, seq=1), "23505", "uq_sessions_class_seq")
    mk_class_session(conn, c2, host, seq=1)
    mk_session(conn, host, counseling_relationship_id=rel, seq=1, host_state="assigned")
    violation(
        conn,
        lambda: mk_session(conn, host, counseling_relationship_id=rel, seq=1, host_state="assigned"),
        "23505", "uq_sessions_relationship_seq",
    )


def test_출석_행_멤버_유일과_배타_체크(conn):
    host = mk_user(conn)
    klass = mk_class(conn, host)
    mk_instructor(conn, klass, host)
    sid = mk_class_session(conn, klass, host)
    member = mk_member(conn, klass, host)
    guest = _uid()
    conn.execute(sa.text(
        "INSERT INTO counseling_guests (id, created_by_counselor_id, display_name) VALUES (:id, :c, '비회원')"
    ), {"id": guest, "c": host})

    mk_participant(conn, sid, member_id=member)
    violation(conn, lambda: mk_participant(conn, sid, member_id=member), "23505", "uq_session_participants_session_member")
    mk_participant(conn, sid)
    mk_participant(conn, sid)
    mk_participant(conn, sid, guest_client_id=guest)
    violation(
        conn,
        lambda: mk_participant(conn, sid, member_id=mk_member(conn, klass, mk_user(conn)), guest_client_id=guest),
        "23514", "ck_session_participants_one_identity",
    )


def test_클래스_코드_부분_유니크(conn):
    host = mk_user(conn)
    mk_class(conn, host, access_code="4821")
    violation(conn, lambda: mk_class(conn, host, access_code="4821"), "23505", "uq_classes_active_access_code")
    mk_class(conn, host, access_code="4821", status="completed")
    mk_class(conn, host, access_code="4821", status="cancelled")
    mk_class(conn, host, access_code="4821", status="archived")
    mk_class(conn, host, access_code="4821", hidden_at="2026-01-01T00:00:00Z")


def test_클래스_강사_유일과_상태_제약(conn):
    host = mk_user(conn)
    klass = mk_class(conn, host)
    mk_instructor(conn, klass, host)
    violation(conn, lambda: mk_instructor(conn, klass, host), "23505", "uq_class_instructors_class_user")
    violation(conn, lambda: mk_instructor(conn, klass, mk_user(conn), status="deleted"), "23514", "ck_class_instructors_status")
    violation(conn, lambda: mk_class(conn, host, status="unknown"), "23514", "ck_classes_status")


def test_상담_관계_부분_유니크(conn):
    counselor = mk_user(conn)
    client = mk_user(conn)
    guest_a, guest_b = _uid(), _uid()
    for g in (guest_a, guest_b):
        conn.execute(sa.text(
            "INSERT INTO counseling_guests (id, created_by_counselor_id, display_name) VALUES (:id, :c, '비회원')"
        ), {"id": g, "c": counselor})

    mk_relationship(conn, counselor)
    violation(conn, lambda: mk_relationship(conn, counselor), "23505", "uq_rel_placeholder")
    mk_relationship(conn, mk_user(conn))

    first = mk_relationship(conn, counselor, is_placeholder=False, client_user_id=client, status="active")
    violation(
        conn, lambda: mk_relationship(conn, counselor, is_placeholder=False, client_user_id=client, status="active"),
        "23505", "uq_rel_active_pair",
    )
    mk_relationship(conn, counselor, is_placeholder=False, client_user_id=client, status="closed")
    mk_relationship(conn, counselor, is_placeholder=False, client_user_id=client, status="archived")
    assert first

    mk_relationship(conn, counselor, is_placeholder=False, client_guest_id=guest_a, status="pending")
    violation(
        conn, lambda: mk_relationship(conn, mk_user(conn), is_placeholder=False, client_guest_id=guest_a),
        "23505", "uq_rel_guest",
    )
    mk_relationship(conn, counselor, is_placeholder=False, client_guest_id=guest_b)


def test_상담_관계_내담자_체크(conn):
    counselor = mk_user(conn)
    violation(conn, lambda: mk_relationship(conn, counselor, is_placeholder=False), "23514", "ck_rel_client")
    violation(
        conn, lambda: mk_relationship(conn, counselor, is_placeholder=True, client_user_id=mk_user(conn)),
        "23514", "ck_rel_client",
    )


def test_비회원_이메일은_상담사_단위로_유일하다(conn):
    a, b = mk_user(conn), mk_user(conn)

    def guest(counselor: str, email: str = "g@example.com", **over) -> None:
        fields = {"id": _uid(), "created_by_counselor_id": counselor, "display_name": "비회원", "email_norm": email, **over}
        conn.execute(sa.text(
            f"INSERT INTO counseling_guests ({', '.join(fields)}) VALUES ({', '.join(':' + k for k in fields)})"
        ), fields)

    guest(a)
    violation(conn, lambda: guest(a), "23505", "uq_guest_email_per_counselor")
    guest(b)
    guest(a, pii_scrubbed_at="2026-01-01T00:00:00Z", display_name=None)
    violation(conn, lambda: guest(a, "h@example.com", display_name=None), "23514", "ck_counseling_guests_name")


def test_soft_삭제_컬럼이_존재한다(head_engine):
    insp = sa.inspect(head_engine)
    assert "status" in {c["name"] for c in insp.get_columns("class_instructors")}
    assert "hidden_at" in {c["name"] for c in insp.get_columns("classes")}
    assert "hidden_at" in {c["name"] for c in insp.get_columns("counseling_relationships")}


# ── 숨김 필터 (SC-11, TD17) ──────────────────────────────────────────────────


def test_숨김_클래스와_상담_관계는_기본_조회에서_제외된다(head_engine):
    from sqlalchemy.orm import Session as OrmSession

    from app.models.class_program import Class
    from app.models.counseling import CounselingRelationship

    with head_engine.connect() as c:
        outer = c.begin()
        try:
            host = mk_user(c)
            visible = mk_class(c, host, title="보임")
            hidden = mk_class(c, host, title="숨김", hidden_at="2026-01-01T00:00:00Z")
            rel_visible = mk_relationship(c, host)
            rel_hidden = mk_relationship(c, mk_user(c), hidden_at="2026-01-01T00:00:00Z")
            with OrmSession(bind=c, join_transaction_mode="create_savepoint") as s:
                ids = {str(x.id) for x in s.query(Class).all()}
                assert visible in ids and hidden not in ids
                all_ids = {str(x.id) for x in s.query(Class).execution_options(include_hidden=True).all()}
                assert {visible, hidden} <= all_ids
                rel_ids = {str(x.id) for x in s.query(CounselingRelationship).all()}
                assert rel_visible in rel_ids and rel_hidden not in rel_ids
                rel_all = {str(x.id) for x in s.query(CounselingRelationship).execution_options(include_hidden=True).all()}
                assert {rel_visible, rel_hidden} <= rel_all
        finally:
            outer.rollback()


def test_이력_모델은_수정_삭제가_금지된다():
    from app.models.class_program import ClassMemberEvent
    from app.models.counseling import CounselingRelationshipEvent, GuestClaimEvent
    from app.models.session_parent import SessionHostHistory

    for model in (ClassMemberEvent, CounselingRelationshipEvent, GuestClaimEvent, SessionHostHistory):
        assert model.__mapper__.dispatch.before_update, model.__name__
        assert model.__mapper__.dispatch.before_delete, model.__name__


# ── MG: 마이그레이션 동작 ────────────────────────────────────────────────────


def test_가드_비템플릿_세션이_있으면_055에서_중단되고_변경이_없다(scratch_db, t052_url):
    url = scratch_db("guard", template=_db_name(t052_url))
    engine = sa.create_engine(url)
    with engine.begin() as c:
        host = mk_user(c)
        mk_session(c, host)
    proc = run_alembic(url, "upgrade", "head")
    assert proc.returncode != 0
    assert "데이터 초기화" in proc.stderr + proc.stdout
    with engine.connect() as c:
        assert c.execute(sa.text("select version_num from alembic_version")).scalars().all() == [PREV]
        names = set(sa.inspect(c).get_table_names())
    engine.dispose()
    assert not (NEW_TABLES & names)


def test_템플릿만_있으면_통과하고_기존_컬럼_값이_보존된다(scratch_db, t052_url):
    url = scratch_db("tpl", template=_db_name(t052_url))
    engine = sa.create_engine(url)
    with engine.begin() as c:
        host = mk_user(c)
        sid = mk_session(c, host, is_template=True, title="템플릿")
        old_cols = [r[0] for r in c.execute(sa.text(
            "select column_name from information_schema.columns where table_name='sessions' order by ordinal_position"
        ))]
    row_hash = (
        "select md5(row(" + ", ".join(f's."{x}"' for x in old_cols) + ")::text) from sessions s where id = :i"
    )
    with engine.connect() as c:
        before = c.execute(sa.text(row_hash), {"i": sid}).scalar_one()
    alembic_ok(url, "upgrade", "head")
    with engine.connect() as c:
        after = c.execute(sa.text(row_hash), {"i": sid}).scalar_one()
        parent = c.execute(sa.text(
            "select class_id, counseling_relationship_id, seq, host_state, session_kind from sessions where id = :i"
        ), {"i": sid}).one()
    engine.dispose()
    assert after == before
    assert tuple(parent) == (None, None, None, None, "regular")


def test_멱등_upgrade_downgrade_upgrade(scratch_db, t052_url):
    url = scratch_db("idem", template=_db_name(t052_url))
    engine = sa.create_engine(url)
    alembic_ok(url, "upgrade", "head")
    first = _snapshot(engine)
    alembic_ok(url, "downgrade", PREV)
    mid = _snapshot(engine)
    alembic_ok(url, "upgrade", "head")
    second = _snapshot(engine)
    engine.dispose()
    assert NEW_TABLES <= {r[0] for r in first["columns"]}
    assert not (NEW_TABLES & {r[0] for r in mid["columns"]})
    assert first == second
    # RB-1: downgrade 후 스키마는 052 시점과 같다(신규 테이블·컬럼·제약만 제거, 기존 것은 그대로)
    t052 = sa.create_engine(t052_url)
    try:
        assert mid == _snapshot(t052)
    finally:
        t052.dispose()


def test_이미_적용된_스키마에_리비전을_다시_실행해도_같다(scratch_db, t052_url):
    url = scratch_db("rerun", template=_db_name(t052_url))
    engine = sa.create_engine(url)
    alembic_ok(url, "upgrade", "head")
    full = _snapshot(engine)
    with engine.begin() as c:
        c.execute(sa.text("UPDATE alembic_version SET version_num = :v"), {"v": PREV})
    alembic_ok(url, "upgrade", "head")
    assert _snapshot(engine) == full
    engine.dispose()


def test_일부만_적용된_상태에서도_이어서_적용된다(scratch_db, t052_url):
    url = scratch_db("partial", template=_db_name(t052_url))
    engine = sa.create_engine(url)
    alembic_ok(url, "upgrade", "head")
    full = _snapshot(engine)
    with engine.begin() as c:
        for stmt in (
            "DROP TABLE session_host_history",
            "ALTER TABLE reports DROP COLUMN approved_at",
            "ALTER TABLE sessions DROP CONSTRAINT ck_sessions_session_kind",
            "DROP INDEX ix_session_participants_member_id",
            "DROP TABLE guest_claim_events",
            "DROP INDEX ix_class_members_user_id",
        ):
            c.execute(sa.text(stmt))
        c.execute(sa.text("UPDATE alembic_version SET version_num = :v"), {"v": PREV})
    alembic_ok(url, "upgrade", "head")
    assert _snapshot(engine) == full
    engine.dispose()


def test_덤프_픽스처_복원본에도_head_적용이_된다(scratch_db):
    import subprocess

    fixture = next((BACKEND / "tests" / "fixtures" / "pg").glob("baseline_*.sql"))
    url = scratch_db("dump")
    sql = "\n".join(
        line for line in fixture.read_text(encoding="utf-8").splitlines() if not line.startswith(("\\restrict", "\\unrestrict"))
    )
    proc = subprocess.run(["psql", url, "-X", "-q", "-v", "ON_ERROR_STOP=1"], input=sql, capture_output=True, text=True)
    assert proc.returncode == 0, proc.stderr
    alembic_ok(url, "upgrade", "head")
    engine = sa.create_engine(url)
    with engine.connect() as c:
        assert c.execute(sa.text("select version_num from alembic_version")).scalars().all() == [HEAD]
    engine.dispose()
