"""PG 제약 샘플 2건 (SDD-211 P3 · PG-8).

이후 Phase 가 복합 FK·부분 유니크 등 제약을 추가할 때 같은 하네스에 테스트만 더하면 된다.
"""

from __future__ import annotations

import re
import uuid

import pytest
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError

pytestmark = pytest.mark.pg

INDEX = "uq_sessions_active_access_code"


def _new_user(session):
    from app.models.user import User

    user = User(email=f"pg-{uuid.uuid4().hex[:12]}@example.com", password_hash="x", name="테스트", role="counselor")
    session.add(user)
    session.flush()
    return user


def _new_class(session, host, code: str, **over):
    from app.models.session import Session

    fields = {"status": "open", **over}
    row = Session(type="meditation", host_id=host.id, duration_min=30, access_code=code, **fields)
    session.add(row)
    return row


def test_활성_클래스_코드_중복은_거부되고_종료_후_재사용은_허용된다(pg_session):
    from datetime import datetime, timezone

    host = _new_user(pg_session)
    first = _new_class(pg_session, host, "4821")
    pg_session.flush()

    with pytest.raises(IntegrityError) as raised, pg_session.begin_nested():
        _new_class(pg_session, host, "4821")
        pg_session.flush()
    assert getattr(raised.value.orig, "pgcode", None) == "23505"
    assert INDEX in str(raised.value.orig)

    # 인덱스 조건에서 빠지는 행은 같은 코드를 쓸 수 있다: 템플릿·숨김·종료/취소
    _new_class(pg_session, host, "4821", is_template=True)
    _new_class(pg_session, host, "4821", hidden_at=datetime.now(timezone.utc))
    _new_class(pg_session, host, "4821", status="cancelled")
    pg_session.flush()

    first.status = "completed"
    pg_session.flush()
    _new_class(pg_session, host, "4821")
    pg_session.flush()


def _boolean_literals_to_pg(sqlite_sql: str) -> str:
    return re.sub(r"(\w+)\s*=\s*([01])\b", lambda m: f"{m.group(1)} = {'true' if m.group(2) == '1' else 'false'}", sqlite_sql)


def test_모델의_postgresql_where_와_sqlite_where_가_같은_조건이고_PG에_실제_부분_인덱스로_있다(pg_conn):
    import app.models  # noqa: F401  - 모든 모델을 메타데이터에 등록
    from app.core.database import Base

    partial: list[tuple[str, str, str, bool]] = []
    for table in Base.metadata.tables.values():
        for index in table.indexes:
            pg_where = index.dialect_options["postgresql"]["where"]
            sqlite_where = index.dialect_options["sqlite"]["where"]
            if pg_where is None and sqlite_where is None:
                continue
            assert pg_where is not None and sqlite_where is not None, f"{index.name}: 한쪽 dialect 의 where 가 없다"
            partial.append((index.name, str(pg_where), str(sqlite_where), bool(index.unique)))

    assert any(name == INDEX for name, *_ in partial), "대상 인덱스가 모델에서 사라졌다"
    for name, pg_where, sqlite_where, _unique in partial:
        normalized = _boolean_literals_to_pg(sqlite_where)
        # 불리언 리터럴(0/1 ↔ false/true)을 제외한 조건식이 같아야 한다
        squash = lambda sql: re.sub(r"\s+", " ", sql.replace("true", "1").replace("false", "0")).strip()  # noqa: E731
        assert squash(pg_where) == squash(normalized), f"{name}: 두 dialect 조건이 다르다\n{pg_where}\n{sqlite_where}"

    rows = pg_conn.execute(
        sa.text(
            "select c.relname, i.indisunique, i.indpred is not null as partial "
            "from pg_index i join pg_class c on c.oid = i.indexrelid join pg_namespace n on n.oid = c.relnamespace "
            "where n.nspname = 'public'"
        )
    ).all()
    in_db = {name: (unique, is_partial) for name, unique, is_partial in rows}
    missing = [name for name, *_ in partial if name not in in_db]
    assert missing == [], f"모델에는 있으나 마이그레이션 결과 DB 에 없는 부분 인덱스: {missing}"
    for name, _pg, _sqlite, unique in partial:
        assert in_db[name] == (unique, True), f"{name}: DB 의 유니크/부분 여부가 모델과 다르다 {in_db[name]}"
