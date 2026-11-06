"""3단계 ablation 실행기 (verify-addendum-9). 개발 세트(BIDMC 53 + MARSH dev 15)만, 홀드아웃 접근 없음.

게이트: G-resp(V0 호흡 == 코어), G-front(PPG 전단 거울 == 코어 RR·박동시각), G-hrv(V0 SDNN·RMSSD == 코어).
G-resp 실패 → 중단. G-front 실패 → W1/W1b/W3/W5 결과 미생성. G-hrv 실패 → HRV 열 미생성.
판정·통계는 ablation.py(2단계, addendum-8 A8-4)를 그대로 재사용한다.
"""
from __future__ import annotations

import csv
import json
import math
import os
from typing import Optional

import numpy as np

from . import guard
from . import variants as V
from .ablation import (
    BOOTSTRAP_B,
    DS_ORDER,
    EXPERIMENTS_PATH,
    SEED,
    STRATUM_KEYS,
    STRATUM_NAMES,
    cell_summary,
    equivalence,
    first_delay_and_jumps,
    judge,
    load_registry,
    rec_vec,
    totals_stats,
    variant_md,
    window_arrays,
)
from .common import PRIMARY_L, RESULTS, SCORE_HOP_S, WORK, canon_json
from .evaluate import block_beat_eval
from .frontend_mirror import front_frames
from .report import fmt, rows_to_csv
from .truth import detect_r_peaks, ecg_rr_series, truth_for_record, truth_hr_at, truth_hrv_at
from .variants2 import Pipeline, RespState, pipe_key, split_params, ER, TN, TE, RN, TS

OUT_DIR = os.path.join(RESULTS, "ablation2")
NAN = float("nan")
FRONT_DEPENDENT = ("W1", "W1b", "W3", "W5")
HRV_VARIANTS_ORDER = ("V0", "W1", "W1b", "W2a", "W2b", "W2c", "W3", "W5")
FRONT_RR_TOL = 1e-6
FRONT_TS_TOL = 1e-3
EQ_TOL = 1e-6
REL_F1 = 0.98
CORE_DEDUP_S = 0.3


# ---------------------------------------------------------------- 레지스트리

def phase3_variants(reg: dict) -> list[tuple[str, dict, dict]]:
    """[(id, params, meta)] — V0 첫째, 그 뒤 phase3 변형(등록 순서)."""
    base = reg["baseline"]
    out = [(base["id"], dict(base["params"]), {"judged": False, "name": base["name"]})]
    for v in reg["phase3"]["variants"]:
        out.append((v["id"], dict(v["params"]), v))
    for _i, p, _m in out:
        split_params(p)  # 알 수 없는 파라미터 검출
    return out


def build_groups(vlist, observe_base: bool = True) -> tuple[dict, dict]:
    """파이프라인 그룹. 반환 ({key: {"pipe":..., "ids":[...], "params":{...}}}, {vid: key})."""
    groups: dict = {}
    v2g: dict = {}
    for vid, params, _m in vlist:
        pipe, resp = split_params(params)
        k = pipe_key(pipe)
        g = groups.setdefault(k, {"pipe": pipe, "ids": [], "resp": {}})
        g["ids"].append(vid)
        g["resp"][vid] = resp
        v2g[vid] = k
    return groups, v2g


def instantiate(groups: dict, base_id: str = "V0") -> dict:
    out = {}
    for k, g in groups.items():
        states = [RespState(vid, g["resp"][vid], observe=(vid == base_id)) for vid in g["ids"]]
        out[k] = Pipeline(g["pipe"], states)
    return out


# ---------------------------------------------------------------- 후보 구성

def beat_second(r: dict, tn: float, te: float) -> float:
    """코어 emission 행 r 에서 박동(명목 시각 tn, 유효 시각 te)의 기록 내 초 단위 시각 (evaluate.core_beats 와 같은 인덱스 규칙)."""
    idx = (r["k"] + 1) * 50 - 1 - int(round((r["win_end_ts"] - tn) / 20.0))
    return idx / 50.0 + (te - tn) / 1000.0


def cand_core(r: dict) -> list:
    return [(rr, e, e, rr, beat_second(r, e, e)) for rr, e in zip(r["rr"], r["rr_end_ts"])]


def cand_front(r: dict, f: dict, interp: bool) -> list:
    src = f["interp"] if interp else f["base"]
    out = []
    for (rr_eff, tn, te, rr_nom) in src:
        out.append((rr_eff, tn, te, rr_nom, beat_second(r, tn, te)))
    return out


# ---------------------------------------------------------------- 기록 처리

def hrv_truth_rows(rec, dur: int):
    """신뢰 기록이면 (tb, 행 리스트[(T, th, ts, tr)]) 아니면 None. evaluate.process_record 와 같은 규칙."""
    from .rpeak_quality import RELIABLE_F1, record_quality

    if rec.beats_truth is not None:
        tb = rec.beats_truth
    elif rec.ecg is not None:
        tb = detect_r_peaks(rec.ecg, rec.ecg_fs)
    else:
        return None
    tb = tb[tb < dur]
    if rec.ds == "bidmc":
        hr_det = 60.0 * len(tb) / max(dur, 1)
        reliable = abs(hr_det - rec.meta["mon_hr"]) / rec.meta["mon_hr"] <= 0.10
    else:
        f1, _off = record_quality(rec)
        reliable = f1 >= RELIABLE_F1
    if not reliable or len(tb) <= 10:
        return None
    rr_t, end_t = ecg_rr_series(tb)
    rows = []
    T = 30
    while T <= dur:
        th = truth_hr_at(tb, float(T))
        ts, tr = truth_hrv_at(rr_t, end_t, float(T))
        rows.append((T, th, ts, tr))
        T += SCORE_HOP_S
    return tb, rows


