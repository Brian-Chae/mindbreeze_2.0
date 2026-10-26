"""SDD-214 Z1 — 데이터 초기화 절차를 합성 PG DB 에서 검증한다 (ZR-2~ZR-7).

실제 dev·prod 는 절대 건드리지 않는다. `scratch_db` 가 만든 임시 DB 에서만 실행한다.
  삭제(scope all) → alembic upgrade head(055 가드 통과) → 재시드 → 로그인 해시 확인
"""

from __future__ import annotations

import importlib.util
import json
import os
import re
import subprocess
import sys
import uuid
from collections.abc import Iterator

import pytest
import sqlalchemy as sa
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.orm import Session as OrmSession

from app.core.security import verify_password
from app.services import dev_data_reset as dr
from tests.pg.conftest import BACKEND, alembic_ok
from tests.pg.test_sdd214_schema import _db_name, mk_participant, mk_session, mk_user

pytestmark = pytest.mark.pg

PREV = "e036a0000052"
SEED_PASSWORD = "Synthetic-pw-1!"  # 합성 값 — 실제 계정 비밀번호가 아니다


@pytest.fixture(scope="session")
def pg_engine() -> Iterator[Engine]:
    """conftest 의 pg_engine 을 재정의: 유닉스 소켓(호스트 없음)의 로컬 임시 PG 도 허용한다."""
    if os.environ.get("PG_SMOKE") != "1" or not os.environ.get("DATABASE_URL", "").startswith("postgresql"):
        pytest.skip("PG_SMOKE=1 이고 DATABASE_URL 이 PostgreSQL 일 때만 실행한다")
    parsed = make_url(os.environ["DATABASE_URL"])
    assert parsed.host in (None, "127.0.0.1", "localhost", "::1"), f"로컬 DB 에만 연결한다(host={parsed.host})"
    # 소켓 경로(host=/…)는 URL 에 '%2F' 로 인코딩되어 alembic env.py(configparser 보간)가 거부한다.
    # 쿼리를 libpq 환경변수(PGHOST/PGPORT)로 옮기고 URL 은 깨끗하게 유지한다 — alembic·CLI 하위 프로세스도 상속.
    saved = {k: os.environ.get(k) for k in ("PGHOST", "PGPORT")}
    if "host" in parsed.query:
        os.environ["PGHOST"] = str(parsed.query["host"])
    if "port" in parsed.query:
        os.environ["PGPORT"] = str(parsed.query["port"])
    engine = sa.create_engine(parsed.set(query={}))
    yield engine
    engine.dispose()
    for key, val in saved.items():
        if val is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = val


@pytest.fixture(scope="module")
def t052_url(scratch_db) -> str:
    url = scratch_db("rst052")
    alembic_ok(url, "upgrade", PREV)
    return url


def _load_script(name: str):
    path = BACKEND / "scripts" / f"{name}.py"
    spec = importlib.util.spec_from_file_location(f"_script_{name}", path)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _app_tables(engine: Engine) -> list[str]:
    with engine.connect() as c:
        return [t for t in sa.inspect(c).get_table_names() if t != "alembic_version"]


def _counts(engine: Engine) -> dict[str, int]:
    with engine.connect() as c:
        return {t: c.execute(sa.text(f'select count(*) from "{t}"')).scalar_one() for t in _app_tables(engine)}


def _seed_synthetic(engine: Engine) -> None:
    """합성 데이터: 사용자 2 · 기관 1 · 비템플릿 세션 1 · 참여자 1 (실데이터 아님)."""
    with engine.begin() as c:
        counselor = mk_user(c, "cns")
        client = mk_user(c, "cli")
        c.execute(sa.text("INSERT INTO organizations (id, name, org_code, verified) VALUES (:i, '합성기관', 'SYN001', true)"),
                  {"i": str(uuid.uuid4())})
        sid = mk_session(c, counselor)
        mk_participant(c, sid, user_id=client)


@pytest.fixture
def synthetic_db(scratch_db, t052_url) -> Iterator[tuple[str, Engine]]:
    url = scratch_db(f"rst_{uuid.uuid4().hex[:6]}", template=_db_name(t052_url))
    engine = sa.create_engine(url)
    _seed_synthetic(engine)
    yield url, engine
    engine.dispose()


