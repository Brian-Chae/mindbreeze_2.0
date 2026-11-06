"""R-peak 검출기 품질: MARSH dev 수기 ECG 주석 대비 (addendum-5). 상수 오프셋은 기록별 중앙값 차로 제거."""
from __future__ import annotations

import numpy as np

from .adapters.loaders import load_marsh
from .truth import beat_match, detect_r_peaks


def marsh_detector_quality(rids):
    f1s, offs, tps, nts, ncs = [], [], 0, 0, 0
    below = 0
    for rid in rids:
        r = load_marsh(rid)
        det = detect_r_peaks(r.ecg, r.ecg_fs)
        ann = r.beats_truth
        j = np.clip(np.searchsorted(det, ann), 1, len(det) - 1)
        near = np.where(np.abs(det[j] - ann) < np.abs(det[j - 1] - ann), det[j], det[j - 1])
        off = float(np.median(ann - near))
        tp, _ = beat_match(ann, det + off, 0.050)
        p = tp / len(det)
        rc = tp / len(ann)
        f = 2 * p * rc / (p + rc) if (p + rc) else 0.0
        f1s.append(f)
        offs.append(off)
        tps += tp
        nts += len(ann)
        ncs += len(det)
        if f < 0.98:
            below += 1
    P, R = tps / ncs, tps / nts
    return {
        "n_rec": len(rids),
        "f1_median": float(np.median(f1s)),
        "f1_min": float(np.min(f1s)),
        "f1_pooled": float(2 * P * R / (P + R)),
        "offset_median_s": float(np.median(offs)),
        "offset_min_s": float(np.min(offs)),
        "offset_max_s": float(np.max(offs)),
        "n_below_098": below,
    }