def dedup_beats(a: np.ndarray) -> np.ndarray:
    keep: list = []
    for t in sorted(set(float(x) for x in a)):
        if not keep or t - keep[-1] > CORE_DEDUP_S:
            keep.append(t)
    return np.asarray(keep)


def process_record2(rec, vlist, groups, v2g) -> dict:
    from .convert import prepare
    from .core_runner import run_core

    os.makedirs(WORK, exist_ok=True)
    pkts, _info, ir, _x50 = prepare(rec.ppg, rec.fs)
    path = os.path.join(WORK, f"abl2_{rec.ds}_{rec.rid}.pkts")
    with open(path, "wb") as f:
        f.write(pkts)
    try:
        rows = run_core(path)
    finally:
        os.remove(path)
    fr = front_frames(ir.astype(np.float64), rows)
    pls = instantiate(groups)
    ids = [v[0] for v in vlist]
    series = {vid: [] for vid in ids}
    td = {k: [] for k in pls}
    mism_buf = 0
    front_mis = 0
    front_maxdr = front_maxdt = 0.0
    gated = {k: 0 for k in pls}
    for r, f in zip(rows, fr):
        # G-front: 거울 base RR/ts == 코어 rr/rr_end_ts
        b = f["base"]
        if len(b) != len(r["rr"]):
            front_mis += 1
        else:
            bad = False
            for (rr, t, _t2, _rn), a, c in zip(b, r["rr"], r["rr_end_ts"]):
                dr, dt = abs(rr - a), abs(t - c)
                front_maxdr, front_maxdt = max(front_maxdr, dr), max(front_maxdt, dt)
                if dr > FRONT_RR_TOL or dt > FRONT_TS_TOL:
                    bad = True
            front_mis += 1 if bad else 0
        for k, pl in pls.items():
            p = pl.pipe
            if p["sqi_gate"] is not None:
                cand = cand_front(r, f, False)
            elif p["peak_interp"] == "parabolic":
                cand = cand_front(r, f, True)
            else:
                cand = cand_core(r)
            g = pl.step(cand, r["win_end_ts"], f["sqi"])
            gated[k] += 1 if g else 0
            td[k].append(None if g else pl.out_td())
            for st in pl.resp_states:
                series[st.id].append(None if g else st.resp)
        base_k = v2g["V0"]
        if len(pls[base_k].buf.e) != r["rr_buf"]:
            mism_buf += 1
    dur = len(rows)
    windows = []
    for T in range(PRIMARY_L, dur + 1, SCORE_HOP_S):
        tv, why = truth_for_record(rec, float(PRIMARY_L), float(T))
        windows.append((PRIMARY_L, T, tv, why))
    # HRV·박동 (신뢰 기록만)
    hrv_rows: dict = {}
    f1_parts: dict = {}
    ht = hrv_truth_rows(rec, dur)
    if ht is not None:
        tb, trows = ht
        for vid in ids:
            tdv = td[v2g[vid]]
            hrv_rows[vid] = []
            for (T, th, ts_, tr_) in trows:
                t = tdv[T - 1]
                if t is None:
                    hr_v = sd_v = rm_v = NAN
                else:
                    hr_v, sd_v, rm_v = 60000.0 / t[0], t[1], t[2]
                hrv_rows[vid].append((T, NAN if th is None else th, NAN if ts_ is None else ts_, NAN if tr_ is None else tr_, hr_v, sd_v, rm_v))
        for k, pl in pls.items():
            cb = dedup_beats(pl.aged_times())
            be = block_beat_eval(cb, tb, float(dur))
            for vid in pl.resp_states:
                f1_parts[vid.id] = (be["tp"], be["n_core"], be["n_truth"])
    return {
        "ds": rec.ds,
        "rid": rec.rid,
        "dur": dur,
        "core": [r["resp"] for r in rows],
        "core_sdnn": [r["sdnn"] for r in rows],
        "core_rmssd": [r["rmssd"] for r in rows],
        "series": series,
        "td": td,
        "windows": windows,
        "buf_mismatch": mism_buf,
        "front_mismatch": front_mis,
        "front_max_drr": front_maxdr,
        "front_max_dts": front_maxdt,
        "gated": gated,
        "frames": dur,
        "fallback_frames": {st.id: st.fallback_frames for pl in pls.values() for st in pl.resp_states},
        "calc_frames": {st.id: st.calc_frames for pl in pls.values() for st in pl.resp_states},
        "removed_ratio": {k: (pl.buf.cum_removed / pl.buf.cum_new if pl.buf.cum_new else NAN) for k, pl in pls.items()},
        "reseeds": {k: pl.buf.reseeds for k, pl in pls.items()},
        "obs": pls[v2g["V0"]].resp_states[0].obs if pls[v2g["V0"]].resp_states[0].id == "V0" else {},
        "hrv_rows": hrv_rows,
        "f1_parts": f1_parts,
    }


# ---------------------------------------------------------------- 게이트

def gate_front(recs: list) -> dict:
    per = {}
    tf = tm = 0
    worst = 0.0
    for r in recs:
        per[f"{r['ds']}/{r['rid']}"] = {"frames": r["frames"], "mismatch": r["front_mismatch"]}
        tf += r["frames"]
        tm += r["front_mismatch"]
        worst = max(worst, r["front_mismatch"] / max(r["frames"], 1))
    frac = tm / tf if tf else 0.0
    return {
        "frames": tf,
        "mismatch_frames": tm,
        "mismatch_fraction": frac,
        "worst_record_fraction": worst,
        "max_abs_drr_ms": max((r["front_max_drr"] for r in recs), default=0.0),
        "max_abs_dts_ms": max((r["front_max_dts"] for r in recs), default=0.0),
        "tolerance": {"rr_ms": FRONT_RR_TOL, "ts_ms": FRONT_TS_TOL},
        "limits": {"total": 0.001, "per_record": 0.01},
        "pass": bool(frac <= 0.001 and worst <= 0.01),
        "per_record": per,
    }