# ── 서비스 계층 ───────────────────────────────────────────────────────────────


def test_dry_run_은_건수만_돌려주고_아무것도_지우지_않는다(synthetic_db):
    _, engine = synthetic_db
    before = _counts(engine)
    report = dr.reset_database(engine, scope="all", apply=False)
    assert _counts(engine) == before
    assert report.applied is False
    assert report.table_counts["sessions"] == 1
    assert report.table_counts["users"] == 2


def test_scope_all_삭제_후_055_가드를_통과한다(synthetic_db):
    url, engine = synthetic_db
    assert _counts(engine)["sessions"] == 1
    report = dr.reset_database(engine, scope="all", apply=True)
    assert report.applied is True
    assert set(_counts(engine).values()) == {0}
    with engine.connect() as c:
        assert c.execute(sa.text("select version_num from alembic_version")).scalars().all() == [PREV]
    alembic_ok(url, "upgrade", "head")


def test_재실행은_변경_0_이고_오류가_없다(synthetic_db):
    _, engine = synthetic_db
    dr.reset_database(engine, scope="all", apply=True)
    again = dr.reset_database(engine, scope="all", apply=True)
    assert sum(again.table_counts.values()) == 0
    assert set(_counts(engine).values()) == {0}


def test_scope_sessions_는_계정_기관을_보존하고_세션_계열만_비운다(synthetic_db):
    url, engine = synthetic_db
    dr.reset_database(engine, scope="sessions", apply=True)
    after = _counts(engine)
    assert after["users"] == 2 and after["organizations"] == 1
    for table in ("sessions", "session_participants", "reports", "notifications"):
        assert after[table] == 0
    alembic_ok(url, "upgrade", "head")


def test_scope_sessions_는_분류되지_않은_테이블이_있으면_삭제_전에_거부한다(synthetic_db):
    _, engine = synthetic_db
    with engine.begin() as c:
        c.execute(sa.text("create table zz_unclassified (id int primary key)"))
    before = _counts(engine)
    with pytest.raises(dr.ResetGuardError, match="zz_unclassified"):
        dr.reset_database(engine, scope="sessions", apply=True)
    assert _counts(engine) == before


def test_보존_테이블이_삭제_테이블을_참조하면_삭제_전에_거부한다(synthetic_db):
    _, engine = synthetic_db
    with engine.begin() as c:
        c.execute(sa.text("create table zz_keep (id int primary key, session_id uuid references sessions(id))"))
    keep = dr.SESSIONS_SCOPE_KEEP | {"zz_keep"}
    before = _counts(engine)
    with pytest.raises(dr.ResetGuardError, match="zz_keep"):
        dr.reset_database(engine, scope="sessions", apply=True, keep_tables=keep)
    assert _counts(engine) == before


# ── 재시드 ────────────────────────────────────────────────────────────────────


def test_삭제_직후_052_에서_재시드해도_head_적용_후_로그인_해시가_유효하고_재실행은_멱등이다(synthetic_db, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "environment", "test")
    url, engine = synthetic_db
    dr.reset_database(engine, scope="all", apply=True)
    seed = _load_script("seed_test_accounts")
    with OrmSession(engine) as db:  # 배포 전(052 스키마)에 시드 — 계정은 055 가드 대상이 아니다
        first = seed.seed_test_accounts(db, SEED_PASSWORD)
        db.commit()
    alembic_ok(url, "upgrade", "head")
    with OrmSession(engine) as db:
        second = seed.seed_test_accounts(db, SEED_PASSWORD)
        db.commit()
    assert first == {"created": 3, "updated": 0} and second == {"created": 0, "updated": 3}
    with engine.connect() as c:
        rows = dict(c.execute(sa.text(
            "select email, password_hash from users where email in ('counselor@test.com','client@test.com','orgadmin@test.com')"
        )).all())
        roles = dict(c.execute(sa.text("select email, role from users")).all())
    assert set(rows) == {"counselor@test.com", "client@test.com", "orgadmin@test.com"}
    assert all(verify_password(SEED_PASSWORD, h) for h in rows.values())
    assert roles == {"counselor@test.com": "counselor", "client@test.com": "client",
                     "orgadmin@test.com": "org_admin"}


