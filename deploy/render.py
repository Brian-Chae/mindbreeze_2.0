#!/usr/bin/env python3
"""SDD-210 T-3: 서버 구성 템플릿 렌더러 (표준 라이브러리만 사용).

deploy/templates/**/*.tpl 의 `@@NAME@@` 토큰을 값으로 치환해 출력 디렉터리에 쓴다.
- 값 출처 우선순위: `--set NAME=VALUE` > 환경변수 `MB_RENDER_NAME` > 내장 기본값(DEFAULTS).
- 시크릿 변수(SECRET_VARS)는 `--set` 으로 주지 말고 환경변수로만 전달한다(셸 히스토리·프로세스 목록 노출 방지).
  시크릿을 포함한 출력 파일은 0600 으로 쓰고, 어떤 경우에도 값은 stdout/stderr 에 출력하지 않는다.
- 해석되지 않은 토큰이 있으면 실패한다(조용한 누락 금지).
- 출력: livekit.yaml · turnserver.conf · nginx · systemd 유닛 · jobs.tsv 기반 timer/drop-in 생성.

사용:
  MB_RENDER_LIVEKIT_API_KEY=... MB_RENDER_LIVEKIT_API_SECRET=... MB_RENDER_TURN_STATIC_AUTH_SECRET=... \
  python3 render.py --out /tmp/mb-render --set WEB_HOST=mindbreeze.looxidlabs.com \
      --set API_HOST=api.mindbreeze.looxidlabs.com --set PUBLIC_IP=203.0.113.10 --set PRIVATE_IP=10.20.1.10
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
TOKEN_RE = re.compile(r"@@([A-Z][A-Z0-9_]*)@@")

DEFAULTS: dict[str, str] = {
    "PREFIX": "/opt/mindbreeze",
    "SERVICE_USER": "mindbreeze",
    "ENV_FILE": "/etc/mindbreeze/prod.env",
    "CERT_NAME": "",  # 미지정 시 WEB_HOST 사용
    "LIVEKIT_UDP_PORT_START": "50000",
    "LIVEKIT_UDP_PORT_END": "50200",
    "TURN_MIN_PORT": "49152",
    "TURN_MAX_PORT": "49200",
}
SECRET_VARS = {"LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "TURN_STATIC_AUTH_SECRET"}

# 렌더 결과에 있으면 안 되는 dev 흔적(운영 렌더 검증용). 값 자체가 아니라 패턴만 검사한다.
DEV_MARKERS = ("dev.mindbreeze", "dev-api.", "mindbreeze-dev", "18.183.86.88")

# 템플릿 → 출력 상대경로
STATIC_OUTPUTS: dict[str, str] = {
    "nginx/mindbreeze.conf.tpl": "etc/nginx/sites-available/mindbreeze.conf",
    "livekit/livekit.yaml.tpl": "etc/livekit/livekit.yaml",
    "coturn/turnserver.conf.tpl": "etc/turnserver.conf",
    "systemd/mindbreeze-backend.service.tpl": "etc/systemd/system/mindbreeze-backend.service",
    "systemd/mindbreeze-worker.service.tpl": "etc/systemd/system/mindbreeze-worker.service",
    "systemd/mindbreeze-email-worker.service.tpl": "etc/systemd/system/mindbreeze-email-worker.service",
    "systemd/mindbreeze-export-worker.service.tpl": "etc/systemd/system/mindbreeze-export-worker.service",
    "systemd/livekit.service.tpl": "etc/systemd/system/livekit.service",
    "systemd/mindbreeze-job@.service.tpl": "etc/systemd/system/mindbreeze-job@.service",
    "systemd/mindbreeze-job-failed@.service.tpl": "etc/systemd/system/mindbreeze-job-failed@.service",
}
# 렌더 그룹: app = 릴리스마다 갱신하는 앱 유닛·timer(시크릿·환경별 IP 불필요) / infra = nginx·livekit·coturn(서버 구성, T-14)
APP_OUTPUTS = {k for k in STATIC_OUTPUTS if k.startswith("systemd/") and "livekit.service" not in k}
SECRET_FILE_MODES: dict[str, int] = {
    "etc/livekit/livekit.yaml": 0o600,
    "etc/turnserver.conf": 0o640,
}

TIMER_TEMPLATE = """# MIND BREEZE 2.0 — 주기 작업 timer: {name} ({note})
[Unit]
Description=MIND BREEZE job timer {name}