def gate_hrv(recs: list) -> dict:
    per = {}
    tf = tm = 0
    worst = 0.0
    maxd = 0.0
    for r in recs:
        v0 = r["td"][next(iter(r["td"]))]
        # V0 파이프라인 키를 찾는다: sqi_gate None·refine v0·peak none
        key = next(k for k in r["td"] if k[0] == "v0" and k[1] is None and k[3] == "none")
        v0 = r["td"][key]
        m = 0
        for t, cs, cr in zip(v0, r["core_sdnn"], r["core_rmssd"]):
            for a, b in ((None if t is None else t[1], cs), (None if t is None else t[2], cr)):
                if a is None and b is None:
                    continue
                if a is None or b is None:
                    m += 1
                    break
                d = abs(a - b)
                maxd = max(maxd, d)
                if d > EQ_TOL:
                    m += 1
                    break
        per[f"{r['ds']}/{r['rid']}"] = {"frames": r["frames"], "mismatch": m}
        tf += r["frames"]
        tm += m
        worst = max(worst, m / max(r["frames"], 1))
    frac = tm / tf if tf else 0.0
    return {"frames": tf, "mismatch_frames": tm, "mismatch_fraction": frac, "worst_record_fraction": worst, "max_abs_diff_both_valid": maxd, "pass": bool(frac <= 0.001 and worst <= 0.01), "per_record": per}


# ---------------------------------------------------------------- 통계: 쌍체 부트스트랩 일반화

def boot_counts(R: int, B: int = BOOTSTRAP_B, seed: int = SEED) -> np.ndarray:
    """(B,R) 재표본 횟수. 난수 소비 순서는 ablation.paired_bootstrap 과 같다(draw 마다 integers(0,R,R))."""
    rng = np.random.Generator(np.random.PCG64(seed))
    out = np.zeros((B, R))
    for b in range(B):
        out[b] = np.bincount(rng.integers(0, R, size=R), minlength=R)
    return out


def _pct2(a, lo=2.5, hi=97.5):
    a = np.asarray(a, dtype=float)
    a = a[np.isfinite(a)]
    return (float(np.percentile(a, lo)), float(np.percentile(a, hi))) if len(a) > 20 else (NAN, NAN)


def resp_family(recs, ids: list, base: str = "V0") -> dict:
    """풀링 호흡 ΔMAE 가족: 변형별 점추정·95% CI·Bonferroni CI·양측 p·Holm 보정 p."""
    wb = window_arrays(recs, base, None, "ALL")
    vb = np.array([rec_vec(x[1], x[2]) for x in wb])
    R = len(vb)
    C = boot_counts(R)
    sb = C @ vb
    mae_b = sb[:, 2] / sb[:, 1]
    m = len(ids)
    res = {}
    for vid in ids:
        wv = window_arrays(recs, vid, None, "ALL")
        vv = np.array([rec_vec(x[1], x[2]) for x in wv])
        sv = C @ vv
        mae_v = sv[:, 2] / sv[:, 1]
        d = mae_v - mae_b
        tot_v, tot_b = vv.sum(axis=0), vb.sum(axis=0)
        point = tot_v[2] / tot_v[1] - tot_b[2] / tot_b[1]
        le = (np.sum(d <= 0) + 1) / (len(d) + 1)
        ge = (np.sum(d >= 0) + 1) / (len(d) + 1)
        p = float(min(1.0, 2 * min(le, ge)))
        res[vid] = {"d_mae": float(point), "ci95": _pct2(d), "ci_bonf": _pct2(d, 100 * 0.05 / (2 * m), 100 * (1 - 0.05 / (2 * m))), "p_raw": p}
    order = sorted(ids, key=lambda v: res[v]["p_raw"])
    run = 0.0
    for i, vid in enumerate(order):
        run = max(run, (m - i) * res[vid]["p_raw"])
        res[vid]["p_holm"] = float(min(1.0, run))
    res["_m"] = m
    return res


def paired_ci(vec_v: np.ndarray, vec_b: np.ndarray, fn) -> dict:
    """fn(합계벡터)->float. 점추정 차이·95% CI 쌍체."""
    R = len(vec_v)
    if R < 2:
        return {"diff": NAN, "ci": (NAN, NAN), "v": NAN, "b": NAN}
    C = boot_counts(R)
    sv, sb = C @ vec_v, C @ vec_b
    dv = np.array([fn(x) for x in sv])
    db = np.array([fn(x) for x in sb])
    pv, pb = fn(vec_v.sum(axis=0)), fn(vec_b.sum(axis=0))
    return {"diff": float(pv - pb), "ci": _pct2(dv - db), "v": float(pv), "b": float(pb)}


# ---------------------------------------------------------------- HRV 집계

def hrv_cells(recs, vid: str, ds: Optional[str], metric: str):
    """기록별 벡터 [n_truth, n_valid, sum|e|, sum e] 리스트와 truth 평균. metric: hr|sdnn|rmssd."""
    col = {"hr": (1, 4), "sdnn": (2, 5), "rmssd": (3, 6)}[metric]
    vecs, tsum, tn = [], 0.0, 0
    for r in recs:
        if ds is not None and r["ds"] != ds:
            continue
        rows = r["hrv_rows"].get(vid)
        if not rows:
            continue
        t = np.array([x[col[0]] for x in rows])
        c = np.array([x[col[1]] for x in rows])
        ok = np.isfinite(t)
        if not ok.any():
            continue
        t, c = t[ok], c[ok]
        vecs.append(rec_vec(t, c))
        tsum += float(t.sum())
        tn += len(t)
    return np.array(vecs) if vecs else np.zeros((0, 4)), (tsum / tn if tn else NAN)


def f1_vec(recs, vid: str, ds: Optional[str]) -> np.ndarray:
    v = []
    for r in recs:
        if ds is not None and r["ds"] != ds:
            continue
        p = r["f1_parts"].get(vid)
        if p:
            v.append([float(p[0]), float(p[1]), float(p[2]), 0.0])
    return np.array(v) if v else np.zeros((0, 4))


