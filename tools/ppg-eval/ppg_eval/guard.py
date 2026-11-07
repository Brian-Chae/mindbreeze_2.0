"""홀드아웃 잠금 (verify.md V8, H6). 홀드아웃 기록은 잠금 해제 토큰 없이는 어떤 경로로도 열리지 않는다."""
from __future__ import annotations

import json
import os
import subprocess
import time

from .common import REPO, RESULTS, TOOL_DIR, sha256_file
from .splits import load_splits

ACCESS_LOG = os.path.join(RESULTS, "access-log.jsonl")


class HoldoutLocked(PermissionError):
    pass


# ---- 4단계 해제 경로 (verify-addendum-10). 이번 1회 평가에만 쓴다. 검증 통과 시에만 _UNLOCKED=True.
APPROVER = "Brian Chae 11/7 대화 승인"
CANDIDATES = ["C0", "W4a", "W2a"]
APPROVAL_PATH = os.path.join(TOOL_DIR, "holdout-approval.json")
HOLDOUT_DIR = os.path.join(RESULTS, "holdout")
RUN_RECORD = os.path.join(HOLDOUT_DIR, "run-record.json")
TOOL_REL = "tools/ppg-eval"
_UNLOCKED = False


def _git(repo: str, *a: str) -> str:
    return subprocess.run(["git", "-C", repo, *a], capture_output=True, text=True, check=True).stdout.strip()


def _strip_freeze(reg: dict) -> dict:
    out = json.loads(json.dumps(reg))
    out.get("phase4_holdout", {}).pop("freeze", None)
    return out


def verify_unlock(token: str | None, approval_path: str = APPROVAL_PATH, run_record: str = RUN_RECORD, repo: str = REPO, tool_rel: str = TOOL_REL) -> dict:
    """해제 조건 전부 검증. 하나라도 어긋나면 HoldoutLocked. 통과해도 _UNLOCKED 는 unlock() 이 켠다.

    (1) 실행 기록 없음(재실행 거부) (2) 승인 토큰 파일이 커밋돼 있고 내용·토큰 일치
    (3) 동결 SHA 는 HEAD 의 조상이며 HEAD 와 사이에 평가 코드·후보 정의 변경이 없음(승인 파일·freeze 기록 외)
    (4) 평가 코드 트리 해시 동일 (5) 작업 트리 변경 없음(results/holdout 산출물 제외)
    """
    if os.path.exists(run_record):
        raise HoldoutLocked("홀드아웃은 이미 1회 실행됨(실행 기록 존재) — 재실행 거부")
    if not os.path.exists(approval_path):
        raise HoldoutLocked("승인 토큰 파일 없음")
    with open(approval_path, "r", encoding="utf-8") as f:
        ap = json.load(f)
    if ap.get("approver") != APPROVER or ap.get("candidates") != CANDIDATES:
        raise HoldoutLocked("승인자·후보가 사전등록과 다름")
    sha = ap.get("frozen_sha", "")
    if len(sha) != 40:
        raise HoldoutLocked("승인 파일에 동결 SHA 없음")
    if not token or token != sha256_file(approval_path):
        raise HoldoutLocked("--unlock-token 이 승인 파일 sha256 과 다름")
    rel_ap = os.path.relpath(approval_path, repo)
    try:
        _git(repo, "ls-files", "--error-unmatch", rel_ap)
    except subprocess.CalledProcessError:
        raise HoldoutLocked("승인 파일이 커밋되지 않음")
    try:
        _git(repo, "merge-base", "--is-ancestor", sha, "HEAD")
    except subprocess.CalledProcessError:
        raise HoldoutLocked("동결 SHA 가 HEAD 의 조상이 아님")
    allowed = {f"{tool_rel}/holdout-approval.json", f"{tool_rel}/experiments.json", f"{tool_rel}/results/access-log.jsonl"}
    changed = set(filter(None, _git(repo, "diff", "--name-only", sha, "HEAD").splitlines()))
    extra = changed - allowed
    if extra:
        raise HoldoutLocked(f"동결 이후 허용 밖 파일 변경: {sorted(extra)}")
    reg_a = json.loads(_git(repo, "show", f"{sha}:{tool_rel}/experiments.json"))
    reg_h = json.loads(_git(repo, "show", f"HEAD:{tool_rel}/experiments.json"))
    if _strip_freeze(reg_a) != _strip_freeze(reg_h):
        raise HoldoutLocked("experiments.json 이 동결 이후 freeze 기록 외에도 변경됨")
    if reg_h.get("phase4_holdout", {}).get("freeze", {}).get("sha") != sha:
        raise HoldoutLocked("experiments.json freeze.sha 가 승인 파일 동결 SHA 와 다름")
    for path in (f"{tool_rel}/ppg_eval", f"{tool_rel}/tests", f"{tool_rel}/splits.json", "packages/measurement-core/src"):
        try:
            a, h = _git(repo, "rev-parse", f"{sha}:{path}"), _git(repo, "rev-parse", f"HEAD:{path}")
        except subprocess.CalledProcessError:
            continue
        if a != h:
            raise HoldoutLocked(f"트리 해시 불일치: {path}")
    dirty = _git(repo, "status", "--porcelain", "--", tool_rel, "packages/measurement-core/src", "specs")
    dirty = "\n".join(l for l in dirty.splitlines() if "/results/holdout/" not in l)
    if dirty:
        raise HoldoutLocked("작업 트리 변경 있음:\n" + dirty)
    return {"frozen_sha": sha, "head": _git(repo, "rev-parse", "HEAD"), "approval_sha256": sha256_file(approval_path)}


def unlock(token: str | None, **kw) -> dict:
    global _UNLOCKED
    info = verify_unlock(token, **kw)
    _UNLOCKED = True
    return info


def relock() -> None:
    global _UNLOCKED
    _UNLOCKED = False


def _log(event: dict) -> None:
    os.makedirs(RESULTS, exist_ok=True)
    event = dict(event)
    event["t_unix"] = int(time.time())
    with open(ACCESS_LOG, "a", encoding="utf-8") as f:
        f.write(json.dumps(event, ensure_ascii=False, sort_keys=True) + "\n")


def is_holdout(ds: str, rid: str) -> bool:
    s = load_splits()
    if ds == "capnobase":
        return True
    return rid in set(s["holdout"].get(ds, []))


def require_open(ds: str, rid: str, unlock: str | None = None) -> None:
    """개발 기록이면 로그만 남기고 통과. 홀드아웃이면 잠금 예외 (시도도 로그)."""
    if is_holdout(ds, rid) and _UNLOCKED:
        _log({"event": "holdout_open", "ds": ds, "rid": rid})
        return
    if is_holdout(ds, rid):
        _log({"event": "holdout_access_denied" if unlock is None else "holdout_access_attempt_with_token", "ds": ds, "rid": rid})
        if unlock is None:
            raise HoldoutLocked(f"홀드아웃 기록 접근 금지: {ds}/{rid} (verify.md V8)")
        # 토큰 인자만으로는 열리지 않는다: 해제는 unlock() 검증(verify_unlock)을 통과해 _UNLOCKED 가 켜진 경우뿐이다.
        raise HoldoutLocked("토큰 인자로는 열리지 않음 — guard.unlock() 검증 필요")
    _log({"event": "dev_open", "ds": ds, "rid": rid})
