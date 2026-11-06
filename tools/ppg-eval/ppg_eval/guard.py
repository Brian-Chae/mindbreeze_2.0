"""홀드아웃 잠금 (verify.md V8, H6). 홀드아웃 기록은 잠금 해제 토큰 없이는 어떤 경로로도 열리지 않는다."""
from __future__ import annotations

import json
import os
import time

from .common import RESULTS
from .splits import load_splits

ACCESS_LOG = os.path.join(RESULTS, "access-log.jsonl")


class HoldoutLocked(PermissionError):
    pass


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
    if is_holdout(ds, rid):
        _log({"event": "holdout_access_denied" if unlock is None else "holdout_access_attempt_with_token", "ds": ds, "rid": rid})
        if unlock is None:
            raise HoldoutLocked(f"홀드아웃 기록 접근 금지: {ds}/{rid} (verify.md V8)")
        # 해제 경로: 이번 SDD 에서는 구현하지 않는다(대표 승인 후 알고리즘 동결 뒤 별도 단계).
        raise HoldoutLocked("홀드아웃 해제 경로는 동결 절차 전까지 비활성")
    _log({"event": "dev_open", "ds": ds, "rid": rid})