def f1_of(x) -> float:
    tp, nc, nt = x[0], x[1], x[2]
    if nc <= 0 or nt <= 0 or tp <= 0:
        return 0.0 if (nc > 0 and nt > 0) else NAN
    p, r = tp / nc, tp / nt
    return 2 * p * r / (p + r)


def hrv_table(recs, ids: list, base: str = "V0") -> dict:
    """{vid: {ds: {metric: {...}}}} — 신뢰 기록 풀링(ds=None) 과 데이터셋별."""
    out: dict = {}
    for vid in ids:
        out[vid] = {}
        for ds in (None,) + DS_ORDER:
            cell = {}
            for metric in ("hr", "sdnn", "rmssd"):
                vv, tmean = hrv_cells(recs, vid, ds, metric)
                vb, _ = hrv_cells(recs, base, ds, metric)
                if len(vv) < 2:
                    cell[metric] = {"n_rec": len(vv)}
                    continue
                tot = vv.sum(axis=0)
                stats = totals_stats(tot)
                c = {"n_rec": len(vv), "n_truth": int(tot[0]), "coverage": stats["coverage"], "mae": stats["mae"], "bias": stats["bias"], "rel_bias": (stats["bias"] / tmean if tmean == tmean and tmean else NAN)}
                if vid != base and len(vb) == len(vv):
                    c["d_mae"] = paired_ci(vv, vb, lambda s: s[2] / s[1] if s[1] else NAN)
                    c["d_bias"] = paired_ci(vv, vb, lambda s: s[3] / s[1] if s[1] else NAN)
                cell[metric] = c
            fv, fb = f1_vec(recs, vid, ds), f1_vec(recs, base, ds)
            if len(fv) >= 2:
                tot = fv.sum(axis=0)
                p = {"n_rec": len(fv), "f1": f1_of(tot), "precision": (tot[0] / tot[1] if tot[1] else NAN), "recall": (tot[0] / tot[2] if tot[2] else NAN)}
                if vid != base and len(fb) == len(fv):
                    p["d_f1"] = paired_ci(fv, fb, f1_of)
                cell["f1"] = p
            else:
                cell["f1"] = {"n_rec": len(fv)}
            out[vid][ds or "pooled"] = cell
    return out


# ---------------------------------------------------------------- W4 관찰

def w4_observations(recs) -> dict:
    out = {}
    for ds in DS_ORDER:
        rs = [r for r in recs if r["ds"] == ds]
        durs = [r["dur"] for r in rs]
        truth = [tv for r in rs for (_L, _T, tv, _w) in r["windows"] if tv is not None]
        rec_means = []
        for r in rs:
            t = [tv for (_L, _T, tv, _w) in r["windows"] if tv is not None]
            if t:
                rec_means.append(float(np.mean(t)))
        sl = np.concatenate([np.asarray(r["obs"].get("slope_s_per_min", []), dtype=float) for r in rs]) if rs else np.array([])
        mr = np.concatenate([np.asarray(r["obs"].get("mean_rr_s", []), dtype=float) for r in rs]) if rs else np.array([])
        lf = np.concatenate([np.asarray(r["obs"].get("lf_ratio", []), dtype=float) for r in rs]) if rs else np.array([])
        fl = np.concatenate([np.asarray(r["obs"].get("floor_flag", []), dtype=float) for r in rs]) if rs else np.array([])
        k0 = next(iter(rs[0]["removed_ratio"])) if rs else None
        base_k = next((k for k in rs[0]["removed_ratio"] if k[0] == "v0" and k[1] is None and k[3] == "none"), k0) if rs else None
        rem = [r["removed_ratio"][base_k] for r in rs if r["removed_ratio"][base_k] == r["removed_ratio"][base_k]]
        q = lambda a, p: float(np.percentile(a, p)) if len(a) else NAN
        strata = {}
        for name, lo, hi in (("<6", 0, 6), ("6–12", 6, 12), ("12–20", 12, 20), (">20", 20, 1e9)):
            strata[name] = sum(1 for x in truth if lo <= x < hi)
        out[ds] = {
            "n_rec": len(rs),
            "duration_s": {"median": float(np.median(durs)), "min": min(durs), "max": max(durs)},
            "truth_rate": {"n_win": len(truth), "mean": float(np.mean(truth)), "sd": float(np.std(truth, ddof=1)), "rec_mean_sd": float(np.std(rec_means, ddof=1)) if len(rec_means) > 1 else NAN, "windows_by_stratum": strata},
            "resample_slope_abs_s_per_min": {"median": q(sl, 50), "p25": q(sl, 25), "p75": q(sl, 75)},
            "mean_rr_s": {"median": q(mr, 50)},
            "lf_to_band_power": {"median": q(lf, 50), "p25": q(lf, 25), "p75": q(lf, 75)},
            "dominant_at_band_floor_fraction": float(fl.mean()) if len(fl) else NAN,
            "refine_removed_ratio_mean": float(np.mean(rem)) if rem else NAN,
            "n_calc_frames": int(len(sl)),
        }
    return out


# ---------------------------------------------------------------- 리포트

def _ci(c, nd=2):
    return f" [{fmt(c[0], nd)}, {fmt(c[1], nd)}]" if c and c[0] == c[0] else ""


