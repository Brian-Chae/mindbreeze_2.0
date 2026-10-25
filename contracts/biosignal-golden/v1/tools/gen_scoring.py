#!/usr/bin/env python3
"""SDD-246 T01 — GF05 점수 경계 벡터 (backend 독립 Python 스코어링 oracle).

입력: backend/app/services/eeg_metrics.py · normalization_score.py · normalization_constants.json (읽기 전용 import).
      DB/.env/네트워크 접근 없음.
출력: expected/scoring/gf05_scoring.json
  - cohort_backend : normalize_focus/relaxation/stress/emotional_stability (legacy_cohort 세션 매핑, 반올림 1자리)
  - sigmoid        : sigmoid_score (active_sigmoid, 정수 0~100) — 고정 합성 모델
같은 mode/constants/model 에서만 TS(eegPersonalScore.ts)와 비교한다. 다른 모델 출력을 같다고 비교하지 않는다.

사용: <backend venv python> gen_scoring.py <repo_root> <v1_dir>
"""
import hashlib
import json
import math
import os
import sys

repo, v1 = sys.argv[1], sys.argv[2]
sys.path.insert(0, os.path.join(repo, "backend"))
from app.services import eeg_metrics as m  # noqa: E402
from app.services import normalization_score as ns  # noqa: E402

C = m.get_constants()
IDX = C.indices


def edges(vals):
    """경계 ±epsilon, 0, 음수, 큰 값."""
    out = set([0.0, -1.0, 1e-9, 1e9])
    for v in vals:
        for d in (-1e-6, 0.0, 1e-6, 0.05, -0.05):
            out.add(round(v + d, 9))
    return sorted(out)


def jround(x):  # JS Math.round 와 같은 양수 반올림은 backend _round 가 아닌 sigmoid 쪽에서 쓴다.
    return x


def bk(fn, x):
    try:
        return fn(x)
    except Exception as e:  # noqa: BLE001
        return {"error": type(e).__name__}


cohort = {
    "focus": [{"x": x, "y": bk(m.normalize_focus, x)} for x in edges([IDX["focusIndex"][k] for k in ("p5", "p25", "p75", "p95")])],
    "relaxation": [{"x": x, "y": bk(m.normalize_relaxation, x)} for x in edges([IDX["relaxationIndex"][k] for k in ("p10", "p60", "p95")])],
    "stress": [{"x": x, "y": bk(m.normalize_stress, x)} for x in edges([IDX["stressIndex"][k] for k in ("p5", "p95")])],
    "emotional_stability": [{"x": x, "y": bk(m.normalize_emotional_stability, x)} for x in edges([IDX["emotionalStability"][k] for k in ("p5", "p95")])],
    "null_input": {
        "focus": m.normalize_focus(None), "relaxation": m.normalize_relaxation(None),
        "stress": m.normalize_stress(None), "emotional_stability": m.normalize_emotional_stability(None),
    },
}

MODEL = {  # run-oracle.ts pinnedModel() 과 동일해야 한다(시험이 대조).
    "focusIndex": {"m": 0.3, "s": 0.8, "direction": 1},
    "relaxationIndex": {"m": -1.4, "s": 0.5, "direction": 1},
    "stressIndex": {"m": 0.2, "s": 0.9, "direction": -1},
    "totalNeuralActivity": {"m": 5.0, "s": 2.0, "direction": 1},
    "faa": {"m": 0, "s": 0.6, "direction": -1},
    "cognitiveLoad": {"m": 1.1, "s": 0.4, "direction": -1},
    "emotionalStability": {"m": 0.5, "s": 0.9, "direction": 1},
}
raws = [0.0, 1e-9, 0.05, 0.1, 0.25, 0.3, 0.5, 1.0, 1.0000001, 2.0, 2.7182818284590455, 5.0, 10.0, 148.4131591025766, 1000.0, -0.5, None]
faa_raws = [0.0, 0.1, -0.1, 0.4161, 0.6, -0.6, 0.8, 1.5, 3.0, None]
sig = []
for key, p in MODEL.items():
    for x in (faa_raws if key == "faa" else raws):
        sig.append({"key": key, "raw": x, "score": ns.sigmoid_score(key, x, p)})
# 반올림 .5 경계(양수 half-up) — ratio 가 정확히 x.5 가 되는 입력을 모델로 구성해 고정
half = []
for pct in (0.5, 1.5, 49.5, 50.5, 99.5):
    # sigmoid(d*c*t)=pct/100 → t = logit(pct/100)/(d*c)  (d=1)
    ratio = pct / 100.0
    t = math.log(ratio / (1 - ratio)) / ns.SIGMOID_C
    z = 0.0 + t * 1.0  # m=0, s=1
    raw = math.exp(z) - 1e-9
    half.append({"key": "focusIndex", "raw": raw, "model": {"m": 0.0, "s": 1.0, "direction": 1}, "target_percent": pct,
                 "score": ns.sigmoid_score("focusIndex", raw, {"m": 0.0, "s": 1.0, "direction": 1})})

body = {
    "source": {
        "backend_constants_sha256": hashlib.sha256(open(os.path.join(repo, "backend/app/services/normalization_constants.json"), "rb").read()).hexdigest(),
        "constants_version": C.version, "pipeline_version": C.pipeline_version, "provisional": C.provisional,
        "note": "legacy_cohort(backend normalize_*)와 active_sigmoid 는 mode 가 다르므로 서로 비교하지 않는다.",
    },
    "cohort_backend": cohort,
    "sigmoid": {"model": MODEL, "vectors": sig, "half_rounding": half, "SIGMOID_C": ns.SIGMOID_C},
}
os.makedirs(os.path.join(v1, "expected", "scoring"), exist_ok=True)
with open(os.path.join(v1, "expected", "scoring", "gf05_scoring.json"), "w", encoding="utf-8") as f:
    json.dump(body, f, ensure_ascii=False, indent=1, sort_keys=True)
    f.write("\n")
print(json.dumps({"cohort_points": sum(len(v) for k, v in cohort.items() if isinstance(v, list)), "sigmoid_points": len(sig), "half": len(half)}))
