#!/usr/bin/env python3
"""SDD-210 T-4: 마이그레이션 게이트 (DB 접속 없음, 정적 분석).

1) alembic head 가 정확히 1개인지 검사(실패 시 exit 1).
2) 파괴적 변경 감지(upgrade() 본문만): drop_table/drop_column/drop_constraint/alter_column(nullable=False·type_)/
   execute 의 DROP·DELETE·TRUNCATE·UPDATE → 경고 목록.
3) `--base-sha` 가 있으면 그 이후 추가된 마이그레이션만 파괴적 검사 대상으로 삼는다(이미 운영에 적용된 과거분 제외).
결과는 `--out` JSON 으로 저장: {"heads": [...], "destructive": bool, "warnings": [...], "scanned": [...]}.
destructive=true 면 deploy-prod 는 별도 확인 입력(confirm_destructive)이 있어야 진행한다(verify V-3.8).
"""
from __future__ import annotations

import argparse
import ast
import json
import re
import subprocess
import sys
from pathlib import Path

DESTRUCTIVE_OPS = {"drop_table", "drop_column", "drop_constraint", "drop_index", "drop_schema"}
SQL_DESTRUCTIVE = re.compile(r"\b(DROP\s+(TABLE|COLUMN|SCHEMA|INDEX)|DELETE\s+FROM|TRUNCATE|UPDATE\s+\w+)", re.IGNORECASE)


def _const(node: ast.AST | None):
    return node.value if isinstance(node, ast.Constant) else None


def parse_revision(path: Path) -> dict:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    rev: dict = {"file": path.name, "revision": None, "down": [], "warnings": []}
    for node in tree.body:
        target = None
        value = None
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            target, value = node.targets[0].id, node.value
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            target, value = node.target.id, node.value
        if target == "revision":
            rev["revision"] = _const(value)
        elif target == "down_revision":
            if isinstance(value, (ast.Tuple, ast.List)):
                rev["down"] = [_const(e) for e in value.elts if _const(e)]
            elif _const(value):
                rev["down"] = [_const(value)]
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == "upgrade":
            for call in ast.walk(node):
                if not isinstance(call, ast.Call):
                    continue
                name = call.func.attr if isinstance(call.func, ast.Attribute) else getattr(call.func, "id", "")
                if name in DESTRUCTIVE_OPS:
                    rev["warnings"].append(f"{path.name}: op.{name}")
                elif name == "alter_column":
                    for kw in call.keywords:
                        if (kw.arg == "nullable" and _const(kw.value) is False) or kw.arg == "type_":
                            rev["warnings"].append(f"{path.name}: alter_column({kw.arg})")
                elif name in ("execute", "exec_driver_sql"):
                    seg = ast.get_source_segment(path.read_text(encoding="utf-8"), call) or ""
                    if SQL_DESTRUCTIVE.search(seg):
                        rev["warnings"].append(f"{path.name}: execute(파괴적 SQL)")
    return rev


def added_since(repo: Path, base_sha: str, versions: Path) -> set[str]:
    res = subprocess.run(["git", "-C", str(repo), "diff", "--name-only", "--diff-filter=AM", f"{base_sha}..HEAD", "--", str(versions)],
                         capture_output=True, text=True)
    if res.returncode != 0:
        raise SystemExit(f"git diff 실패: base-sha 확인 필요 ({base_sha[:8]})")
    return {Path(p).name for p in res.stdout.split()}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--versions", default="backend/alembic/versions")
    ap.add_argument("--base-sha", default="", help="직전 운영 릴리스 SHA — 이후 추가분만 파괴적 검사")
    ap.add_argument("--repo", default=".")
    ap.add_argument("--out", default="")
    args = ap.parse_args(argv)

    versions = Path(args.versions)
    revs = [parse_revision(p) for p in sorted(versions.glob("*.py")) if p.name != "__init__.py"]
    ids = {r["revision"] for r in revs if r["revision"]}
    downs = {d for r in revs for d in r["down"]}
    heads = sorted(ids - downs)
    scope = None
    if args.base_sha:
        scope = added_since(Path(args.repo), args.base_sha, versions)
    scanned = [r for r in revs if scope is None or r["file"] in scope]
    warnings = [w for r in scanned for w in r["warnings"]]
    report = {"heads": heads, "destructive": bool(warnings), "warnings": warnings,
              "scanned": [r["file"] for r in scanned], "total_revisions": len(revs)}
    if args.out:
        Path(args.out).write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: report[k] for k in ("heads", "destructive", "warnings")}, ensure_ascii=False))
    if len(heads) != 1:
        print(f"::error::alembic head 가 {len(heads)}개입니다(1개여야 함): {heads}", file=sys.stderr)
        return 1
    if warnings:
        print(f"::warning::파괴적 마이그레이션 {len(warnings)}건 감지 — 릴리스 노트 경고, 배포 시 별도 확인 필요", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