def hrv_md(tab: dict, vid: str, base: str = "V0") -> str:
    md = "\n## 5. 박동·HRV (신뢰 ECG 기록만; HR_rr=60000/AVNN, 참값=ECG; 판정 아님)\n\n"
    md += "- 박동 F1 은 '버퍼 숙성 박동'(20초 이상 지난 뒤에도 버퍼에 남은 박동) 기준이라 코어 표시 박동 F1 과 같은 양이 아니다. V0 도 같은 정의로 재계산했다.\n\n"
    md += "| 범위 | 지표 | 기록 n | coverage | V0 MAE/bias | 변형 MAE/bias | ΔMAE [쌍체 CI] | Δbias [쌍체 CI] | 변형 상대 bias |\n|---|---|---|---|---|---|---|---|---|\n"
    for scope in ("pooled", "bidmc", "marsh"):
        cell = tab[vid][scope]
        cb = tab[base][scope]
        for metric, lab in (("hr", "HR_rr(bpm)"), ("sdnn", "SDNN(ms)"), ("rmssd", "RMSSD(ms)")):
            c, b = cell.get(metric, {}), cb.get(metric, {})
            if "mae" not in c:
                md += f"| {scope} | {lab} | {c.get('n_rec', 0)} | – | – | – | – | – | – |\n"
                continue
            dm, db = c.get("d_mae"), c.get("d_bias")
            md += (
                f"| {scope} | {lab} | {c['n_rec']} | {fmt(c['coverage'] * 100, 1)}% | {fmt(b.get('mae'))}/{fmt(b.get('bias'))} | {fmt(c['mae'])}/{fmt(c['bias'])} | "
                f"{fmt(dm['diff']) if dm else '–'}{_ci(dm['ci']) if dm else ''} | {fmt(db['diff']) if db else '–'}{_ci(db['ci']) if db else ''} | {fmt(c['rel_bias'] * 100, 1)}% |\n"
            )
        f, fb = cell.get("f1", {}), cb.get("f1", {})
        if "f1" in f:
            d = f.get("d_f1")
            md += f"| {scope} | 박동 F1(숙성) | {f['n_rec']} | – | {fmt(fb.get('f1'), 3)} | {fmt(f['f1'], 3)} | {fmt(d['diff'], 3) if d else '–'}{_ci(d['ci'], 3) if d else ''} | – | – |\n"
    return md


def write_outputs(recs, vlist, v2g, eq, eqf, eqh, out_dir, results_dir):
    base = vlist[0][0]
    ids_all = [v[0] for v in vlist]
    skipped = set()
    if not eqf["pass"]:
        skipped |= set(FRONT_DEPENDENT)
    ids = [i for i in ids_all if i not in skipped]
    judgements = {}
    for vid, _p, meta in vlist[1:]:
        if vid in skipped:
            continue
        judgements[vid] = judge(recs, vid, base) if meta.get("judged") else None
    fam_ids = [i for i in ids if i != base]
    fam = resp_family(recs, fam_ids, base)
    hrv_ids = [i for i in HRV_VARIANTS_ORDER if i in ids] if eqh["pass"] else []
    hrv_tab = hrv_table(recs, hrv_ids, base) if hrv_ids else {}
    w4 = w4_observations(recs)
    files: dict = {}
    files["../ablation2/equivalence-resp.json"] = canon_json({k: v for k, v in eq.items()}) + "\n"
    files["../ablation2/equivalence-front.json"] = canon_json(eqf) + "\n"
    files["../ablation2/equivalence-hrv.json"] = canon_json(eqh) + "\n"
    header = ["ds", "rid", "L", "T", "truth", "truth_status", "core_C0"] + ids_all
    body = []
    for r in recs:
        for (L, T, tv, why) in r["windows"]:
            body.append([r["ds"], r["rid"], L, T, tv, why, r["core"][T - 1]] + [r["series"][v][T - 1] for v in ids_all])
    files["../ablation2/resp-windows-ablation2.csv"] = rows_to_csv(header, body)
    hb = []
    for r in recs:
        for vid, rows in r["hrv_rows"].items():
            for (T, th, ts_, tr_, hv, sv, rv) in rows:
                hb.append([r["ds"], r["rid"], vid, T, th, ts_, tr_, hv, sv, rv])
    files["../ablation2/hrv-windows-ablation2.csv"] = rows_to_csv(["ds", "rid", "variant", "T", "truth_hr", "truth_sdnn", "truth_rmssd", "hr_rr", "sdnn", "rmssd"], hb)
    diag = {}
    for vid in ids_all:
        k = v2g[vid]
        frames = sum(r["frames"] for r in recs)
        diag[vid] = {
            "calc_frames": sum(r["calc_frames"][vid] for r in recs),
            "fallback_frames": sum(r["fallback_frames"][vid] for r in recs),
            "gated_frames": sum(r["gated"][k] for r in recs),
            "frames": frames,
            "reseeds": sum(r["reseeds"][k] for r in recs),
            "refine_removed_ratio_mean": float(np.nanmean([r["removed_ratio"][k] for r in recs])),
        }
    files["../ablation2/variant-diagnostics.json"] = canon_json(diag) + "\n"
    files["../ablation2/w4-observations.json"] = canon_json(w4) + "\n"
    files["../ablation2/family-holm.json"] = canon_json(fam) + "\n"
    files["../ablation2/judgements.json"] = canon_json({k: ({kk: vv for kk, vv in v.items() if kk not in ("pooled", "pooled_base")} if v else None) for k, v in judgements.items()}) + "\n"
    for vid, _p, meta in vlist[1:]:
        if vid in skipped:
            continue
        fb = {"calc_frames": diag[vid]["calc_frames"], "fallback": diag[vid]["fallback_frames"]}
        md = variant_md(recs, vid, base, meta, judgements.get(vid), fb)
        md = md.replace("addendum-8", "addendum-9").replace("A8-4", "A9-3(=A8-4 승계)")
        f = fam[vid]
        md += f"\n## 판정 외 참고 — 다중 비교 보정 (가족 m={fam['_m']}, 풀링 ΔMAE)\n\n- 점추정 {fmt(f['d_mae'])}, 95% CI {_ci(f['ci95'])}, Bonferroni CI {_ci(f['ci_bonf'])}, 양측 p(raw)={fmt(f['p_raw'], 4)}, Holm 보정 p={fmt(f['p_holm'], 4)}\n"
        if hrv_tab and vid in hrv_tab:
            md += hrv_md(hrv_tab, vid, base)
        files[f"../ablation-v2-{vid}.md"] = md
    files["../ablation2-summary.md"] = summary_md2(recs, vlist, ids, skipped, judgements, fam, hrv_tab, w4, diag, eq, eqf, eqh)
    for name, txt in files.items():
        pth = os.path.normpath(os.path.join(out_dir, name))
        os.makedirs(os.path.dirname(pth), exist_ok=True)
        with open(pth, "w", encoding="utf-8", newline="\n") as f:
            f.write(txt)
    return {"judgements": {k: (v["label"] if v else None) for k, v in judgements.items()}, "skipped": sorted(skipped)}


