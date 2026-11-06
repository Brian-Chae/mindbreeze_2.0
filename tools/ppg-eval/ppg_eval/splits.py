"""사전등록 분할 (verify.md V1). 규칙으로 재생성 가능해야 하며 splits.json 은 그 결과를 고정한다."""
from __future__ import annotations

import hashlib
import json
import os

from .common import DATA_ROOT, TOOL_DIR

SPLITS_PATH = os.path.join(TOOL_DIR, "splits.json")


def marsh_ids():
    root = os.path.join(DATA_ROOT, "marsh", "MARSH")
    return sorted(d for d in os.listdir(root) if os.path.isdir(os.path.join(root, d)))


def marsh_split(ids):
    ordered = sorted(ids, key=lambda i: hashlib.sha256(f"ppg-eval-v1:marsh:{i}".encode()).hexdigest())
    n_dev = 15
    return sorted(ordered[:n_dev]), sorted(ordered[n_dev:])


def bidmc_ids():
    return [f"{i:02d}" for i in range(1, 54)]


def mimic_ids(kind):
    n = {"non_af": 16, "af": 19}[kind]
    return [f"{i:03d}" for i in range(1, n + 1)]


def build_splits():
    dev_m, hold_m = marsh_split(marsh_ids())
    return {
        "rule": "marsh: sha256('ppg-eval-v1:marsh:'+id) 오름차순 앞 15=dev, 나머지=holdout; 그 외 데이터셋은 지정대로",
        "seed": 317,
        "dev": {
            "bidmc": bidmc_ids(),
            "marsh": dev_m,
            "mimic_nonaf": mimic_ids("non_af"),
            "mimic_af": mimic_ids("af"),
            "dalia": ["S1", "S15"],
        },
        "holdout": {
            "marsh": hold_m,
            "capnobase": ["(42 recordings, 열지 않음 — 이름도 읽지 않는다)"],
        },
    }


def load_splits():
    with open(SPLITS_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def write_splits():
    s = build_splits()
    with open(SPLITS_PATH, "w", encoding="utf-8") as f:
        f.write(json.dumps(s, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
    return s


def check_leakage(s):
    """dev ∩ holdout = ∅ 이고 MARSH 전 기록이 정확히 한 세트에 있음. 위반 목록을 돌려준다."""
    bad = []
    dev_m, hold_m = set(s["dev"]["marsh"]), set(s["holdout"]["marsh"])
    if dev_m & hold_m:
        bad.append(("marsh_overlap", sorted(dev_m & hold_m)))
    if (dev_m | hold_m) != set(marsh_ids()):
        bad.append(("marsh_not_exhaustive", sorted(set(marsh_ids()) ^ (dev_m | hold_m))))
    if "capnobase" in s["dev"]:
        bad.append(("capnobase_in_dev", []))
    return bad
