"""공통 상수·경로·Record 정의 (SDD-317). 모든 값은 verify.md / verify-addendum-1.md 사전등록과 1:1."""
from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass, field
from typing import Dict, Optional

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
TOOL_DIR = os.path.dirname(HERE)
REPO = os.path.dirname(os.path.dirname(TOOL_DIR))
DATA_ROOT = "/Volumes/Looxid SSD/looxid/datasets/ppg-validation"
RESULTS = os.path.join(TOOL_DIR, "results")
WORK = os.path.join(TOOL_DIR, "work")

SEED = 317
BOOTSTRAP_B = 2000
SCORE_HOP_S = 10
WINDOWS_S = (30, 60, 120)
PRIMARY_L = 60
RESP_TOL_RATE = 3.0  # BIDMC 주석자 간 허용 차 (회/분)
NULL_PENALTY = 12.0  # MAE_pen: null 창의 고정 오차 (사전등록)
STRATA = (("lt6", 0.0, 6.0), ("6_12", 6.0, 12.0), ("12_20", 12.0, 20.0), ("gt20", 20.0, 1e9))
BEAT_TOL_S = 0.100
CONVERT_VERSION = "resample_poly-kaiser5.0-v1"
IR_DC = 1_150_000.0
IR_AC_STD = 70.0
EPOCH_US = 1_700_000_000_000_000


@dataclass
class Record:
    ds: str  # bidmc | marsh | mimic_nonaf | mimic_af | dalia
    rid: str
    fs: float  # PPG 원 샘플률
    ppg: np.ndarray
    resp_events: Dict[str, np.ndarray] = field(default_factory=dict)  # 이름 -> 호흡 이벤트 시각(초)
    beats_truth: Optional[np.ndarray] = None  # 참 박동(R) 시각(초). None 이면 ecg 에서 검출
    ecg: Optional[np.ndarray] = None
    ecg_fs: float = 0.0
    meta: Dict[str, object] = field(default_factory=dict)


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def canon_json(obj) -> str:
    """결정론적 JSON (키 정렬, 고정 구분자, NaN 은 null)."""

    def fix(o):
        if isinstance(o, float):
            return None if (o != o or o in (float("inf"), float("-inf"))) else round(o, 9)
        if isinstance(o, (np.floating,)):
            return fix(float(o))
        if isinstance(o, (np.integer,)):
            return int(o)
        if isinstance(o, np.ndarray):
            return [fix(x) for x in o.tolist()]
        if isinstance(o, dict):
            return {str(k): fix(v) for k, v in sorted(o.items(), key=lambda kv: str(kv[0]))}
        if isinstance(o, (list, tuple)):
            return [fix(x) for x in o]
        return o

    return json.dumps(fix(obj), ensure_ascii=False, sort_keys=True, separators=(",", ":"))