def summary_md2(recs, vlist, ids, skipped, judgements, fam, hrv_tab, w4, diag, eq, eqf, eqh) -> str:
    base = vlist[0][0]
    md = "# 3단계 ablation 요약 (SDD-317, 개발 세트 한정)\n\n"
    md += "- 사전등록: `verify-addendum-9.md` + `experiments.json`(`phase3`) — 실험 실행 전 커밋. 판정 규칙은 addendum-8 A8-4 와 같다.\n"
    md += f"- G-resp(V0 호흡 == 코어): 프레임 {eq['frames']} 중 불일치 {eq['mismatch_frames']} ({fmt(100 * eq['mismatch_fraction'], 4)}%), 기록별 최악 {fmt(100 * eq['worst_record_fraction'], 3)}%, 최대 |Δ| {eq['max_abs_diff_both_valid']:.3g} → **{'통과' if eq['pass'] else '실패'}**\n"
    md += f"- G-front(전단 거울 == 코어 RR·박동시각): 프레임 {eqf['frames']} 중 불일치 {eqf['mismatch_frames']} ({fmt(100 * eqf['mismatch_fraction'], 4)}%), 기록별 최악 {fmt(100 * eqf['worst_record_fraction'], 3)}%, 최대 |ΔRR| {eqf['max_abs_drr_ms']:.3g} ms / |Δts| {eqf['max_abs_dts_ms']:.3g} ms → **{'통과' if eqf['pass'] else '실패'}**\n"
    md += f"- G-hrv(V0 SDNN·RMSSD == 코어): 프레임 {eqh['frames']} 중 불일치 {eqh['mismatch_frames']} ({fmt(100 * eqh['mismatch_fraction'], 4)}%), 기록별 최악 {fmt(100 * eqh['worst_record_fraction'], 3)}%, 최대 |Δ| {eqh['max_abs_diff_both_valid']:.3g} → **{'통과' if eqh['pass'] else '실패'}**\n"
    md += "- 홀드아웃(MARSH 14명, CapnoBase)은 열지 않았다. 공개 PPG는 손가락/귀/손목이며 LINK BAND 이마 반사형이 아니다. **결과는 관찰이며 인과 단정이 아니다.**\n"
    judged = [v for v in vlist[1:] if v[2].get("judged") and v[0] not in skipped]
    n_imp = sum(1 for v in judged if judgements[v[0]]["label"] == "개선")
    md += f"- 판정 대상 6건 중 **개선 {n_imp}건**" + (f" (게이트로 제외 {len(skipped)}건)" if skipped else "") + ". 다중 비교 보정은 참고(판정과 별개).\n\n"
    md += "## 1. 판정 요약\n\n| ID | 이름 | 판정 | 풀링 ΔMAE [쌍체 95% CI] | Bonferroni CI | p(raw) | p(Holm) | 풀링 ΔMAE_pen [쌍체 CI] | Δcoverage(%p) | 미달 항목 |\n|---|---|---|---|---|---|---|---|---|---|\n"
    b_all = cell_summary(recs, base, None, "ALL")
    for vid, _p, meta in vlist[1:]:
        if vid in skipped:
            md += f"| {vid} | {meta.get('name', '')} | 게이트 실패로 미생성 | – | – | – | – | – | – | G-front |\n"
            continue
        sv = cell_summary(recs, vid, None, "ALL", with_ci_against=base)
        ci = sv["ci"]
        lab = judgements[vid]["label"] if meta.get("judged") else "관찰용(판정 없음)"
        miss = ", ".join(judgements[vid]["misses"]) if meta.get("judged") and judgements[vid]["misses"] else "–"
        f = fam[vid]
        md += (
            f"| {vid} | {meta.get('name', '')} | {lab} | {fmt(sv['mae'] - b_all['mae'])}{_ci(ci['diff']['mae'])} | {_ci(f['ci_bonf'])} | {fmt(f['p_raw'], 4)} | {fmt(f['p_holm'], 4)} | "
            f"{fmt(sv['mae_pen'] - b_all['mae_pen'])}{_ci(ci['diff']['mae_pen'])} | {fmt((sv['coverage'] - b_all['coverage']) * 100, 2)} | {miss} |\n"
        )
    cols = [(ds, st) for ds in DS_ORDER for st in ("lt6", "6_12", "12_20", "gt20")]
    md += "\n## 2. 층별 MAE 변화 (Δ = 변형 − V0, 회/분; n_rec<10 칸은 괄호로 '해석불가')\n\n| ID | " + " | ".join(f"{ds}/{STRATUM_NAMES[st]}" for ds, st in cols) + " |\n|---|" + "---|" * len(cols) + "\n"
    base_cells = {c: cell_summary(recs, base, c[0], c[1]) for c in cols}
    md += "| V0 MAE (기록 n) | " + " | ".join(f"{fmt(base_cells[c].get('mae'))} ({base_cells[c].get('n_rec', 0)})" for c in cols) + " |\n"
    for vid, _p, _m in vlist[1:]:
        if vid in skipped:
            continue
        cells = []
        for c in cols:
            sv = cell_summary(recs, vid, c[0], c[1])
            if sv.get("n_win", 0) == 0:
                cells.append("–")
                continue
            dm = sv.get("mae", NAN) - base_cells[c].get("mae", NAN)
            txt = f"{dm:+.2f}" if dm == dm else "–"
            cells.append(f"({txt})" if sv["n_rec"] < 10 else txt)
        md += f"| {vid} | " + " | ".join(cells) + " |\n"
    md += "\n## 3. 층별 bias (변형 bias; 괄호 안은 V0)\n\n| ID | " + " | ".join(f"{ds}/{STRATUM_NAMES[st]}" for ds, st in cols) + " |\n|---|" + "---|" * len(cols) + "\n"
    for vid in ids:
        cells = []
        for c in cols:
            sv = cell_summary(recs, vid, c[0], c[1])
            b0 = base_cells[c].get("bias", NAN)
            cells.append("–" if sv.get("n_win", 0) == 0 else (fmt(sv.get("bias"), 2) if vid == base else f"{fmt(sv.get('bias'), 2)} ({fmt(b0, 2)})"))
        md += f"| {vid} | " + " | ".join(cells) + " |\n"
    # W4 분해
    md += "\n## 4. W4 — V4 원인 분해 (BIDMC vs MARSH, 관찰; 원인을 단정하지 않는다)\n\n| ID | 설명 | BIDMC MAE (Δ) | MARSH MAE (Δ) | 풀링 ΔMAE [쌍체 CI] |\n|---|---|---|---|---|\n"
    for vid, desc in (("V0", "기준"), ("W4a", "평균 제거만"), ("W4b", "기울기 제거만"), ("V4", "평균+선형 제거(2단계 V4 재계산)")):
        if vid not in ids:
            continue
        cb = cell_summary(recs, vid, "bidmc", "ALL")
        cm = cell_summary(recs, vid, "marsh", "ALL")
        b0 = cell_summary(recs, base, "bidmc", "ALL")
        m0 = cell_summary(recs, base, "marsh", "ALL")
        pooled = cell_summary(recs, vid, None, "ALL", with_ci_against=base) if vid != base else {}
        pc = pooled.get("ci", {}).get("diff", {}).get("mae")
        pd_ = (pooled["mae"] - b_all["mae"]) if pooled else 0.0
        md += f"| {vid} | {desc} | {fmt(cb['mae'])} ({fmt(cb['mae'] - b0['mae']) if vid != base else '–'}) | {fmt(cm['mae'])} ({fmt(cm['mae'] - m0['mae']) if vid != base else '–'}) | {fmt(pd_) if vid != base else '–'}{_ci(pc)} |\n"
    md += "\n데이터셋 신호 특성 (V0, 호흡 계산 프레임 기준 관찰 통계):\n\n| 항목 | BIDMC | MARSH dev |\n|---|---|---|\n"
    a, b = w4["bidmc"], w4["marsh"]
    rows_w4 = [
        ("기록 수", a["n_rec"], b["n_rec"]),
        ("기록 길이 중앙(최소~최대) s", f"{a['duration_s']['median']:.0f} ({a['duration_s']['min']}~{a['duration_s']['max']})", f"{b['duration_s']['median']:.0f} ({b['duration_s']['min']}~{b['duration_s']['max']})"),
        ("참 호흡수 평균 ± SD (창 {n})".replace("{n}", "n_win"), f"{fmt(a['truth_rate']['mean'])} ± {fmt(a['truth_rate']['sd'])} (n={a['truth_rate']['n_win']})", f"{fmt(b['truth_rate']['mean'])} ± {fmt(b['truth_rate']['sd'])} (n={b['truth_rate']['n_win']})"),
        ("기록 평균 호흡수의 기록 간 SD", fmt(a["truth_rate"]["rec_mean_sd"]), fmt(b["truth_rate"]["rec_mean_sd"])),
        ("창 수 <6 / 6–12 / 12–20 / >20", " / ".join(str(a["truth_rate"]["windows_by_stratum"][k]) for k in ("<6", "6–12", "12–20", ">20")), " / ".join(str(b["truth_rate"]["windows_by_stratum"][k]) for k in ("<6", "6–12", "12–20", ">20"))),
        ("재표본 선형 기울기 |b| 중앙(IQR) 초/분", f"{fmt(a['resample_slope_abs_s_per_min']['median'], 4)} ({fmt(a['resample_slope_abs_s_per_min']['p25'], 4)}~{fmt(a['resample_slope_abs_s_per_min']['p75'], 4)})", f"{fmt(b['resample_slope_abs_s_per_min']['median'], 4)} ({fmt(b['resample_slope_abs_s_per_min']['p25'], 4)}~{fmt(b['resample_slope_abs_s_per_min']['p75'], 4)})"),
        ("창 평균 RR 중앙 s", fmt(a["mean_rr_s"]["median"], 3), fmt(b["mean_rr_s"]["median"], 3)),
        ("저주파(<0.15Hz)/대역(0.15–0.4Hz) PSD 비 중앙(IQR)", f"{fmt(a['lf_to_band_power']['median'], 3)} ({fmt(a['lf_to_band_power']['p25'], 3)}~{fmt(a['lf_to_band_power']['p75'], 3)})", f"{fmt(b['lf_to_band_power']['median'], 3)} ({fmt(b['lf_to_band_power']['p25'], 3)}~{fmt(b['lf_to_band_power']['p75'], 3)})"),
        ("지배 주파수가 대역 하단 2빈인 프레임 비율", fmt(a["dominant_at_band_floor_fraction"] * 100, 1) + "%", fmt(b["dominant_at_band_floor_fraction"] * 100, 1) + "%"),
        ("정제 제거율(누적 신규 대비 제거) 평균", fmt(a["refine_removed_ratio_mean"] * 100, 1) + "%", fmt(b["refine_removed_ratio_mean"] * 100, 1) + "%"),
    ]
    for r in rows_w4:
        md += f"| {r[0]} | {r[1]} | {r[2]} |\n"
    # HRV 요약
    if hrv_tab:
        md += "\n## 5. 박동·HRV 요약 (신뢰 ECG 기록 풀링; 변형 − V0; 판정 아님)\n\n| ID | HR_rr MAE (V0→변형) | ΔHR MAE [CI] | SDNN bias % (V0→변형) | Δ SDNN bias [CI] | RMSSD bias % (V0→변형) | Δ RMSSD bias [CI] | 숙성 박동 F1 (V0→변형) | ΔF1 [CI] |\n|---|---|---|---|---|---|---|---|---|\n"
        for vid in HRV_VARIANTS_ORDER:
            if vid not in hrv_tab or vid == base:
                continue
            c, b = hrv_tab[vid]["pooled"], hrv_tab[base]["pooled"]
            if "mae" not in c.get("hr", {}):
                continue
            d = lambda m, k: c[m].get(k)
            dh, ds_, dr, df = d("hr", "d_mae"), d("sdnn", "d_bias"), d("rmssd", "d_bias"), c["f1"].get("d_f1")
            md += (
                f"| {vid} | {fmt(b['hr']['mae'])}→{fmt(c['hr']['mae'])} | {fmt(dh['diff']) if dh else '–'}{_ci(dh['ci']) if dh else ''} | "
                f"{fmt(b['sdnn']['rel_bias'] * 100, 1)}→{fmt(c['sdnn']['rel_bias'] * 100, 1)} | {fmt(ds_['diff']) if ds_ else '–'}{_ci(ds_['ci']) if ds_ else ''} | "
                f"{fmt(b['rmssd']['rel_bias'] * 100, 1)}→{fmt(c['rmssd']['rel_bias'] * 100, 1)} | {fmt(dr['diff']) if dr else '–'}{_ci(dr['ci']) if dr else ''} | "
                f"{fmt(b['f1'].get('f1'), 3)}→{fmt(c['f1'].get('f1'), 3)} | {fmt(df['diff'], 3) if df else '–'}{_ci(df['ci'], 3) if df else ''} |\n"
            )
    md += "\n## 6. 변형 진단\n\n| ID | 호흡 계산 프레임 | 시간축 복귀 | SQI 게이트 보류 프레임 / 전체 | 재시드 | 정제 제거율 평균 |\n|---|---|---|---|---|---|\n"
    for vid, _p, _m in vlist:
        d = diag[vid]
        md += f"| {vid} | {d['calc_frames']} | {d['fallback_frames']} | {d['gated_frames']} / {d['frames']} | {d['reseeds']} | {fmt(d['refine_removed_ratio_mean'] * 100, 1)}% |\n"
    return md