def test_시드는_비밀번호가_없으면_거부한다(monkeypatch):
    monkeypatch.delenv("TEST_ACCOUNTS_PASSWORD", raising=False)
    seed = _load_script("seed_test_accounts")
    with pytest.raises(SystemExit):
        seed.main([])


# ── CLI ──────────────────────────────────────────────────────────────────────

UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")


def _run_cli(url: str, *args: str) -> subprocess.CompletedProcess[str]:
    env = {**os.environ, "DATABASE_URL": url}
    return subprocess.run(
        [sys.executable, "scripts/reset_dev_data.py", *args], cwd=BACKEND, env=env, capture_output=True, text=True
    )


def test_cli_기본은_dry_run_이며_출력에_개인정보와_접속_문자열이_없다(synthetic_db):
    url, engine = synthetic_db
    before = _counts(engine)
    proc = _run_cli(url)
    assert proc.returncode == 0, proc.stderr
    assert _counts(engine) == before
    out = proc.stdout + proc.stderr
    payload = json.loads(proc.stdout)
    assert payload["applied"] is False and payload["tables"]["sessions"] == 1
    assert "@example.com" not in out and not UUID_RE.search(out)
    parsed = make_url(url)
    assert "pgt" not in out and str(parsed.database) not in out and "scratch" not in out


def test_cli_apply_만으로는_삭제하지_않고_실패한다(synthetic_db):
    url, engine = synthetic_db
    before = _counts(engine)
    proc = _run_cli(url, "--apply")
    assert proc.returncode != 0
    assert "i-understand-this-deletes-data" in proc.stderr
    assert _counts(engine) == before


def test_cli_허용되지_않은_호스트는_플래그가_있어도_거부한다(synthetic_db):
    url, _ = synthetic_db
    remote = "postgresql://u:topsecret@db.unknown.example:5432/x"
    proc = _run_cli(remote, "--apply", "--i-understand-this-deletes-data")
    assert proc.returncode != 0
    assert "허용 목록" in proc.stderr
    assert "topsecret" not in proc.stdout + proc.stderr
    assert "postgresql://" not in proc.stdout + proc.stderr


def test_cli_두_플래그가_모두_있으면_삭제한다(synthetic_db):
    url, engine = synthetic_db
    proc = _run_cli(url, "--apply", "--i-understand-this-deletes-data")
    assert proc.returncode == 0, proc.stderr
    assert set(_counts(engine).values()) == {0}
    assert json.loads(proc.stdout)["applied"] is True


