"""SDD-211 P0 — 마이그레이션 `30c1bfbc724f` 리비전 id·체인 불변 가드.

빈 PG 에서의 전체 체인 적용·테이블 수 62 는 CI `backend-pg-smoke` 잡과 `tests/pg/` 가 검증한다.
멱등화 자체는 SDD-210(5bf7eac6)의 수정본을 채택했다 — 이 구현은 PG 전용(op.alter_column)이라
SQLite·오프라인(--sql) 렌더 회귀는 검증 대상이 아니다(초기 BE-2 구현 전용 테스트 4건은 폐기).
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
HEAD = "e036a0000055"


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
    assert len(revisions) >= 88
    assert len(script.get_heads()) == 1
    assert HEAD in {r.revision for r in revisions}
    rev = script.get_revision(REVISION)
    assert rev.down_revision == "d74027f66e1c"
    assert len([r for r in revisions if r.down_revision == REVISION]) == 1