# ---------------------------------------------------------------- 실행

def two_stage_v4_match(recs) -> dict:
    """2단계 V4 결과(results/ablation/resp-windows-ablation.csv)와 이번 재계산 V4/V0 의 창별 일치."""
    path = os.path.join(RESULTS, "ablation", "resp-windows-ablation.csv")
    if not os.path.exists(path):
        return {"checked": False}
    prev = {}
    with open(path, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            prev[(row["ds"], row["rid"], int(row["T"]))] = (row["V0"], row["V4"])
    n = mis = 0
    for r in recs:
        for (_L, T, _tv, _w) in r["windows"]:
            p = prev.get((r["ds"], r["rid"], T))
            if p is None:
                continue
            for pv, vid in ((p[0], "V0"), (p[1], "V4")):
                cur = r["series"][vid][T - 1]
                a = None if pv == "" else float(pv)
                n += 1
                if (a is None) != (cur is None) or (a is not None and abs(a - cur) > 1e-5):
                    mis += 1
    return {"checked": True, "compared_cells": n, "mismatch": mis}


def run_ablation2(out_dir: str = OUT_DIR, results_dir: str = RESULTS) -> dict:
    from .adapters.loaders import load_record
    from .core_runner import build, core_provenance
    from .splits import check_leakage, load_splits

    guard.ACCESS_LOG = os.path.join(results_dir, "access-log-ablation2.jsonl")
    if os.path.exists(guard.ACCESS_LOG):
        os.remove(guard.ACCESS_LOG)
    reg = load_registry(EXPERIMENTS_PATH)
    vlist = phase3_variants(reg)
    groups, v2g = build_groups(vlist)
    s = load_splits()
    bad = check_leakage(s)
    if bad:
        raise SystemExit(f"분할 누수: {bad}")
    prov = core_provenance()
    build()
    os.makedirs(out_dir, exist_ok=True)
    recs = []
    for ds in DS_ORDER:
        for rid in s["dev"][ds]:
            rec = load_record(ds, rid)
            recs.append(process_record2(rec, vlist, groups, v2g))
    base = vlist[0][0]
    eq = equivalence(recs, base)
    eqf = gate_front(recs)
    eqh = gate_hrv(recs)
    if not eq["pass"]:
        with open(os.path.join(out_dir, "equivalence-resp.json"), "w", encoding="utf-8", newline="\n") as f:
            f.write(canon_json(eq) + "\n")
        print("G-resp 실패 — 변형 결과를 쓰지 않는다")
        return {"pass": False, "gate": "G-resp", "equivalence": {k: eq[k] for k in ("frames", "mismatch_frames", "mismatch_fraction", "worst_record_fraction")}}
    res = write_outputs(recs, vlist, v2g, eq, eqf, eqh, out_dir, results_dir)
    return {"pass": True, "core_src_tree": prov["core_src_tree"], "holdout_opened": False, "g_front": eqf["pass"], "g_hrv": eqh["pass"], "v4_vs_phase2": two_stage_v4_match(recs), **res}


def main() -> int:
    print(json.dumps(run_ablation2(), ensure_ascii=False, sort_keys=True))
    return 0
