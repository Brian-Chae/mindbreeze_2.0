"""M0 분포 조회(SDD-211 M1)를 PostgreSQL 에서 검증한다 (M0-2 · M0-4 · M0-6 일부).

① 빈 DB 에서 모든 질의 EXPLAIN·실행 오류 0 ② 합성 데이터에서 분류 질의의 집계가 손으로 센 값과 같음
③ 러너가 만드는 연결·트랜잭션이 실제로 읽기 전용(쓰기 거부)이고 ROLLBACK 으로 끝남.
실데이터는 쓰지 않는다 — 합성 행은 롤백되는 트랜잭션 안에서만 존재한다.
"""

from __future__ import annotations

import importlib.util
import io
import os
import sys
from pathlib import Path

import pytest
import sqlalchemy as sa
from sqlalchemy.exc import DBAPIError

pytestmark = pytest.mark.pg

SPEC_DIR = Path(__file__).parents[3] / "specs" / "sdd-211-class-structure-phase0"


@pytest.fixture(scope="module")
def runner():
    spec = importlib.util.spec_from_file_location("m0_prequery_pg", SPEC_DIR / "m0-prequery.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def statements(runner):
    return runner.parse_sql((SPEC_DIR / "m0-prequery.sql").read_text(encoding="utf-8"))


def _parse(output: str) -> dict[str, list[list[str]]]:
    rows: dict[str, list[list[str]]] = {}
    current = None
    for line in output.splitlines():
        if line.startswith("--- "):
            current = line[4:].split(":")[0]
            rows[current] = []
        elif current and line.strip():
            rows[current].append([cell.strip() for cell in line.split("|")][1:])  # 첫 열은 qid
    return rows


def test_빈_DB_에서_모든_질의가_EXPLAIN_과_실행을_통과한다(runner, statements, pg_engine):
    settings = runner.connection_settings()
    engine = sa.create_engine(pg_engine.url, connect_args=settings["connect_args"])
    try:
        with engine.connect().execution_options(**settings["execution_options"]) as conn:
            out = io.StringIO()
            runner.run_plan(conn, statements, out, io.StringIO(), include_labels=True, explain_only=True)
        assert out.getvalue().count("EXPLAIN 통과") == len(statements)

        with engine.connect().execution_options(**settings["execution_options"]) as conn:
            out, labels = io.StringIO(), io.StringIO()
            counts = runner.run_plan(conn, statements, out, labels, include_labels=True)
        assert set(counts) == {s.qid for s in statements}
        assert "--- A4d" not in out.getvalue()
    finally:
        engine.dispose()


def test_러너_연결은_읽기_전용_반복읽기이며_쓰기를_거부하고_끝에_롤백한다(runner, pg_engine):
    settings = runner.connection_settings()
    engine = sa.create_engine(pg_engine.url, connect_args=settings["connect_args"])
    try:
        with engine.connect().execution_options(**settings["execution_options"]) as conn:
            assert conn.exec_driver_sql("show default_transaction_read_only").scalar() == "on"
            assert conn.exec_driver_sql("show transaction_read_only").scalar() == "on"
            assert conn.exec_driver_sql("show transaction_isolation").scalar() == "repeatable read"
            assert conn.exec_driver_sql("show statement_timeout").scalar() == "15s"
            with pytest.raises(DBAPIError) as raised:
                conn.exec_driver_sql("create temp table m0_must_not_exist (a int)")
            assert "read-only" in str(raised.value.orig)
            conn.rollback()
        with pg_engine.connect() as plain:
            leftover = plain.exec_driver_sql("select to_regclass('pg_temp.m0_must_not_exist')").scalar()
        assert leftover is None
    finally:
        engine.dispose()


SEED = (Path(__file__).parent / "m0_prequery_seed.sql").read_text(encoding="utf-8")


def test_합성_데이터에서_분류_집계가_손으로_센_값과_같다(runner, statements, pg_conn):
    # 이 시드는 SDD-214 이전 모양(부모 없는 비템플릿 세션)이라 같은 트랜잭션 안에서만 CHECK 를 푼다(테스트 끝에 롤백).
    pg_conn.exec_driver_sql("ALTER TABLE sessions DROP CONSTRAINT IF EXISTS ck_sessions_one_parent")
    pg_conn.exec_driver_sql(SEED)
    out, labels = io.StringIO(), io.StringIO()
    runner.run_plan(pg_conn, statements, out, labels, include_labels=True)
    got = _parse(out.getvalue())

    def total(qid: str, column: int) -> int:
        return sum(int(row[column]) for row in got[qid])

    # A1: 비템플릿 12건 + 템플릿 1건(숨김 1건 포함)
    assert total("A1", -1) == 13
    assert sum(int(r[-1]) for r in got["A1"] if r[3] == "True") == 1
    # A2: 청구 대상 1:1 상담 — 회원 1명 4건, 비회원 1명 1건, 활성 0명 1건(취소)
    clinical_one_on_one = {(r[2], r[3]): int(r[5]) for r in got["A2"] if r[0] == "clinical" and r[1] == "one_on_one"}
    assert clinical_one_on_one == {("0", "-"): 1, ("1", "guest"): 1, ("1", "member"): 4}
    # A2: 집단 상담(hypnosis, group)에서 호스트 행·제거된 행은 활성이 아니다 → 활성 1명(회원)
    assert [r for r in got["A2"] if r[0] == "hypnosis" and r[1] == "group"] == [["hypnosis", "group", "1", "member", "False", "1"]]
    # A3: 정원 10 이라 capacity_bucket 은 >=10 — 정원으로 그룹/1:1 을 판정하지 않는다는 근거 데이터
    assert {r[3] for r in got["A3"]} == {">=10"}
    # A4: custom 3건 = conflict 1 + kw_counseling 1 + kw_none 1, 라벨은 일반 출력에 없다
    assert sorted((r[0], int(r[3])) for r in got["A4b"]) == [("conflict", 1), ("kw_counseling", 1), ("kw_none", 1)]
    assert "감정 코칭" not in out.getvalue() and "감정 코칭" in labels.getvalue()
    # A5: (호스트, 회원) 쌍 4개·상담사 2·회원 3·세션 6, custom 비집단 포함 변형은 세션 7
    assert got["A5b"] == [["4", "2", "3", "6", "0", "4"]]
    assert got["A5b-custom"] == [["4", "2", "3", "7", "0", "4"]]
    assert {r[0]: int(r[1]) for r in got["A5a"]} == {"1": 3, "3": 1}
    # A6: 비회원 참여자(clinical 1, meditation 1) — 값은 존재 여부 개수로만
    assert {r[0]: int(r[3]) for r in got["A6"]} == {"clinical": 1, "custom": 0, "hypnosis": 0, "meditation": 1}
    # A10: 호스트 role 은 counselor 만(role=client 호스트 세션 없음)
    assert {r[0] for r in got["A10"]} == {"counselor"}
    # A11: 승인 전(pending_review) 미읽음 회원 리포트 1건
    assert got["A11"] == [["pending_review", "False", "1"]]
