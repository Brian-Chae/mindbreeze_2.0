"""빈 PG 에 체인을 처음부터 적용한 결과 스키마 검증 (SDD-211 P0 · PG-2·PG-4).

`30c1bfbc724f` 멱등화 이후의 결과가 모델 메타데이터와 같은 테이블 집합이고, 이 리비전이 채워야 하는
변경 4건이 반영돼 있는지 본다.
"""

from __future__ import annotations

from pathlib import Path

import pytest
import sqlalchemy as sa

pytestmark = pytest.mark.pg

BACKEND = Path(__file__).parents[2]


def test_alembic_version_이_head_하나다(pg_conn):
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND / "alembic"))
    heads = ScriptDirectory.from_config(cfg).get_heads()
    rows = pg_conn.execute(sa.text("select version_num from alembic_version")).scalars().all()
    assert len(heads) == 1
    assert rows == heads


def test_테이블_집합이_모델_메타데이터와_같다(pg_conn):
    import app.models  # noqa: F401
    from app.core.database import Base

    tables = set(sa.inspect(pg_conn).get_table_names(schema="public")) - {"alembic_version"}
    assert tables == set(Base.metadata.tables)
    assert len(tables) == 62


def test_30c1_리비전이_채워야_하는_변경_4건이_있다(pg_conn):
    inspector = sa.inspect(pg_conn)
    careers = {c["name"]: c for c in inspector.get_columns("careers")}
    qualifications = {c["name"] for c in inspector.get_columns("qualifications")}
    assert "updated_at" in careers
    assert "updated_at" in qualifications
    assert careers["role"]["type"].length == 100
    assert careers["is_current"]["nullable"] is False
