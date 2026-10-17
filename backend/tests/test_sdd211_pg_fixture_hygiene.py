"""SDD-211 P2 준비 — PG 픽스처 위생 가드 단위 테스트 (PG-6)."""

from __future__ import annotations

import importlib.util
import uuid
from pathlib import Path

import pytest

FIXTURES = Path(__file__).parent / "fixtures" / "pg"


@pytest.fixture(scope="module")
def hygiene():
    spec = importlib.util.spec_from_file_location("pg_fixture_hygiene", FIXTURES / "check_fixture_hygiene.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


CLEAN_DUMP = """
CREATE TABLE public.users (id uuid DEFAULT gen_random_uuid() NOT NULL, email character varying);
COPY public.alembic_version (version_num) FROM stdin;
e036a0000051
\\.
INSERT INTO public.alembic_version (version_num) VALUES ('e036a0000051');
"""


def test_깨끗한_스키마_덤프는_통과하고_alembic_version_한_행은_허용한다(hygiene):
    assert hygiene.scan_text(CLEAN_DUMP, allow_rows=False) == []


@pytest.mark.parametrize(
    "line",
    [
        "INSERT INTO public.users (email) VALUES ('a@example.com');",
        "COPY public.users (id, email) FROM stdin;",
        "insert into sessions values (1);",
    ],
)
def test_덤프의_데이터_행은_alembic_version_외에는_실패한다(hygiene, line):
    assert hygiene.scan_text(line, allow_rows=False)


def test_alembic_version_COPY_데이터_줄은_다음_테이블_COPY_와_구분된다(hygiene):
    text = "COPY public.alembic_version (version_num) FROM stdin;\nx\n\\.\nCOPY public.users (id) FROM stdin;\n"
    problems = hygiene.scan_text(text, allow_rows=False)
    assert len(problems) == 1 and problems[0].startswith("4:")


@pytest.mark.parametrize(
    "line, keyword",
    [
        ("-- 문의 real.person" + "@" + "gmail.com", "이메일"),
        ("-- 010-1234-5678", "전화번호"),
        ("-- " + str(uuid.UUID(int=0xA1)), "UUID"),
        ("-- host " + ".".join(["10", "0", "12", "34"]), "IPv4"),
        ("-- eyJhbGciOiJIUzI1NiJ9.payload", "JWT"),
        ("-- AKIAABCDEFGHIJKLMNOP", "AWS"),
        ("-- postgresql://user:pw@db/x", "접속 문자열"),
    ],
)
def test_개인정보_UUID_비밀_형식은_실패한다(hygiene, line, keyword):
    problems = hygiene.scan_text(line, allow_rows=True)
    assert problems and keyword in problems[0]


def test_example_com_이메일은_허용한다(hygiene):
    assert hygiene.scan_text("-- seed@example.com, 버전 16.13.0", allow_rows=True) == []


def test_합성_시드는_INSERT_를_허용하되_형식_규칙은_적용한다(hygiene):
    assert hygiene.scan_text("INSERT INTO users (email) VALUES ('seed@example.com');", allow_rows=True) == []
    assert hygiene.scan_text("INSERT INTO users (email) VALUES ('seed" + "@" + "corp.com');", allow_rows=True)


def test_저장소의_PG_픽스처_디렉터리는_위반이_없다(hygiene):
    assert hygiene.scan_directory(FIXTURES) == {}
    assert (FIXTURES / "seed_synthetic.sql").exists()
