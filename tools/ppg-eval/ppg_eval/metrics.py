"""지표·층별·cluster bootstrap (verify V3, V4, V6, addendum-2)."""
from __future__ import annotations

import numpy as np

from .common import BOOTSTRAP_B, NULL_PENALTY, SEED, STRATA


def stratum_of(rate: float) -> str:
    for name, lo, hi in STRATA:
        if lo <= rate < hi:
            return name
    return "gt20"


def resp_stats(truth: np.ndarray, core: np.ndarray) -> dict:
    """truth: 참값 정의된 창들, core: 코어 값(null=NaN). coverage 분모=len(truth)."""
    n = len(truth)
    if n == 0:
        return {"n_win": 0}
    ok = np.isfinite(core)
    e = (core - truth)[ok]
    nv = int(ok.sum())
    out = {"n_win": n, "n_valid": nv, "coverage": nv / n}
    if nv:
        ae = np.abs(e)
        out.update(
            {
                "mae": float(ae.mean()),
                "median_ae": float(np.median(ae)),
                "p95_ae": float(np.percentile(ae, 95)),
                "bias": float(e.mean()),
                "sd": float(e.std(ddof=1)) if nv > 1 else float("nan"),
                "cp2": float((ae <= 2.0).mean()),
            }
        )
        if nv > 1:
            out["loa_lo"] = out["bias"] - 1.96 * out["sd"]
            out["loa_hi"] = out["bias"] + 1.96 * out["sd"]
    pen = np.where(ok, np.abs(core - truth), NULL_PENALTY)
    out["mae_pen"] = float(pen.mean())
    return out


def _stat_vec(truth, core):
    s = resp_stats(truth, core)
    g = lambda k: s.get(k, float("nan"))
    lw = g("loa_hi") - g("loa_lo") if "loa_hi" in s else float("nan")
    return {"mae": g("mae"), "bias": g("bias"), "coverage": g("coverage"), "mae_pen": g("mae_pen"), "cp2": g("cp2"), "loa_width": lw}


def cluster_bootstrap(per_rec: list[tuple[np.ndarray, np.ndarray]], B: int = BOOTSTRAP_B, seed: int = SEED) -> dict:
    """per_rec: [(truth, core)] 기록별. 기록을 복원추출해 모든 창을 포함시킨다. percentile 95% CI."""
    per_rec = [p for p in per_rec if len(p[0]) > 0]
    nrec = len(per_rec)
    if nrec < 2:
        return {}
    rng = np.random.Generator(np.random.PCG64(seed))
    keys = ("mae", "bias", "coverage", "mae_pen", "cp2", "loa_width")
    draws = {k: [] for k in keys}
    for _ in range(B):
        idx = rng.integers(0, nrec, size=nrec)
        t = np.concatenate([per_rec[i][0] for i in idx])
        c = np.concatenate([per_rec[i][1] for i in idx])
        v = _stat_vec(t, c)
        for k in keys:
            draws[k].append(v[k])
    ci = {}
    for k in keys:
        a = np.asarray(draws[k], dtype=float)
        a = a[np.isfinite(a)]
        ci[k] = (float(np.percentile(a, 2.5)), float(np.percentile(a, 97.5))) if len(a) > 20 else (float("nan"), float("nan"))
    return ci


def prf(tp: int, n_truth: int, n_core: int):
    p = tp / n_core if n_core else float("nan")
    r = tp / n_truth if n_truth else float("nan")
    f = 2 * p * r / (p + r) if (p == p and r == r and (p + r) > 0) else float("nan")
    return p, r, f


def bias_loa(core: np.ndarray, truth: np.ndarray):
    ok = np.isfinite(core) & np.isfinite(truth)
    e = (core - truth)[ok]
    if len(e) < 2:
        return {"n": int(len(e))}
    return {"n": int(len(e)), "bias": float(e.mean()), "loa_lo": float(e.mean() - 1.96 * e.std(ddof=1)), "loa_hi": float(e.mean() + 1.96 * e.std(ddof=1)), "mae": float(np.abs(e).mean())}
