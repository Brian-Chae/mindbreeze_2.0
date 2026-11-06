"""코어 example 빌드·호출·CSV 파싱. 코어 src 가 깨끗하지 않으면 실행을 거부한다(verify V5)."""
from __future__ import annotations

import csv
import io
import os
import subprocess

import numpy as np

from .common import REPO, TOOL_DIR

CORE_DIR = os.path.join(REPO, "packages", "measurement-core")
TARGET = os.path.join(TOOL_DIR, ".cargo-target")
EXE = os.path.join(TARGET, "release", "examples", "replay_eval")


def _git(*a):
    return subprocess.run(["git", "-C", REPO, *a], capture_output=True, text=True, check=True).stdout.strip()


def core_provenance() -> dict:
    dirty = _git("status", "--porcelain", "--", "packages/measurement-core/src", "packages/measurement-core/Cargo.toml", "packages/measurement-core/Cargo.lock")
    if dirty:
        raise RuntimeError("코어 src/Cargo 가 수정됨 — 실행 거부:\n" + dirty)
    return {"repo_head": _git("rev-parse", "HEAD"), "core_src_tree": _git("rev-parse", "HEAD:packages/measurement-core/src"), "core_clean": True}


def build() -> None:
    env = dict(os.environ, CARGO_TARGET_DIR=TARGET)
    subprocess.run(["cargo", "build", "--release", "--offline", "--example", "replay_eval"], cwd=CORE_DIR, env=env, check=True, capture_output=True)


def run_core(pkts_path: str) -> list[dict]:
    p = subprocess.run([EXE, pkts_path], capture_output=True, text=True, check=True)
    rows = []
    for r in csv.DictReader(io.StringIO(p.stdout)):
        f = lambda s: float(s) if s != "" else None
        rows.append(
            {
                "k": int(r["k"]),
                "win_end_ts": float(r["win_end_ts"]),
                "hr": f(r["hr"]),
                "sdnn": f(r["sdnn"]),
                "rmssd": f(r["rmssd"]),
                "resp": f(r["resp"]),
                "resp_reason": r["resp_reason"],
                "rr_buf": int(r["rr_buf"]),
                "hr_raw": float(r["heart_rate_raw"]),
                "rr": [float(x) for x in r["rr_list"].split(";")] if r["rr_list"] else [],
                "rr_end_ts": [float(x) for x in r["rr_end_ts_list"].split(";")] if r["rr_end_ts_list"] else [],
            }
        )
    return rows
