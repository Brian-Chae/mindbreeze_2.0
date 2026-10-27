"""[MB261026][FIX] 채팅 신고 운영 처리·게시 필터 — PG 전용 검증 (verify V-19, V-58).

- 리비전 e261026c0001 의 스키마(컬럼·FK ON DELETE SET NULL·unique·인덱스)
- upgrade → downgrade -1 → upgrade 왕복에서 기존 chat_reports 행 보존(새 컬럼 NULL)
- 신고자 철회와 관리자 전이가 동시에 와도 한쪽만 이긴다(행 잠금)
"""

from __future__ import annotations

import uuid
import threading
from threading import Barrier

import pytest
import sqlalchemy as sa
from fastapi import HTTPException
from sqlalchemy.orm import Session as DBSession

from tests.pg.conftest import alembic_ok

pytestmark = pytest.mark.pg

REV = "e261026c0001"
PREV = "e246a0301001"


def test_리비전_스키마(pg_conn):
    cols = {
        r.column_name: r
        for r in pg_conn.execute(
            sa.text(
                "select column_name, data_type, is_nullable from information_schema.columns "
                "where table_name = 'chat_reports'"
            )
        )
    }
    for name in ("acknowledged_at", "decided_at", "handled_by", "resolution_note"):
        assert name in cols and cols[name].is_nullable == "YES", name
    assert cols["acknowledged_at"].data_type == "timestamp with time zone"

    fks = pg_conn.execute(
        sa.text(
            """select c.conrelid::regclass::text, a.attname, c.confdeltype
               from pg_constraint c
               join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
               where c.contype = 'f'
                 and (c.conrelid::regclass::text, a.attname) in (('chat_reports','handled_by'), ('chat_filter_terms','created_by'))"""
        )
    ).all()
    # confdeltype 'n' = ON DELETE SET NULL
    assert sorted((t, c, d) for t, c, d in fks) == [
        ("chat_filter_terms", "created_by", "n"),
        ("chat_reports", "handled_by", "n"),
    ]
    indexes = pg_conn.execute(sa.text("select indexname from pg_indexes where tablename = 'chat_reports'")).scalars().all()
    assert "ix_chat_reports_status_created_at" in indexes
    with pytest.raises(sa.exc.IntegrityError):
        with pg_conn.begin_nested():
            pg_conn.execute(
                sa.text(
                    "insert into chat_filter_terms (id, term, normalized_term) "
                    "values (:a, '단어', '단어'), (:b, '단 어', '단어')"
                ),
                {"a": uuid.uuid4(), "b": uuid.uuid4()},
            )


def test_왕복에서_기존_신고_행이_보존된다(scratch_db):
    url = scratch_db("chatmod_roundtrip")
    alembic_ok(url, "upgrade", PREV)
    engine = sa.create_engine(url)
    reporter, target, report = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    try:
        with engine.begin() as conn:
            conn.execute(
                sa.text(
                    "insert into users (id, email, password_hash, name, role, verified_tier) values "
                    "(:r, 'r@example.invalid', 'x', '합성', 'client', 'email'), "
                    "(:t, 't@example.invalid', 'x', '합성', 'client', 'email')"
                ),
                {"r": reporter, "t": target},
            )
            conn.execute(
                sa.text(
                    "insert into chat_reports (id, reporter_id, reported_user_id, operation_key) "
                    "values (:id, :r, :t, 'op-roundtrip')"
                ),
                {"id": report, "r": reporter, "t": target},
            )
        alembic_ok(url, "upgrade", REV)  # 후속 SDD 가 헤드를 올려도 이 리비전 기준으로 왕복한다
        alembic_ok(url, "downgrade", "-1")
        alembic_ok(url, "upgrade", REV)
        with engine.connect() as conn:
            row = conn.execute(
                sa.text("select status, acknowledged_at, decided_at, handled_by, resolution_note from chat_reports where id = :id"),
                {"id": report},
            ).one()
            assert tuple(row) == ("submitted", None, None, None, None)
            assert conn.execute(sa.text("select version_num from alembic_version")).scalar() == REV
    finally:
        engine.dispose()


def test_V19_철회와_관리자_전이가_동시에_와도_한쪽만_이긴다(pg_engine):
    from app.services import chat_moderation_service, chat_report_admin_service

    reporter, target, admin, report = uuid.uuid4(), uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    tag = uuid.uuid4().hex[:8]
    with pg_engine.begin() as conn:
        conn.execute(
            sa.text(
                "insert into users (id, email, password_hash, name, role, verified_tier) values "
                "(:r, :re, 'x', '합성', 'client', 'email'), (:t, :te, 'x', '합성', 'client', 'email'), "
                "(:a, :ae, 'x', '합성', 'platform_admin', 'email')"
            ),
            {"r": reporter, "t": target, "a": admin, "re": f"r-{tag}@example.invalid", "te": f"t-{tag}@example.invalid", "ae": f"a-{tag}@example.invalid"},
        )
        conn.execute(
            sa.text("insert into chat_reports (id, reporter_id, reported_user_id, operation_key) values (:id, :r, :t, :k)"),
            {"id": report, "r": reporter, "t": target, "k": f"op-{tag}"},
        )

    barrier = Barrier(2)
    outcomes: dict[str, str] = {}

    def _withdraw() -> None:
        with DBSession(pg_engine) as db:
            barrier.wait()
            try:
                chat_moderation_service.withdraw_report(str(reporter), str(report), db)
                outcomes["withdraw"] = "ok"
            except HTTPException as e:
                outcomes["withdraw"] = str(e.status_code)

    def _transition() -> None:
        with DBSession(pg_engine) as db:
            barrier.wait()
            try:
                chat_report_admin_service.transition_report(str(report), "reviewing", None, admin, db)
                outcomes["transition"] = "ok"
            except HTTPException as e:
                outcomes["transition"] = str(e.status_code)

    threads = [threading.Thread(target=_withdraw), threading.Thread(target=_transition)]
    try:
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=30)
        with pg_engine.connect() as conn:
            final = conn.execute(sa.text("select status from chat_reports where id = :id"), {"id": report}).scalar()
        assert sorted(outcomes.values()) == ["409", "ok"], outcomes
        winner = next(k for k, v in outcomes.items() if v == "ok")
        assert final == ("withdrawn" if winner == "withdraw" else "reviewing")
    finally:
        with pg_engine.begin() as conn:
            conn.execute(sa.text("delete from verification_audits where target_id = :id"), {"id": report})
            conn.execute(sa.text("delete from chat_reports where id = :id"), {"id": report})
            conn.execute(sa.text("delete from users where id in (:r, :t, :a)"), {"r": reporter, "t": target, "a": admin})
