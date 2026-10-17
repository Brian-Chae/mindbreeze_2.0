"""SDD-211 P0 — 마이그레이션 `30c1bfbc724f` 멱등화 회귀 (PG-2·PG-3·PG-4 의 DB 없는 부분).

빈 PG 에서의 전체 체인 적용·테이블 수 62 는 CI `backend-pg-smoke` 잡과 `tests/pg/` 가 검증한다.
여기서는 DB 없이 (1) 리비전 id·체인 불변, (2) 오프라인(--sql) 렌더가 원래 문장을 그대로 내는지,
(3) 이미 적용된 상태의 스키마(SQLite)에서 upgrade() 가 중복 생성 없이 통과하고 빠진 컬럼은 채우는지를 확인한다.
"""

from __future__ import annotations

import importlib.util
import subprocess
import sys
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.config import Config
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory

BACKEND = Path(__file__).parents[1]
REVISION = "30c1bfbc724f"
HEAD = "e036a0000051"


def _script() -> ScriptDirectory:
    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND / "alembic"))
    return ScriptDirectory.from_config(cfg)


def _load_module():
    path = next((BACKEND / "alembic" / "versions").glob(f"{REVISION}_*.py"))
    spec = importlib.util.spec_from_file_location("rev_30c1", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_리비전_id와_체인은_그대로다():
    script = _script()
    revisions = list(script.walk_revisions())
    assert len(revisions) == 84
    assert script.get_heads() == [HEAD]
    rev = script.get_revision(REVISION)
    assert rev.down_revision == "d74027f66e1c"
    assert len([r for r in revisions if r.down_revision == REVISION]) == 1


def test_오프라인_렌더는_원래_문장을_모두_낸다():
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", f"d74027f66e1c:{REVISION}", "--sql"],
        cwd=BACKEND, capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stderr
    out = result.stdout
    assert "CREATE TABLE chat_room_participants" in out
    assert "ALTER TABLE careers ADD COLUMN updated_at" in out
    assert "ALTER TABLE qualifications ADD COLUMN updated_at" in out
    assert "ALTER TABLE careers ALTER COLUMN role TYPE VARCHAR(100)" in out
    assert "ALTER TABLE careers ALTER COLUMN is_current SET NOT NULL" in out


def _applied_state_tables(metadata: sa.MetaData) -> None:
    """체인이 앞선 리비전으로 이미 만들어 둔 상태(필요분 4건 중 일부만 빠진 상태)를 흉내 낸다."""
    uuid = sa.String(36)
    sa.Table("users", metadata, sa.Column("id", uuid, primary_key=True), sa.Column("status", sa.String(20)),
             sa.Column("notification_preferences", sa.Text()), sa.Column("auth_provider", sa.String(20)))
    sa.Table("chat_rooms", metadata, sa.Column("id", uuid, primary_key=True), sa.Column("room_type", sa.String(20)),
             sa.Column("host_id", uuid, sa.ForeignKey("users.id")), sa.Column("name", sa.String(120)),
             sa.Column("session_id", uuid, nullable=True))
    sa.Table("chat_room_participants", metadata, sa.Column("room_id", uuid, primary_key=True),
             sa.Column("user_id", uuid, primary_key=True))
    sa.Table("chat_messages", metadata, sa.Column("id", uuid, primary_key=True))
    sa.Table("careers", metadata, sa.Column("id", uuid, primary_key=True), sa.Column("role", sa.String(100)),
             sa.Column("is_current", sa.Boolean(), nullable=False))
    sa.Table("qualifications", metadata, sa.Column("id", uuid, primary_key=True))
    sa.Table("session_participants", metadata, sa.Column("id", uuid, primary_key=True),
             sa.Column("is_waitlisted", sa.Boolean()), sa.Column("waitlist_position", sa.Integer()))
    sa.Table("session_records", metadata, sa.Column("id", uuid, primary_key=True), sa.Column("status", sa.String(20)),
             sa.Column("audio_s3_key", sa.String(500)), sa.Column("recording_started_at", sa.DateTime()),
             sa.Column("recording_ended_at", sa.DateTime()))
    sa.Table("verification_audits", metadata, sa.Column("id", uuid, primary_key=True),
             sa.Column("target_type", sa.String(30)), sa.Column("target_id", uuid),
             sa.Column("credential_id", uuid, nullable=True), sa.Column("action", sa.String(30)))


def _run_upgrade(engine: sa.Engine) -> None:
    module = _load_module()
    with engine.begin() as conn:
        ctx = MigrationContext.configure(conn)
        with Operations.context(ctx):
            module.upgrade()


def _columns(engine: sa.Engine, table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(engine).get_columns(table)}


@pytest.fixture
def applied_engine():
    engine = sa.create_engine("sqlite://", poolclass=sa.pool.StaticPool)
    metadata = sa.MetaData()
    _applied_state_tables(metadata)
    metadata.create_all(engine)
    return engine


def test_이미_적용된_스키마에서는_중복_생성_없이_통과하고_빠진_컬럼만_채운다(applied_engine):
    before_tables = set(sa.inspect(applied_engine).get_table_names())
    _run_upgrade(applied_engine)
    inspector = sa.inspect(applied_engine)
    assert set(inspector.get_table_names()) == before_tables
    assert "updated_at" in _columns(applied_engine, "careers")
    assert "updated_at" in _columns(applied_engine, "qualifications")
    # 이미 있던 컬럼/FK 는 건드리지 않는다
    assert [fk["constrained_columns"] for fk in inspector.get_foreign_keys("chat_rooms")] == [["host_id"]]


def test_두번_실행해도_같은_결과다(applied_engine):
    _run_upgrade(applied_engine)
    snapshot = {t: sorted(_columns(applied_engine, t)) for t in sa.inspect(applied_engine).get_table_names()}
    _run_upgrade(applied_engine)
    assert {t: sorted(_columns(applied_engine, t)) for t in sa.inspect(applied_engine).get_table_names()} == snapshot


def test_없는_컬럼과_테이블은_여전히_만든다():
    engine = sa.create_engine("sqlite://", poolclass=sa.pool.StaticPool)
    metadata = sa.MetaData()
    _applied_state_tables(metadata)
    to_create = [t for n, t in metadata.tables.items() if n != "chat_room_participants"]
    metadata.create_all(engine, tables=to_create)
    with engine.begin() as conn:
        conn.execute(sa.text("ALTER TABLE users DROP COLUMN auth_provider"))
    _run_upgrade(engine)
    assert "chat_room_participants" in sa.inspect(engine).get_table_names()
    assert "auth_provider" in _columns(engine, "users")
