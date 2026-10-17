#!/usr/bin/env python3
"""SDD-211 M1 — M0 분포 조회 러너 (읽기 전용 3중 강제, 집계만 출력).

사용(서버 backend 디렉터리에서, DATABASE_URL 은 환경변수로만 전달 — 값 출력·`set -x` 금지, 먼저 `umask 077`):
    export DATABASE_URL=$(grep -E '^DATABASE_URL=' ./.env.dev | head -1 | cut -d= -f2-)
    venv/bin/python m0-prequery.py m0-prequery.sql > out-$(date +%Y%m%d-%H%M).txt
    # 정적 검사만(DB 접속 없음):   m0-prequery.py m0-prequery.sql --check-only
    # 컬럼·문법 검증(EXPLAIN만):   m0-prequery.py m0-prequery.sql --explain-only
    # A4d(라벨 원문, platform_admin 요청 시에만): --include-labels [--labels-out out-labels-….txt]

강제 3중: ① 연결 옵션 default_transaction_read_only=on + statement_timeout ② REPEATABLE READ, READ ONLY 단일
트랜잭션 + 마지막에 ROLLBACK ③ 문장별 SELECT 시작 검사와 금지어·금지 문자 검사(실행 전 전부 통과해야 한다).
소량 셀 억제는 하지 않는다(U5=A). 사람·센터 단위 상세는 커밋하지 않는 것은 보고 단계의 규칙이다.
"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import os
import re
import sys
from dataclasses import dataclass
from typing import Any, TextIO

MAX_ROWS = 250  # 이론상 최대 행 수는 A1·C3 의 192 — 집계가 아닌 행 단위 출력을 막는 안전망
LABEL_QIDS = frozenset({"A4d"})
CONNECT_OPTIONS = "-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=2000"
SET_LOCALS = (
    "SET LOCAL statement_timeout = '15s'",
    "SET LOCAL lock_timeout = '2s'",
    "SET LOCAL idle_in_transaction_session_timeout = '120s'",
)

_FORBIDDEN = re.compile(
    r"\b(insert|update|delete|alter|drop|create|truncate|grant|revoke|copy|call|do|vacuum|analyze|lock|into|set|"
    r"begin|commit|rollback|savepoint|execute|prepare|listen|notify|reindex|cluster|refresh|comment|explain)\b"
    r"|\b(pg_read_\w*|pg_ls_\w*|lo_\w+|dblink\w*|pg_sleep\w*|pg_terminate_backend|pg_cancel_backend|pg_advisory\w*"
    r"|pg_stat_reset\w*|pg_reload_conf|pg_rotate_logfile|nextval|setval|lastval|set_config|txid_\w+"
    r"|pg_notify|pg_stat_file|pg_logical\w*|pg_switch\w*|pg_create_\w+|pg_drop_\w+|pg_replication\w*|pg_promote"
    r"|pg_import\w*|pg_export\w*|\w+_to_xml\w*|xmlquery)\b",
    re.IGNORECASE,
)
# 함수 호출은 허용 목록(allowlist)만 쓴다 — 금지어 정규식은 보조 방어선일 뿐이다.
ALLOWED_FUNCTIONS = frozenset({
    "array_agg", "bool_and", "bool_or", "btrim", "coalesce", "count", "current_database", "current_setting",
    "date_trunc", "least", "left", "length", "lower", "max", "min", "now", "pg_column_size", "row_number", "sum",
})
_SQL_WORDS_BEFORE_PAREN = frozenset({
    "filter", "from", "in", "or", "and", "not", "over", "where", "on", "when", "then", "else", "join", "exists",
    "distinct", "select", "as", "by", "using", "any", "all", "between", "case", "end", "limit", "having", "values",
})
_CALL = re.compile(r"\b([A-Za-z_][A-Za-z0-9_]*)\s*\(")
_STRING_LITERAL = re.compile(r"'(?:[^']|'')*'")
_QID = re.compile(r"^select\s+'([A-Za-z0-9-]+)'\s+as\s+qid\b", re.IGNORECASE)
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_UUID = re.compile(r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b")


class RejectedStatement(Exception):
    """실행 전 거부된 문장 — 이 예외가 나면 DB 에 어떤 문장도 보내지 않는다."""


class OutputGuardError(Exception):
    """출력 위생 위반(이메일·UUID 형식, 행 수 초과) — 해당 결과는 출력하지 않는다."""


@dataclass(frozen=True)
class Statement:
    qid: str
    sql: str


def split_statements(text: str) -> list[str]:
    """주석을 지우고 세미콜론으로 문장을 나눈다. 문자열 리터럴 안의 `;`·`--`·`%`·`$` 와 블록 주석은 거부한다."""
    statements: list[str] = []
    buf: list[str] = []
    i, n = 0, len(text)
    in_string = False
    while i < n:
        ch = text[i]
        nxt = text[i + 1] if i + 1 < n else ""
        if in_string:
            if ch == "'":
                if nxt == "'":
                    buf.append("''")
                    i += 2
                    continue
                in_string = False
            elif ch in ";%$" or (ch == "-" and nxt == "-"):
                raise RejectedStatement(f"문자열 리터럴에 금지 문자가 있다: {ch!r}")
            buf.append(ch)
            i += 1
            continue
        if ch == "'":
            prev = text[i - 1] if i > 0 else ""
            if prev == "&" or (prev in "eEuU" and prev and (i < 2 or not (text[i - 2].isalnum() or text[i - 2] == "_"))):
                raise RejectedStatement("E'…' / U&'…' 형식 문자열은 허용하지 않는다")
            in_string = True
            buf.append(ch)
        elif ch == '"':
            raise RejectedStatement("큰따옴표 식별자는 허용하지 않는다")
        elif ch == "-" and nxt == "-":
            while i < n and text[i] != "\n":
                i += 1
            continue
        elif ch == "/" and nxt == "*":
            raise RejectedStatement("블록 주석은 허용하지 않는다")
        elif ch == ";":
            statement = "".join(buf).strip()
            if statement:
                statements.append(statement)
            buf = []
        elif ch in "%$":
            raise RejectedStatement(f"허용하지 않는 문자: {ch!r}")
        else:
            buf.append(ch)
        i += 1
    if in_string:
        raise RejectedStatement("닫히지 않은 문자열 리터럴")
    tail = "".join(buf).strip()
    if tail:
        statements.append(tail)
    return statements


def validate_statement(sql: str) -> None:
    if not re.match(r"^select\b", sql, re.IGNORECASE):
        raise RejectedStatement("SELECT 로 시작하는 문장만 실행한다(WITH 는 서브쿼리로 전개)")
    forbidden = _FORBIDDEN.search(sql)
    if forbidden:
        raise RejectedStatement(f"금지어: {forbidden.group(0)}")
    for name in _CALL.findall(_STRING_LITERAL.sub("''", sql)):
        lowered = name.lower()
        if lowered not in _SQL_WORDS_BEFORE_PAREN and lowered not in ALLOWED_FUNCTIONS:
            raise RejectedStatement(f"허용 목록에 없는 함수: {name}")


def parse_sql(text: str) -> list[Statement]:
    statements = []
    seen: set[str] = set()
    for sql in split_statements(text):
        validate_statement(sql)
        match = _QID.match(sql)
        if not match:
            raise RejectedStatement("첫 열은 SELECT '<질의 ID>' AS qid 여야 한다")
        qid = match.group(1)
        if qid in seen:
            raise RejectedStatement(f"질의 ID 중복: {qid}")
        seen.add(qid)
        statements.append(Statement(qid, sql))
    if not statements:
        raise RejectedStatement("실행할 문장이 없다")
    return statements


def sha256_of(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def connection_settings() -> dict[str, Any]:
    """접속 수준 강제: 읽기 전용 기본값·타임아웃(connect_args)과 트랜잭션 격리/읽기 전용(실행 옵션)."""
    return {
        "connect_args": {"options": CONNECT_OPTIONS},
        "execution_options": {"isolation_level": "REPEATABLE READ", "postgresql_readonly": True},
    }


def _format(value: Any) -> str:
    return "" if value is None else str(value)


def _guard_row(qid: str, values: list[str]) -> None:
    for value in values:
        if _EMAIL.search(value) or _UUID.search(value):
            raise OutputGuardError(f"{qid}: 이메일 또는 UUID 형식이 결과에 있다 — 출력하지 않는다")


def run_plan(
    conn: Any,
    statements: list[Statement],
    out: TextIO,
    labels_out: TextIO | None,
    *,
    include_labels: bool = False,
    explain_only: bool = False,
) -> dict[str, int]:
    """고정된 순서로 실행한다. 실행 전 SET LOCAL 3개, 끝은 항상 ROLLBACK(COMMIT 없음)."""
    counts: dict[str, int] = {}
    try:
        for set_local in SET_LOCALS:
            conn.exec_driver_sql(set_local)
        for statement in statements:
            is_label = statement.qid in LABEL_QIDS
            if is_label and not include_labels and not explain_only:
                print(f"--- {statement.qid}: 건너뜀(--include-labels 필요, platform_admin 요청 시에만)", file=out)
                continue
            if is_label and labels_out is None and not explain_only:
                raise RejectedStatement("라벨 출력 파일이 없다 — 라벨 결과를 일반 출력에 섞지 않는다")
            sink = labels_out if is_label and not explain_only else out
            result = conn.exec_driver_sql(("EXPLAIN " if explain_only else "") + statement.sql)
            if explain_only:
                result.fetchall()
                print(f"--- {statement.qid}: EXPLAIN 통과", file=out)
                counts[statement.qid] = 0
                continue
            rows = result.fetchmany(MAX_ROWS + 1)
            if len(rows) > MAX_ROWS:
                raise OutputGuardError(f"{statement.qid}: 결과가 {MAX_ROWS}행을 넘는다 — 집계 질의가 아니다")
            rendered = [[_format(v) for v in row] for row in rows]
            if not is_label:
                for values in rendered:
                    _guard_row(statement.qid, values)
            print(f"--- {statement.qid}: {' | '.join(result.keys())}", file=sink)
            for values in rendered:
                print(" | ".join(values), file=sink)
            counts[statement.qid] = len(rendered)
    finally:
        conn.rollback()
    return counts


def open_labels_file(path: str) -> TextIO:
    """라벨 원문 전용 파일 — 0600, 이미 있으면 덮어쓰지 않는다."""
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    return os.fdopen(fd, "w", encoding="utf-8")


def _build_engine(url: str) -> Any:
    import sqlalchemy as sa

    settings = connection_settings()
    return sa.create_engine(url, connect_args=settings["connect_args"]), settings["execution_options"]


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="SDD-211 M0 분포 조회 러너(읽기 전용)")
    parser.add_argument("sql_file")
    parser.add_argument("--check-only", action="store_true", help="정적 검사만(DB 접속 없음)")
    parser.add_argument("--explain-only", action="store_true", help="EXPLAIN 으로 컬럼·문법만 검증")
    parser.add_argument("--include-labels", action="store_true", help="A4d(라벨 원문) 실행 — platform_admin 요청 시에만")
    parser.add_argument("--labels-out", help="라벨 결과 파일(기본: out-labels-YYYYMMDD-HHMM.txt)")
    args = parser.parse_args(argv)

    text = open(args.sql_file, encoding="utf-8").read()
    try:
        statements = parse_sql(text)
    except RejectedStatement as error:
        print(f"거부: {error}", file=sys.stderr)
        return 3
    print(f"# sha256={sha256_of(text)} statements={len(statements)}")
    if args.check_only:
        print("# 정적 검사 통과")
        return 0

    url = os.environ.get("DATABASE_URL", "")
    if not url:
        print("DATABASE_URL 환경변수가 없습니다", file=sys.stderr)
        return 2

    labels_out: TextIO | None = None
    labels_path: str | None = None
    try:
        engine, execution_options = _build_engine(url)
        with engine.connect().execution_options(**execution_options) as conn:
            if args.include_labels and not args.explain_only:
                stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M")
                labels_path = args.labels_out or f"out-labels-{stamp}.txt"
                labels_out = open_labels_file(labels_path)
            run_plan(conn, statements, sys.stdout, labels_out, include_labels=args.include_labels,
                     explain_only=args.explain_only)
    except (RejectedStatement, OutputGuardError) as error:
        print(f"중단: {error}", file=sys.stderr)
        return 4
    except Exception as error:  # noqa: BLE001 - 접속 정보가 오류 문구에 섞이지 않게 형식만 출력
        print(f"실행 오류: {type(error).__name__}", file=sys.stderr)
        return 5
    finally:
        if labels_out is not None:
            labels_out.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
