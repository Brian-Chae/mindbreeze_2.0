"""SDD-211 M1 — M0 분포 조회 러너·질의 정적 검사 (M0-1~M0-4 · M0-12).

DB 없이 실행한다. 빈 PG 에서의 EXPLAIN·실행 검증은 `tests/pg/test_m0_prequery_pg.py`(CI backend-pg-smoke)가 맡는다.
"""

from __future__ import annotations

import importlib.util
import io
import re
import stat
import sys
import uuid
from pathlib import Path

import pytest

SPEC_DIR = Path(__file__).parents[2] / "specs" / "sdd-211-class-structure-phase0"
SQL_PATH = SPEC_DIR / "m0-prequery.sql"
RUNNER_PATH = SPEC_DIR / "m0-prequery.py"


@pytest.fixture(scope="module")
def runner():
    spec = importlib.util.spec_from_file_location("m0_prequery", RUNNER_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module  # dataclass 가 모듈을 sys.modules 에서 찾는다
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def statements(runner):
    return runner.parse_sql(SQL_PATH.read_text(encoding="utf-8"))


EXPECTED_QIDS = {
    "B0", "A1", "A2", "A3", "A4a", "A4b", "A4c", "A4d", "A5a", "A5b", "A5c", "A5a-custom", "A5b-custom",
    "A6", "A7a", "A7b", "A7c", "A7d", "A8", "A9-D8", "A9-D9", "A9-D10", "A9-D11", "A9-D12", "A10", "A11",
    "A11b", "C2", "C2b", "C2c", "C3", "C3b", "C4", *{f"C6-Q{n}" for n in range(1, 12)},
}


# ── 질의 파일 정적 검사 (M0-3) ───────────────────────────────────────────


def test_질의_파일은_기대한_질의_ID_전부를_담는다(statements):
    assert {s.qid for s in statements} == EXPECTED_QIDS
    assert len(statements) == len(EXPECTED_QIDS)


def test_모든_문장은_SELECT_로_시작하고_WITH_를_쓰지_않는다(statements):
    for statement in statements:
        assert re.match(r"^select\b", statement.sql, re.IGNORECASE), statement.qid
        assert not re.search(r"\bwith\b\s+\w+\s+as\b", statement.sql, re.IGNORECASE), statement.qid


def test_문자열_리터럴에_세미콜론_하이픈2개_퍼센트가_없다(runner):
    text = SQL_PATH.read_text(encoding="utf-8")
    # 러너의 토크나이저가 리터럴 안의 금지 문자를 거부하므로 파싱 성공 자체가 증거다
    assert runner.parse_sql(text)
    assert "%" not in text and "$" not in text


_CLAUSES = ("select", "from", "where", "group by", "order by", "limit")
_CLAUSE_PATTERNS = {clause: re.compile(clause.replace(" ", r"\s+") + r"\b", re.IGNORECASE) for clause in _CLAUSES}


def _top_level_clauses(sql: str) -> dict[str, str]:
    """괄호 깊이 0 에서 절(SELECT/FROM/WHERE/GROUP BY/ORDER BY/LIMIT)별 본문을 나눈다(서브쿼리 내부는 건드리지 않는다)."""
    depth, marks, i = 0, [], 0
    in_string = False
    while i < len(sql):
        ch = sql[i]
        if ch == "'":
            in_string = not in_string
        elif not in_string:
            if ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
            elif depth == 0 and (i == 0 or not (sql[i - 1].isalnum() or sql[i - 1] == "_")):
                for clause in _CLAUSES:
                    if _CLAUSE_PATTERNS[clause].match(sql, i):
                        marks.append((i, clause))
                        break
        i += 1
    result: dict[str, str] = {}
    for index, (pos, clause) in enumerate(marks):
        end = marks[index + 1][0] if index + 1 < len(marks) else len(sql)
        result[clause] = re.sub(r"^\S+(\s+by)?", "", sql[pos:end].strip(), count=1, flags=re.IGNORECASE).strip()
    return result


def _split_top_level(body: str) -> list[str]:
    depth, start, items = 0, 0, []
    for i, ch in enumerate(body):
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        elif ch == "," and depth == 0:
            items.append(body[start:i].strip())
            start = i + 1
    items.append(body[start:].strip())
    return items


def _top_level_select_items(sql: str) -> list[str]:
    return _split_top_level(_top_level_clauses(sql)["select"])


# 바깥 출력 열로 나가면 안 되는 컬럼(조사 07 §1.4)
FORBIDDEN_OUTPUT_COLUMNS = {
    "id", "host_id", "user_id", "organization_id", "member_id", "session_id", "run_id", "participant_id",
    "title", "notes", "access_code", "legacy_access_code", "location_address", "webrtc_room_id", "custom_type_name",
    "guest_name", "gender", "birth_date", "report_email", "linkband_device_id", "webrtc_peer_id",
    "email", "name", "phone", "bio", "profile_image", "password_hash", "notification_preferences", "org_id",
    "ceo_name", "biz_number", "address", "memo", "transcript", "counselor_notes", "ai_summary", "markers", "content",
    "extra", "body", "cta", "email_norm",
}
_BARE_COLUMN = re.compile(r"^(?:\w+\.)?(\w+)(?:\s+as\s+\w+)?$", re.IGNORECASE)


def test_바깥_SELECT_목록에_금지_컬럼이_그대로_나가지_않는다(statements):
    for statement in statements:
        if statement.qid in {"A4d"}:
            continue
        for item in _top_level_select_items(statement.sql):
            bare = _BARE_COLUMN.match(item)
            if bare:
                assert bare.group(1).lower() not in FORBIDDEN_OUTPUT_COLUMNS, f"{statement.qid}: {item}"


def test_바깥_GROUP_BY_ORDER_BY_는_금지_컬럼을_키로_쓰지_않는다(statements):
    for statement in statements:
        if statement.qid == "A4d":
            continue
        clauses = _top_level_clauses(statement.sql)
        for clause in ("group by", "order by"):
            for key in _split_top_level(clauses.get(clause, "")) if clauses.get(clause) else []:
                key = re.sub(r"\s+(asc|desc)$", "", key, flags=re.IGNORECASE)
                bare = _BARE_COLUMN.match(key)
                if bare and not key.isdigit():
                    assert bare.group(1).lower() not in FORBIDDEN_OUTPUT_COLUMNS, f"{statement.qid}: {clause} {key}"


def test_절_분해기가_서브쿼리_안의_GROUP_BY_를_바깥으로_착각하지_않는다():
    clauses = _top_level_clauses("SELECT 'A2' AS qid, a.type FROM ( SELECT s.id, s.type FROM sessions s GROUP BY s.id ) a GROUP BY 2 ORDER BY 2")
    assert clauses["group by"] == "2" and clauses["order by"] == "2"
    assert _top_level_select_items("SELECT 'A2' AS qid, count(a.x) AS n FROM t a") == ["'A2' AS qid", "count(a.x) AS n"]


def test_custom_type_name_은_A4d_밖에서_개수_집계_또는_고정_범주로만_나간다(statements):
    only_aggregate = re.compile(r"^count\(distinct lower\(btrim\(a\.custom_type_name\)\)\) as distinct_labels$", re.IGNORECASE)
    for statement in statements:
        if statement.qid == "A4d":
            continue
        for item in _top_level_select_items(statement.sql):
            if "custom_type_name" not in item or only_aggregate.match(item):
                continue
            # 키워드 분류(A4b): 정규식 술어를 CASE 로 평가해 결과는 고정 문자열 범주뿐이어야 한다
            assert item.upper().startswith("CASE WHEN") and item.upper().endswith("END AS KW_CLASS"), f"{statement.qid}: {item}"
            results = re.findall(r"THEN\s+(\S+)|ELSE\s+(\S+)", item)
            assert results and all(re.match(r"^'[a-z_]+'$", v) for pair in results for v in pair if v), f"{statement.qid}: {item}"


def test_금지_컬럼_검사기가_위반을_실제로_잡는다():
    bad = _top_level_select_items("SELECT 'A1' AS qid, s.host_id, s.title AS t FROM sessions s")
    flagged = [i for i in bad if (m := _BARE_COLUMN.match(i)) and m.group(1).lower() in FORBIDDEN_OUTPUT_COLUMNS]
    assert flagged == ["s.host_id", "s.title AS t"]


def test_A4d_는_상한_100이고_k_임계_HAVING_이_없다(statements):
    a4d = next(s for s in statements if s.qid == "A4d")
    assert re.search(r"limit\s+100\b", a4d.sql, re.IGNORECASE)
    assert not re.search(r"\bhaving\b", a4d.sql, re.IGNORECASE)
    # U5=A: 소량 셀 억제 임계는 어떤 질의에도 없다
    assert not any(re.search(r"\bhaving\b", s.sql, re.IGNORECASE) for s in statements)


def test_E2E_고정_리터럴_외의_값_리터럴이_없다(statements):
    allowed = {"E2E001", "E2E-"}
    for statement in statements:
        for literal in re.findall(r"'([^']*)'", statement.sql):
            if re.search(r"\d{4}-\d{2}-\d{2}", literal):  # 기준선 컷 시각
                continue
            if literal in allowed:
                continue
            assert not _EMAIL_LIKE.search(literal), f"{statement.qid}: {literal}"


_EMAIL_LIKE = re.compile(r"@")


# ── 러너 거부 규칙 (M0-4) ────────────────────────────────────────────────


@pytest.mark.parametrize(
    "sql",
    [
        "INSERT INTO sessions (id) VALUES (1)",
        "UPDATE sessions SET status = 'x'",
        "DELETE FROM sessions",
        "ALTER TABLE sessions ADD COLUMN x int",
        "DROP TABLE sessions",
        "CREATE TABLE t (a int)",
        "TRUNCATE sessions",
        "COPY sessions TO STDOUT",
        "CALL some_proc()",
        "LOCK TABLE sessions",
        "SET statement_timeout = 0",
        "WITH a AS (SELECT 1) SELECT 'X' AS qid FROM a",
        "SELECT 'X' AS qid INTO tmp FROM sessions",
        "SELECT 'X' AS qid, pg_sleep(10)",
        "SELECT 'X' AS qid, set_config('a','b',false)",
        "SELECT 'X' AS qid, nextval('s')",
        "DO 1",
        "EXPLAIN SELECT 1",
        "BEGIN",
        "COMMIT",
        "SELECT 1; DELETE FROM sessions",
        "SELECT 'X' AS qid, pg_notify('c','p')",
        "SELECT 'X' AS qid, pg_stat_file('/etc/passwd')",
        "SELECT 'X' AS qid, query_to_xml('select 1', true, false, '')",
        "SELECT 'X' AS qid, abs(1)",
        "SELECT 'X' AS qid, pg_logical_emit_message(true, 'a', 'b')",
    ],
)
def test_쓰기_WITH_SET_금지함수는_실행_전에_거부한다(runner, sql):
    with pytest.raises(runner.RejectedStatement):
        runner.parse_sql(sql + ";")


@pytest.mark.parametrize("sql", ["SELECT E'a' AS qid", "SELECT U&'a' AS qid", 'SELECT "x" AS qid', "SELECT 'X;Y' AS qid", "SELECT 'X--Y' AS qid", "SELECT 'a%b' AS qid", "SELECT $$x$$ AS qid", "SELECT 'x' AS qid /* c */"])
def test_리터럴의_금지_문자와_블록_주석은_거부한다(runner, sql):
    with pytest.raises(runner.RejectedStatement):
        runner.parse_sql(sql + ";")


def test_첫_열이_qid_가_아니거나_ID가_중복이면_거부한다(runner):
    with pytest.raises(runner.RejectedStatement):
        runner.parse_sql("SELECT 1;")
    with pytest.raises(runner.RejectedStatement):
        runner.parse_sql("SELECT 'A1' AS qid; SELECT 'A1' AS qid;")


def test_주석은_무시하고_세미콜론으로_문장을_나눈다(runner):
    parsed = runner.parse_sql("-- 설명이 있어도; 주석은 무시\nSELECT 'A1' AS qid;\nSELECT 'A2' AS qid -- 뒤 주석\n;")
    assert [s.qid for s in parsed] == ["A1", "A2"]


# ── 접속·트랜잭션 강제 ──────────────────────────────────────────────────


def test_접속_설정은_읽기_전용_옵션과_타임아웃과_RR_READ_ONLY_를_담는다(runner):
    settings = runner.connection_settings()
    options = settings["connect_args"]["options"]
    assert "default_transaction_read_only=on" in options
    assert "statement_timeout=" in options
    assert settings["execution_options"] == {"isolation_level": "REPEATABLE READ", "postgresql_readonly": True}


class _FakeResult:
    def __init__(self, columns, rows):
        self._columns, self._rows = columns, rows

    def keys(self):
        return self._columns

    def fetchmany(self, n):
        return self._rows[:n]

    def fetchall(self):
        return self._rows


class _FakeConn:
    def __init__(self, rows_by_qid=None):
        self.executed: list[str] = []
        self.calls: list[str] = []
        self.rows_by_qid = rows_by_qid or {}

    def exec_driver_sql(self, sql):
        self.executed.append(sql)
        self.calls.append("exec")
        match = re.match(r"(?:EXPLAIN )?SELECT '([^']+)' AS qid", sql)
        if match:
            columns, rows = self.rows_by_qid.get(match.group(1), (["qid"], [[match.group(1)]]))
            return _FakeResult(columns, rows)
        return _FakeResult([], [])

    def rollback(self):
        self.calls.append("rollback")

    def commit(self):  # pragma: no cover - 호출되면 실패해야 한다
        self.calls.append("commit")


def _statements(runner, *qids):
    return [runner.Statement(q, f"SELECT '{q}' AS qid") for q in qids]


def test_실행은_SET_LOCAL_3개로_시작하고_ROLLBACK_으로_끝나며_COMMIT_이_없다(runner):
    conn = _FakeConn()
    runner.run_plan(conn, _statements(runner, "A1", "A2"), io.StringIO(), None)
    assert [s.startswith("SET LOCAL") for s in conn.executed] == [True, True, True, False, False]
    assert conn.calls[-1] == "rollback" and "commit" not in conn.calls


def test_도중_오류가_나도_ROLLBACK_한다(runner):
    conn = _FakeConn(rows_by_qid={"A2": (["qid", "email"], [["A2", "a" + "@" + "b.co"]])})
    with pytest.raises(runner.OutputGuardError):
        runner.run_plan(conn, _statements(runner, "A1", "A2"), io.StringIO(), None)
    assert conn.calls[-1] == "rollback"


def test_출력에_이메일_UUID_형식이_있으면_출력하지_않고_중단한다(runner):
    out = io.StringIO()
    conn = _FakeConn(rows_by_qid={"A1": (["qid", "v"], [["A1", str(uuid.UUID(int=0xA1))]])})
    with pytest.raises(runner.OutputGuardError):
        runner.run_plan(conn, _statements(runner, "A1"), out, None)
    assert "3f2c1a40" not in out.getvalue()


def test_결과가_행_상한을_넘으면_중단한다(runner):
    rows = [["A1", i] for i in range(runner.MAX_ROWS + 1)]
    conn = _FakeConn(rows_by_qid={"A1": (["qid", "n"], rows)})
    with pytest.raises(runner.OutputGuardError):
        runner.run_plan(conn, _statements(runner, "A1"), io.StringIO(), None)


# ── A4d 라벨 원문 분리 (M0-12 · U6) ──────────────────────────────────────


def test_A4d_는_include_labels_없이는_실행되지_않는다(runner):
    conn = _FakeConn()
    out = io.StringIO()
    runner.run_plan(conn, _statements(runner, "A1", "A4d"), out, None)
    assert not any("'A4d'" in sql for sql in conn.executed)
    assert "A4d: 건너뜀" in out.getvalue()


def test_A4d_결과는_일반_출력이_아닌_별도_파일로만_간다(runner):
    conn = _FakeConn(rows_by_qid={"A4d": (["qid", "label", "n"], [["A4d", "감정 코칭", 2]])})
    out, labels = io.StringIO(), io.StringIO()
    runner.run_plan(conn, _statements(runner, "A1", "A4d"), out, labels, include_labels=True)
    assert "감정 코칭" not in out.getvalue()
    assert "감정 코칭" in labels.getvalue()


def test_라벨_출력_파일_없이_include_labels_만으로는_실행하지_않는다(runner):
    conn = _FakeConn()
    with pytest.raises(runner.RejectedStatement):
        runner.run_plan(conn, _statements(runner, "A4d"), io.StringIO(), None, include_labels=True)
    assert not any("'A4d'" in sql for sql in conn.executed)


def test_라벨_파일은_0600_이고_덮어쓰지_않는다(runner, tmp_path):
    path = tmp_path / "out-labels-test.txt"
    handle = runner.open_labels_file(str(path))
    handle.write("x")
    handle.close()
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    with pytest.raises(FileExistsError):
        runner.open_labels_file(str(path))


def test_EXPLAIN_모드는_결과_행을_출력하지_않고_A4d_도_문법만_검증한다(runner):
    conn = _FakeConn()
    out = io.StringIO()
    runner.run_plan(conn, _statements(runner, "A1", "A4d"), out, None, explain_only=True)
    assert all(sql.startswith(("SET LOCAL", "EXPLAIN SELECT")) for sql in conn.executed)
    assert "A4d: EXPLAIN 통과" in out.getvalue()


def test_러너에_소량_셀_억제_로직이_없다():
    source = RUNNER_PATH.read_text(encoding="utf-8")
    assert not re.search(r"suppress|small[-_ ]cell|<\s*3\b|>=\s*3\b", source, re.IGNORECASE)


def test_check_only_는_DB_없이_정적_검사만_하고_sha256을_낸다(runner, capsys):
    assert runner.main([str(SQL_PATH), "--check-only"]) == 0
    out = capsys.readouterr().out
    assert re.search(r"sha256=[0-9a-f]{64} statements=\d+", out)
    assert runner.sha256_of(SQL_PATH.read_text(encoding="utf-8")) in out


def test_허용_목록_함수만_쓴다(runner, statements):
    called = set()
    for statement in statements:
        literal_free = runner._STRING_LITERAL.sub("''", statement.sql)
        called |= {n.lower() for n in runner._CALL.findall(literal_free)}
    assert called - runner._SQL_WORDS_BEFORE_PAREN <= runner.ALLOWED_FUNCTIONS


def test_접속에_실패하면_라벨_파일을_만들지_않는다(runner, tmp_path, monkeypatch, capsys):
    labels = tmp_path / "out-labels-x.txt"
    monkeypatch.setenv("DATABASE_URL", "postgresql://nobody:pw@localhost:1/none")
    code = runner.main([str(SQL_PATH), "--include-labels", "--labels-out", str(labels)])
    captured = capsys.readouterr()
    assert code == 5 and not labels.exists()
    assert "pw" not in captured.out + captured.err and "localhost" not in captured.out + captured.err
