"""PG 픽스처(스키마 덤프·합성 시드) 위생 가드 (SDD-211 P2 준비).

스키마 전용 덤프(`baseline_*.sql`)는 DDL 만 담아야 한다: 실데이터 행(`COPY`/`INSERT INTO`, alembic_version 제외)·
개인정보·UUID 실값·토큰·접속 문자열이 있으면 실패한다. 합성 시드(`seed_*.sql`)는 INSERT 를 허용하되
이메일은 `@example.com`, 전화번호·UUID 리터럴·토큰·IP 는 금지한다.
사용: `python check_fixture_hygiene.py [디렉터리]` — 위반이 있으면 종료코드 1.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

_EMAIL = re.compile(r"[\w.+-]+@([\w-]+(?:\.[\w-]+)+)")
_PHONE = re.compile(r"(?<!\d)(?:01[016789]|02|0[3-6]\d)-?\d{3,4}-?\d{4}(?!\d)")
_UUID = re.compile(r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b")
_IPV4 = re.compile(r"(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])")
_SECRETS = (
    ("JWT", re.compile(r"eyJ[A-Za-z0-9_-]{10,}\.")),
    ("AWS 키", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("접속 문자열", re.compile(r"postgres(?:ql)?(?:\+\w+)?://", re.IGNORECASE)),
)
_ROW_DATA = re.compile(r"^\s*(COPY\s+(\S+)|INSERT\s+INTO\s+(\S+))", re.IGNORECASE)


def scan_text(text: str, *, allow_rows: bool) -> list[str]:
    """위반 설명 목록(빈 목록이면 통과). 줄 번호만 적고 내용 전체는 출력하지 않는다."""
    problems: list[str] = []
    in_copy_version = False
    for number, line in enumerate(text.splitlines(), start=1):
        if in_copy_version:
            in_copy_version = line.strip() != r"\."
            continue
        row = _ROW_DATA.match(line)
        if row:
            target = (row.group(2) or row.group(3) or "").lower()
            if "alembic_version" in target:
                in_copy_version = bool(row.group(2))
            elif not allow_rows:
                problems.append(f"{number}: 데이터 행({target}) — 스키마 전용 덤프에는 COPY/INSERT INTO 가 없어야 한다")
        for match in _EMAIL.finditer(line):
            if match.group(1).lower() != "example.com":
                problems.append(f"{number}: example.com 이 아닌 이메일 형식")
        if _PHONE.search(line):
            problems.append(f"{number}: 전화번호 형식")
        if _UUID.search(line):
            problems.append(f"{number}: UUID 리터럴")
        if _IPV4.search(line):
            problems.append(f"{number}: IPv4 주소 형식")
        for label, pattern in _SECRETS:
            if pattern.search(line):
                problems.append(f"{number}: {label} 형식")
    return problems


def scan_directory(directory: Path) -> dict[str, list[str]]:
    result: dict[str, list[str]] = {}
    for path in sorted(directory.glob("*.sql")):
        allow_rows = path.name.startswith("seed_")
        problems = scan_text(path.read_text(encoding="utf-8"), allow_rows=allow_rows)
        if problems:
            result[path.name] = problems
    return result


def main(argv: list[str]) -> int:
    directory = Path(argv[1]) if len(argv) > 1 else Path(__file__).parent
    found = scan_directory(directory)
    for name, problems in found.items():
        for problem in problems:
            print(f"{name}:{problem}")
    files = sorted(p.name for p in directory.glob("*.sql"))
    print(f"위생 검사: 파일 {len(files)}개 {files}, 위반 {sum(len(v) for v in found.values())}건")
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