@pytest.mark.parametrize("with_audit", [False, True])
def test_sdd217_sessions_초기화는_운영행만_정리하고_감사와_FK가드를_보존한다(scratch_db, with_audit):
    """새057 임시DB 전용. 감사 유무 각각 FK차단·dry-run·apply·trigger 보존을 검사한다."""
    from datetime import datetime, timedelta, timezone
    from sqlalchemy.exc import DBAPIError
    from app.models.class_program import ClassMember
    from app.models.class_membership import (
        ClassAttendanceEvent, ClassGuestCredential, ClassGuestJoinOperation, ClassGuestMerge,
        ClassGuestRecovery, ClassMakeupAssignment, ClassMemberConsentEvent,
        ClassMemberOperation, SessionPresenceLease,
    )
    from tests.pg.test_sdd217_schema import _rows

    url = scratch_db(f"reset217_{int(with_audit)}")
    alembic_ok(url, "upgrade", "head")
    engine = sa.create_engine(url)
    audit_tables = ("class_attendance_events", "class_guest_merges", "class_member_consent_events")
    operational = ("class_makeup_assignments", "class_guest_credentials", "class_guest_recoveries",
                   "class_member_operations", "class_guest_join_operations", "session_presence_leases")
    expires = datetime.now(timezone.utc) + timedelta(days=1)
    try:
        with OrmSession(engine) as db:
            cls, host, member, sessions, participants = _rows(db)
            alias = ClassMember(class_id=cls.id, kind="guest", status="removed", joined_via="code")
            db.add(alias); db.flush()
            db.add_all([
                ClassMakeupAssignment(class_id=cls.id, member_id=member.id,
                    source_session_id=sessions[0].id, source_participant_id=participants[0].id,
                    target_session_id=sessions[1].id, target_participant_id=participants[1].id),
                ClassGuestCredential(class_id=cls.id, member_id=member.id, scope="read", expires_at=expires),
                ClassGuestRecovery(class_id=cls.id, member_id=member.id, token_hash="a" * 64,
                    expires_at=expires, issued_by=host.id, reason="합성 본인 확인"),
                ClassMemberOperation(member_id=member.id, operation_key="reset-test", request_hash="b" * 64, result={}),
                ClassGuestJoinOperation(class_id=cls.id, member_id=member.id, operation_key="reset-test", request_hash="c" * 64),
                SessionPresenceLease(id="reset-test-socket", session_id=sessions[0].id,
                    participant_id=participants[0].id, expires_at=expires),
            ])
            if with_audit:
                db.add_all([
                    ClassAttendanceEvent(class_id=cls.id, session_id=sessions[0].id,
                        participant_id=participants[0].id, member_id=member.id, new_status="absent",
                        actor_kind="host", actor_user_id=host.id, operation_key="reset-test"),
                    ClassGuestMerge(class_id=cls.id, source_member_id=alias.id, target_member_id=member.id,
                        actor_user_id=host.id, reason="합성 동일인 확인", preview_fingerprint="d" * 64),
                    ClassMemberConsentEvent(class_id=cls.id, member_id=member.id, choice="research",
                        value=True, notice_version="test-v1", actor_user_id=host.id, operation_key="reset-test"),
                ])
            db.commit()
        before = _counts(engine)
        with engine.connect() as c:
            evidence = {table: c.execute(sa.text(f'SELECT * FROM "{table}" ORDER BY id')).all() for table in audit_tables}
            # 217 감사는 부모 삭제와 독립적으로 보존하는 FK 없는 스키마다.
            assert all(not sa.inspect(c).get_foreign_keys(table) for table in audit_tables)
            revision = c.execute(sa.text('SELECT version_num FROM alembic_version')).scalar_one()
        # 보존 감사에 부모 FK가 추가되면 빈 테이블이어도 삭제 전에 막아야 한다.
        with engine.begin() as c:
            c.execute(sa.text('ALTER TABLE class_attendance_events ADD CONSTRAINT test_reset_owner_fk FOREIGN KEY (class_id) REFERENCES classes(id)'))
        with pytest.raises(dr.ResetGuardError, match="보존 테이블이 삭제 테이블을 참조한다: class_attendance_events"):
            dr.reset_database(engine, scope="sessions", apply=True)
        assert _counts(engine) == before
        with engine.begin() as c:
            c.execute(sa.text('ALTER TABLE class_attendance_events DROP CONSTRAINT test_reset_owner_fk'))
        dry = dr.reset_database(engine, scope="sessions", apply=False)
        assert not dry.applied and _counts(engine) == before
        assert all(dry.table_counts[table] == 1 for table in operational)
        assert not set(audit_tables) & set(dry.table_counts)
        assert dr.reset_database(engine, scope="sessions", apply=True).applied
        after = _counts(engine)
        assert all(after[table] == 0 for table in (*operational, "classes", "class_members", "sessions", "session_participants"))
        assert after["users"] == before["users"] and after["organizations"] == before["organizations"]
        with engine.connect() as c:
            assert c.execute(sa.text('SELECT version_num FROM alembic_version')).scalar_one() == revision
            for table in audit_tables:
                assert c.execute(sa.text(f'SELECT * FROM "{table}" ORDER BY id')).all() == evidence[table]
                assert c.execute(sa.text("SELECT count(*) FROM pg_trigger WHERE tgrelid=CAST(:table AS regclass) AND NOT tgisinternal AND tgenabled='O'"), {"table": table}).scalar_one() == 1
        if with_audit:
            for table in audit_tables:
                for sql in (f'UPDATE "{table}" SET id=id', f'DELETE FROM "{table}"'):
                    with pytest.raises(DBAPIError, match="append-only"), engine.begin() as c:
                        c.execute(sa.text(sql))
        # 재실행도 보존 감사는 건드리지 않는다.
        dr.reset_database(engine, scope="sessions", apply=True)
        assert _counts(engine) == after
    finally:
        engine.dispose()
