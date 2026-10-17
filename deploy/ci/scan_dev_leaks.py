#!/usr/bin/env python3
"""SDD-210 T-4: 릴리스 산출물 dev 흔적 검사 (verify V-2.1·V-2.2).

릴리스 스테이징 디렉터리 전체에서 dev 주소·버킷·IP 를 찾는다. 허용목록(allowlist) 외에서 발견되면 exit 1.
- 공통 패턴: dev-api · dev.mindbreeze · mindbreeze-dev · 18.183.86.88
- `dist/` 아래는 추가로 역할 시뮬레이션 흔적(ROLE_SIM · dev/auth)도 금지하며 **허용목록 적용 안 함**.
- 허용목록: `<glob>\t<사유>` 한 줄씩. 사유 없는 항목은 거부한다(왜 허용인지 남기기).
출력에는 파일 경로·패턴·줄 번호만 싣고 주변 내용은 싣지 않는다.
"""
from __future__ import annotations

import argparse
import fnmatch
import re
import sys
from pathlib import Path

COMMON = re.compile(rb"dev-api|dev\.mindbreeze|mindbreeze-dev|18\.183\.86\.88", re.IGNORECASE)
DIST_EXTRA = re.compile(rb"ROLE_SIM|dev/auth", re.IGNORECASE)


def load_allowlist(path: Path | None) -> list[str]:
    if not path:
        return []
    globs: list[str] = []
    for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip() or line.startswith("#"):
            continue
        parts = line.split("\t")
        if len(parts) < 2 or not parts[1].strip():
            raise SystemExit(f"허용목록 {n}행: 사유(2번째 열) 필수")
        globs.append(parts[0].strip())
    return globs


def scan(root: Path, allow: list[str], skip_suffixes: tuple[str, ...] = (".pyc",)) -> list[str]:
    findings: list[str] = []
    for p in sorted(root.rglob("*")):
        if not p.is_file() or p.suffix in skip_suffixes or "__pycache__" in p.parts:
            continue
        rel = p.relative_to(root).as_posix()
        in_dist = rel.startswith("dist/")
        if not in_dist and any(fnmatch.fnmatch(rel, g) for g in allow):
            continue
        data = p.read_bytes()
        pats = [COMMON] + ([DIST_EXTRA] if in_dist else [])
        for pat in pats:
            for m in pat.finditer(data):
                line = data.count(b"\n", 0, m.start()) + 1
                findings.append(f"{rel}:{line}: '{m.group(0).decode('utf-8', 'replace').lower()}'")
    return findings


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("root", help="릴리스 스테이징 디렉터리")
    ap.add_argument("--allowlist", default="")
    args = ap.parse_args(argv)
    root = Path(args.root)
    if not root.is_dir():
        print(f"디렉터리 없음: {root}", file=sys.stderr)
        return 2
    findings = scan(root, load_allowlist(Path(args.allowlist) if args.allowlist else None))
    if findings:
        print(f"::error::dev 흔적 {len(findings)}건 발견 (허용목록 외)", file=sys.stderr)
        for f in findings[:50]:
            print("  " + f, file=sys.stderr)
        return 1
    print("dev 흔적 0건 (허용목록 제외)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
