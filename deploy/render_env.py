#!/usr/bin/env python3
"""SDD-210 T-3: SSM Parameter Store → /etc/mindbreeze/prod.env 렌더러 (표준 라이브러리 + aws CLI).

- 매니페스트(env-manifest.tsv)에 정의된 키만 허용한다. 알 수 없는 파라미터·금지 키(AWS 액세스 키)는 실패.
- ENVIRONMENT=production 명시 여부, 필수 키 누락, 값의 dev 흔적을 검사한다. **값은 어떤 출력에도 싣지 않는다**(키 이름만).
- 출력 파일은 임시 파일에 0600 으로 쓴 뒤 원자적으로 교체한다. systemd EnvironmentFile 형식(값은 큰따옴표).

사용:  python3 render_env.py --ssm-path /mindbreeze/prod/ --out /etc/mindbreeze/prod.env [--region ap-northeast-1]
검증만: python3 render_env.py --check-file /etc/mindbreeze/prod.env   (키 이름·존재 여부만 확인)
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
FORBIDDEN_KEYS = {"AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"}
DEV_MARKERS = ("://dev.", "dev-api.", "mindbreeze-dev", "mindbreeze_dev", "18.183.86.88", "devkey")


class EnvRenderError(RuntimeError):
    pass


def load_manifest(path: Path = HERE / "env-manifest.tsv") -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    lines = [ln for ln in path.read_text(encoding="utf-8").splitlines() if ln.strip() and not ln.startswith("#")]
    header = lines[0].split("\t")
    for ln in lines[1:]:
        cols = ln.split("\t")
        cols += [""] * (len(header) - len(cols))
        rows.append(dict(zip(header, cols)))
    return rows


def quote(value: str) -> str:
    if "\n" in value or "\r" in value or "\x00" in value:
        raise EnvRenderError("값에 개행/NUL 포함")
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def build_env(params: dict[str, str], manifest: list[dict[str, str]] | None = None) -> tuple[str, list[str]]:
    """SSM 파라미터 맵(키→값) → (env 파일 텍스트, 경고 목록). 문제가 있으면 EnvRenderError(키 이름만 포함)."""
    manifest = manifest or load_manifest()
    known = {r["key"] for r in manifest}
    problems: list[str] = []

    for key in params:
        if key in FORBIDDEN_KEYS:
            problems.append(f"금지 키 {key} (인스턴스 역할 사용)")
        elif key not in known:
            problems.append(f"매니페스트에 없는 키 {key}")

    out: dict[str, str] = {}
    for row in manifest:
        key, source, required = row["key"], row["source"], row["required"] == "1"
        if source == "static":
            if key in params and params[key] != row["static_value"]:
                problems.append(f"{key} 는 static 값 고정 — SSM 값이 다름")
            out[key] = row["static_value"]
        else:
            val = params.get(key, "")
            if val == "":
                if required:
                    problems.append(f"필수 키 {key} 누락")
                continue
            out[key] = val

    if out.get("ENVIRONMENT") != "production":
        problems.append("ENVIRONMENT=production 이 아님")
    for key, val in out.items():
        low = val.lower()
        if any(m in low for m in DEV_MARKERS):
            problems.append(f"{key} 값에 dev 흔적")
    if out.get("RESEARCH_EXPORT_ENABLED") == "true" and not out.get("RESEARCH_EXPORT_ACK_TOKEN"):
        problems.append("RESEARCH_EXPORT_ACK_TOKEN 필요")
    if bool(out.get("FCM_PROJECT_ID")) != bool(out.get("FCM_SERVICE_ACCOUNT_JSON")):
        problems.append("FCM_PROJECT_ID/FCM_SERVICE_ACCOUNT_JSON 한쪽만 설정")
    if bool(out.get("VAPID_PUBLIC_KEY")) != bool(out.get("VAPID_PRIVATE_KEY")):
        problems.append("VAPID 공개키/개인키 한쪽만 설정")
    if problems:
        raise EnvRenderError("; ".join(problems))

    lines = ["# 자동 생성 — deploy/render_env.py (직접 편집 금지). 값은 SSM /mindbreeze/prod/* 가 원천."]
    for row in manifest:  # 매니페스트 순서 고정(재현성)
        if row["key"] in out:
            lines.append(f"{row['key']}={quote(out[row['key']])}")
    return "\n".join(lines) + "\n", []


def fetch_ssm(path: str, region: str | None) -> dict[str, str]:
    cmd = ["aws", "ssm", "get-parameters-by-path", "--path", path, "--recursive", "--with-decryption", "--output", "json"]
    if region:
        cmd += ["--region", region]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise EnvRenderError(f"SSM 조회 실패(exit {res.returncode}) — 권한/경로 확인")  # stderr 는 값 노출 가능성 때문에 생략
    data = json.loads(res.stdout)
    prefix = path.rstrip("/") + "/"
    return {p["Name"][len(prefix):]: p["Value"] for p in data.get("Parameters", []) if p["Name"].startswith(prefix)}


def write_atomic(target: Path, text: str) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(target.parent), prefix=".prod.env.")
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text)
        os.replace(tmp, target)
    except Exception:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def check_file(path: Path) -> list[str]:
    """생성된 env 파일의 키 이름 점검(값 미출력)."""
    keys = [ln.split("=", 1)[0] for ln in path.read_text(encoding="utf-8").splitlines() if re.match(r"^[A-Z0-9_]+=", ln)]
    problems = [f"금지 키 {k}" for k in keys if k in FORBIDDEN_KEYS]
    if "ENVIRONMENT" not in keys:
        problems.append("ENVIRONMENT 미명시")
    mode = path.stat().st_mode & 0o777
    if mode != 0o600:
        problems.append(f"파일 권한 {oct(mode)} (0600 필요)")
    return problems


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ssm-path", default="/mindbreeze/prod/")
    ap.add_argument("--out")
    ap.add_argument("--region")
    ap.add_argument("--check-file")
    args = ap.parse_args(argv)
    try:
        if args.check_file:
            problems = check_file(Path(args.check_file))
            if problems:
                print("점검 실패: " + "; ".join(problems), file=sys.stderr)
                return 2
            print("점검 통과")
            return 0
        if not args.out:
            ap.error("--out 필요")
        text, _ = build_env(fetch_ssm(args.ssm_path, args.region))
        write_atomic(Path(args.out), text)
    except EnvRenderError as exc:
        print(f"환경 렌더 실패: {exc}", file=sys.stderr)
        return 2
    print(f"렌더 완료: {args.out} ({text.count(chr(10)) - 1}개 키, 값 미출력)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