[Timer]
OnCalendar={on_calendar}
AccuracySec=1s
Persistent=false
Unit=mindbreeze-job@{name}.service

[Install]
WantedBy=timers.target
"""
DROPIN_TEMPLATE = """# MIND BREEZE 2.0 — {name} 타임아웃 (jobs.tsv)
[Service]
TimeoutStartSec={timeout_s}
"""


class RenderError(RuntimeError):
    pass


def load_jobs(path: Path) -> list[dict[str, str]]:
    """jobs.tsv → 작업 목록. 헤더 필수, 이름·스크립트 중복/형식 검증."""
    lines = [ln for ln in path.read_text(encoding="utf-8").splitlines() if ln.strip() and not ln.startswith("#")]
    if not lines:
        raise RenderError("jobs.tsv 가 비어 있음")
    header = lines[0].split("\t")
    want = ["name", "script", "on_calendar", "timeout_s", "enabled", "note"]
    if header != want:
        raise RenderError(f"jobs.tsv 헤더 불일치: {header}")
    jobs: list[dict[str, str]] = []
    seen: set[str] = set()
    for ln in lines[1:]:
        cols = ln.split("\t")
        if len(cols) != len(want):
            raise RenderError(f"jobs.tsv 열 수 오류: {ln[:60]}")
        job = dict(zip(want, cols))
        if not re.fullmatch(r"[a-z][a-z0-9_]*", job["name"]):
            raise RenderError(f"작업 이름 형식 오류: {job['name']}")
        if job["script"] != f"{job['name']}_cron.py":
            raise RenderError(f"스크립트 규칙 위반(name_cron.py): {job['name']}")
        if job["name"] in seen:
            raise RenderError(f"작업 이름 중복: {job['name']}")
        if not job["timeout_s"].isdigit() or job["enabled"] not in ("0", "1"):
            raise RenderError(f"timeout_s/enabled 형식 오류: {job['name']}")
        seen.add(job["name"])
        jobs.append(job)
    return jobs


def resolve_vars(cli_sets: list[str], environ: dict[str, str] | None = None) -> dict[str, str]:
    environ = os.environ if environ is None else environ
    values: dict[str, str] = dict(DEFAULTS)
    for key, val in environ.items():
        if key.startswith("MB_RENDER_") and val != "":
            values[key[len("MB_RENDER_"):]] = val
    for item in cli_sets:
        if "=" not in item:
            raise RenderError(f"--set 형식 오류(NAME=VALUE): {item.split('=')[0]}")
        key, val = item.split("=", 1)
        if key in SECRET_VARS:
            raise RenderError(f"{key} 는 --set 으로 줄 수 없음 — 환경변수 MB_RENDER_{key} 로 전달")
        values[key] = val
    if not values.get("CERT_NAME") and values.get("WEB_HOST"):
        values["CERT_NAME"] = values["WEB_HOST"]
    if not values.get("TURN_REALM") and values.get("WEB_HOST"):
        values["TURN_REALM"] = values["WEB_HOST"]
    return values


def render_text(text: str, values: dict[str, str], source: str) -> str:
    missing = sorted({m for m in TOKEN_RE.findall(text) if not values.get(m)})
    if missing:
        raise RenderError(f"{source}: 값이 없는 변수 {', '.join(missing)}")
    return TOKEN_RE.sub(lambda m: values[m.group(1)], text)


def validate_values(values: dict[str, str]) -> None:
    for name in ("PUBLIC_IP", "PRIVATE_IP"):
        v = values.get(name, "")
        if v and not re.fullmatch(r"\d{1,3}(\.\d{1,3}){3}", v):
            raise RenderError(f"{name} 형식 오류")
    for name in ("WEB_HOST", "API_HOST"):
        v = values.get(name, "")
        if v and not re.fullmatch(r"[a-z0-9]([a-z0-9.-]*[a-z0-9])?", v):
            raise RenderError(f"{name} 형식 오류")
    for name, v in values.items():
        if name not in SECRET_VARS and re.search(r"[\s]", v) and name not in ("TURN_REALM",):
            raise RenderError(f"{name} 에 공백/개행 불가")
        if name in SECRET_VARS and re.search(r"[\s:#\"']", v):
            raise RenderError(f"{name} 에 공백/개행/콜론/따옴표/# 불가(설정 파일 깨짐 방지)")


def write(out: Path, rel: str, content: str, mode: int = 0o644) -> None:
    target = out / rel
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    target.chmod(mode)


def render_all(out: Path, values: dict[str, str], templates: Path = HERE / "templates", jobs_file: Path = HERE / "jobs.tsv",
               allow_dev_markers: bool = False, only: str | None = None) -> list[str]:
    """only=None: 전체 / "app": 앱 유닛·job timer 만(install-release.sh 가 릴리스마다 사용) / "infra": 나머지."""
    validate_values(values)
    written: list[str] = []
    for tpl_rel, out_rel in STATIC_OUTPUTS.items():
        if only == "app" and tpl_rel not in APP_OUTPUTS:
            continue
        if only == "infra" and tpl_rel in APP_OUTPUTS:
            continue
        text = (templates / tpl_rel).read_text(encoding="utf-8")
        rendered = render_text(text, values, tpl_rel)
        write(out, out_rel, rendered, SECRET_FILE_MODES.get(out_rel, 0o644))
        written.append(out_rel)
    for job in load_jobs(jobs_file):
        if only == "infra":
            break
        if job["enabled"] != "1":
            continue
        timer = TIMER_TEMPLATE.format(name=job["name"], note=job["note"].split("—")[0].strip(), on_calendar=job["on_calendar"])
        write(out, f"etc/systemd/system/mindbreeze-job-{job['name']}.timer", timer)
        dropin = DROPIN_TEMPLATE.format(name=job["name"], timeout_s=job["timeout_s"])
        write(out, f"etc/systemd/system/mindbreeze-job@{job['name']}.service.d/timeout.conf", dropin)
        written += [f"etc/systemd/system/mindbreeze-job-{job['name']}.timer",
                    f"etc/systemd/system/mindbreeze-job@{job['name']}.service.d/timeout.conf"]
    if not allow_dev_markers:
        for rel in written:
            body = (out / rel).read_text(encoding="utf-8").lower()
            for marker in DEV_MARKERS:
                if marker in body:
                    raise RenderError(f"{rel}: dev 흔적 '{marker}' 발견 — 렌더 중단")
    return written


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True, help="출력 루트 디렉터리(서버 루트 구조로 생성)")
    ap.add_argument("--set", dest="sets", action="append", default=[], help="NAME=VALUE (시크릿 변수 제외)")
    ap.add_argument("--allow-dev-markers", action="store_true", help="dev 흔적 검사 생략(dev 서버 재현용)")
    ap.add_argument("--only", choices=["app", "infra"], help="app=앱 유닛·timer 만, infra=nginx/livekit/coturn 만")
    args = ap.parse_args(argv)
    try:
        values = resolve_vars(args.sets)
        written = render_all(Path(args.out), values, allow_dev_markers=args.allow_dev_markers, only=args.only)
    except RenderError as exc:
        print(f"렌더 실패: {exc}", file=sys.stderr)
        return 2
    print(f"렌더 완료: {len(written)}개 파일 → {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
