"""2단계 ablation 실행기 (verify-addendum-8). 개발 세트(BIDMC 53 + MARSH dev 15)만, 홀드아웃 접근 없음.

흐름: 기록마다 변환 → 코어(C0) 1회 → 거울(RR 버퍼+호흡 변형 전부) 프레임별 → 창별 값.
거울 동치 게이트(V0 vs 코어 프레임별 resp)를 통과하지 못하면 변형 결과를 쓰지 않고 중단한다.
"""
from __future__ import annotations

import json
import os
from typing import Optional

import numpy as np

from . import guard
from .common import BOOTSTRAP_B, NULL_PENALTY, PRIMARY_L, RESULTS, SCORE_HOP_S, SEED, STRATA, TOOL_DIR, WORK, canon_json
from .metrics import resp_stats, stratum_of
from .report import fmt, rows_to_csv
from .truth import truth_for_record
from .variants import BASE_PARAMS, RespMirror, VariantState

EXPERIMENTS_PATH = os.path.join(TOOL_DIR, "experiments.json")
OUT_DIR = os.path.join(RESULTS, "ablation")
ABL_ACCESS_LOG = os.path.join(RESULTS, "access-log-ablation.jsonl")
DS_ORDER = ("bidmc", "marsh")
STRATUM_NAMES = {"ALL": "전체", "lt6": "<6", "6_12": "6–12", "12_20": "12–20", "gt20": ">20"}
STRATUM_KEYS = ("ALL", "lt6", "6_12", "12_20", "gt20")
EQ_TOL = 1e-6
EQ_MAX_TOTAL = 0.001
EQ_MAX_REC = 0.01
MIN_REC_FOR_STRATUM = 10
COV_DROP_MAX = 0.05
NAN = float("nan")


def load_registry(path: str = EXPERIMENTS_PATH) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def variant_list(reg: dict) -> list[tuple[str, dict, dict]]:
    """[(id, params, meta)] — V0 가 항상 첫째."""
    out = [(reg["baseline"]["id"], dict(reg["baseline"]["params"]), {"judged": False, "name": reg["baseline"]["name"]})]
    for v in reg["variants"]:
        out.append((v["id"], dict(v["params"]), v))
    for _, p, _ in out:
        unknown = set(p) - set(BASE_PARAMS)
        if unknown:
            raise KeyError(f"experiments.json 알 수 없는 파라미터 {sorted(unknown)}")
    return out


# ---------------------------------------------------------------- 통계 (합계 벡터 기반 cluster bootstrap)

def rec_vec(truth: np.ndarray, core: np.ndarray) -> np.ndarray:
    """기록 1건의 합계 벡터 [n_win, n_valid, sum|e|, sum e]."""
    ok = np.isfinite(core)
    e = (core - truth)[ok]
    return np.array([float(len(truth)), float(ok.sum()), float(np.abs(e).sum()), float(e.sum())])


def totals_stats(t: np.ndarray) -> dict:
    n, nv, sae, se = t
    return {
        "mae": sae / nv if nv else NAN,
        "bias": se / nv if nv else NAN,
        "coverage": nv / n if n else NAN,
        "mae_pen": (sae + NULL_PENALTY * (n - nv)) / n if n else NAN,
    }


def _pct(vals):
    arr = np.asarray(vals, dtype=float)
    arr = arr[np.isfinite(arr)]
    if len(arr) <= 20:
        return (NAN, NAN)
    return (float(np.percentile(arr, 2.5)), float(np.percentile(arr, 97.5)))


def paired_bootstrap(vec_var: np.ndarray, vec_base: np.ndarray, B: int = BOOTSTRAP_B, seed: int = SEED) -> dict:
    """vec_*: (R,4). 같은 재표본 인덱스로 변형·기준 지표와 차이(변형−기준)의 percentile 95% CI.
    난수 소비 순서는 metrics.cluster_bootstrap 과 같다(draw 마다 rng.integers(0,R,R))."""
    R = len(vec_var)
    if R < 2:
        return {}
    rng = np.random.Generator(np.random.PCG64(seed))
    keys = ("mae", "bias", "coverage", "mae_pen")
    dv = {k: [] for k in keys}
    db = {k: [] for k in keys}
    dd = {k: [] for k in keys}
    for _ in range(B):
        idx = rng.integers(0, R, size=R)
        cnt = np.bincount(idx, minlength=R).astype(float)
        sv = totals_stats(cnt @ vec_var)
        sb = totals_stats(cnt @ vec_base)
        for k in keys:
            dv[k].append(sv[k])
            db[k].append(sb[k])
            dd[k].append(sv[k] - sb[k] if (np.isfinite(sv[k]) and np.isfinite(sb[k])) else NAN)
    return {"var": {k: _pct(dv[k]) for k in keys}, "base": {k: _pct(db[k]) for k in keys}, "diff": {k: _pct(dd[k]) for k in keys}}


# ---------------------------------------------------------------- 기록 처리

def process_for_ablation(rec, variants: list[VariantState]) -> dict:
    from .convert import prepare
    from .core_runner import run_core

    os.makedirs(WORK, exist_ok=True)
    pkts, _info, _ir, _x50 = prepare(rec.ppg, rec.fs)
    path = os.path.join(WORK, f"abl_{rec.ds}_{rec.rid}.pkts")
    with open(path, "wb") as f:
        f.write(pkts)
    try:
        rows = run_core(path)
    finally:
        os.remove(path)
    mirror = RespMirror(variants)
    series = {v.id: [] for v in variants}
    mism_buf = 0
    for r in rows:
        d = mirror.step(r["rr"], r["rr_end_ts"], r["win_end_ts"])
        if d["buf_len"] != r["rr_buf"]:
            mism_buf += 1
        for v in variants:
            series[v.id].append(v.resp)
    core_series = [r["resp"] for r in rows]
    windows = []
    dur = len(rows)
    for T in range(PRIMARY_L, dur + 1, SCORE_HOP_S):
        tv, why = truth_for_record(rec, float(PRIMARY_L), float(T))
        windows.append((PRIMARY_L, T, tv, why))
    return {
        "ds": rec.ds,
        "rid": rec.rid,
        "dur": dur,
        "core": core_series,
        "series": series,
        "windows": windows,
        "buf_mismatch": mism_buf,
        "fallback_frames": {v.id: v.fallback_frames for v in variants},
        "calc_frames": {v.id: v.calc_frames for v in variants},
    }


def equivalence(recs: list[dict], base_id: str) -> dict:
    per = {}
    tot_f = tot_m = 0
    max_diff = 0.0
    for r in recs:
        m = 0
        for a, b in zip(r["core"], r["series"][base_id]):
            if a is None and b is None:
                continue
            if a is None or b is None:
                m += 1
                continue
            d = abs(a - b)
            max_diff = max(max_diff, d)
            if d > EQ_TOL:
                m += 1
        per[f"{r['ds']}/{r['rid']}"] = {"frames": r["dur"], "mismatch": m, "buf_mismatch": r["buf_mismatch"]}
        tot_f += r["dur"]
        tot_m += m
    worst = max((v["mismatch"] / v["frames"] for v in per.values()), default=0.0)
    frac = tot_m / tot_f if tot_f else 0.0
    return {
        "frames": tot_f,
        "mismatch_frames": tot_m,
        "mismatch_fraction": frac,
        "worst_record_fraction": worst,
        "max_abs_diff_both_valid": max_diff,
        "tolerance": EQ_TOL,
        "limits": {"total": EQ_MAX_TOTAL, "per_record": EQ_MAX_REC},
        "pass": bool(frac <= EQ_MAX_TOTAL and worst <= EQ_MAX_REC),
        "per_record": per,
    }


# ---------------------------------------------------------------- 집계

def window_arrays(recs: list[dict], vid: str, ds: Optional[str], stratum: Optional[str]):
    """기록별 (truth, core) 리스트 — 참값이 정의된 창만. 반환 [(rid, truth, core)] (창 0건 기록 제외)."""
    out = []
    for r in recs:
        if ds is not None and r["ds"] != ds:
            continue
        s = r["series"][vid]
        t, c = [], []
        for (_L, T, tv, _why) in r["windows"]:
            if tv is None:
                continue
            if stratum not in (None, "ALL") and stratum_of(tv) != stratum:
                continue
            t.append(tv)
            v = s[T - 1]
            c.append(v if v is not None else NAN)
        if t:
            out.append((f"{r['ds']}/{r['rid']}", np.asarray(t), np.asarray(c)))
    return out


def cell_summary(recs, vid, ds, stratum, with_ci_against: Optional[str] = None) -> dict:
    a = window_arrays(recs, vid, ds, stratum)
    if not a:
        return {"n_rec": 0, "n_win": 0}
    t = np.concatenate([x[1] for x in a])
    c = np.concatenate([x[2] for x in a])
    s = resp_stats(t, c)
    s["n_rec"] = len(a)
    if with_ci_against is not None and len(a) >= 3:
        b = window_arrays(recs, with_ci_against, ds, stratum)
        vv = np.array([rec_vec(x[1], x[2]) for x in a])
        vb = np.array([rec_vec(x[1], x[2]) for x in b])
        s["ci"] = paired_bootstrap(vv, vb)
    return s


def first_delay_and_jumps(series: list) -> tuple:
    first = next((i + 1 for i, v in enumerate(series) if v is not None), None)
    jumps = pairs = 0
    for a, b in zip(series, series[1:]):
        if a is not None and b is not None:
            pairs += 1
            if abs(b - a) > 4.0:
                jumps += 1
    return first, jumps, pairs


def judge(recs, vid: str, base_id: str) -> dict:
    """addendum-8 A8-4. 반환 상세 근거 + 라벨."""
    pooled = cell_summary(recs, vid, None, "ALL", with_ci_against=base_id)
    pooled_b = cell_summary(recs, base_id, None, "ALL")
    ci = pooled.get("ci", {})
    d_mae = ci.get("diff", {}).get("mae", (NAN, NAN))
    v_ci = ci.get("var", {}).get("mae", (NAN, NAN))
    b_ci = ci.get("base", {}).get("mae", (NAN, NAN))
    a_paired = bool(d_mae[1] < 0)
    a_indep = bool(v_ci[1] < b_ci[0] and pooled.get("mae", NAN) < pooled_b.get("mae", NAN))
    a_ok = a_paired or a_indep
    cov_rows = {}
    b_ok = True
    for ds in (None,) + DS_ORDER:
        sv = cell_summary(recs, vid, ds, "ALL")
        sb = cell_summary(recs, base_id, ds, "ALL")
        drop = sb["coverage"] - sv["coverage"]
        cov_rows[ds or "pooled"] = drop
        if drop > COV_DROP_MAX:
            b_ok = False
    cells = []
    c_ok = True
    for ds in DS_ORDER:
        for st in ("lt6", "6_12", "12_20", "gt20"):
            sv = cell_summary(recs, vid, ds, st)
            sb = cell_summary(recs, base_id, ds, st)
            n_rec = sv.get("n_rec", 0)
            if n_rec < MIN_REC_FOR_STRATUM:
                cells.append({"ds": ds, "stratum": st, "n_rec": n_rec, "status": "해석불가(n_rec<10)"})
                continue
            dm = sv.get("mae", NAN) - sb.get("mae", NAN)
            worse = not (dm <= 0.0)  # NaN 이면 악화로 본다
            if worse:
                c_ok = False
            cells.append({"ds": ds, "stratum": st, "n_rec": n_rec, "d_mae": dm, "status": "악화" if worse else "비악화"})
    d_pen = ci.get("diff", {}).get("mae_pen", (NAN, NAN))
    pen_worse = bool(d_pen[0] > 0)
    ok = a_ok and b_ok and c_ok and not pen_worse
    misses = []
    if not a_ok:
        misses.append("(a) MAE 개선 CI 기준 미달")
    if not b_ok:
        misses.append("(b) coverage 감소 >5%p")
    if not c_ok:
        misses.append("(c) 판정 가능 층에서 MAE 악화")
    if pen_worse:
        misses.append("(d) MAE_pen 유의 악화")
    return {
        "label": "개선" if ok else "개선 아님",
        "misses": misses,
        "a_paired": a_paired,
        "a_indep": a_indep,
        "d_mae_ci": d_mae,
        "d_mae_pen_ci": d_pen,
        "pooled": pooled,
        "pooled_base": pooled_b,
        "coverage_drop": cov_rows,
        "cells": cells,
    }


# ---------------------------------------------------------------- 리포트

def _ci(ci, k, nd=2):
    return f" [{fmt(ci[k][0], nd)}, {fmt(ci[k][1], nd)}]" if ci and k in ci else ""


def variant_md(recs, vid, base_id, meta, jr: Optional[dict], fb: dict) -> str:
    md = f"# 변형 {vid} — {meta.get('name', '')}\n\n"
    md += f"- 가설: {meta.get('hypothesis', '–')}\n- 변경점: {meta.get('change', '–')}\n- 판정 대상: {'예' if meta.get('judged') else '아니오(관찰용 — 판정 라벨 없음)'}\n"
    md += "- 비교 기준: V0(거울 기준선, 코어 C0 와 프레임 동치 확인됨). 개발 세트만, 홀드아웃 미접근. 인과는 단정하지 않는다.\n"
    if fb.get("calc_frames"):
        md += f"- 시간축 대체(단조 아님→누적 축 복귀) 프레임: {fb['fallback']}/{fb['calc_frames']}\n" if vid == "V3" else ""
    md += "\n## 1. 전체·데이터셋별 (쌍체 차이 = 변형 − V0, 기록 단위 cluster bootstrap B=2000 시드 317)\n\n"
    md += "| 범위 | 기록 n | 창 n | coverage V0→변형 | MAE V0 [CI] | MAE 변형 [CI] | ΔMAE [쌍체 CI] | ΔMAE_pen [쌍체 CI] | Δcoverage [쌍체 CI] |\n|---|---|---|---|---|---|---|---|---|\n"
    for ds, lab in ((None, "풀링(68)"), ("bidmc", "BIDMC"), ("marsh", "MARSH dev")):
        sv = cell_summary(recs, vid, ds, "ALL", with_ci_against=base_id)
        sb = cell_summary(recs, base_id, ds, "ALL")
        ci = sv.get("ci", {})
        d = lambda k, nd=2: fmt(sv.get(k, NAN) - sb.get(k, NAN), nd)
        md += (
            f"| {lab} | {sv['n_rec']} | {sv['n_win']} | {fmt(sb['coverage'] * 100, 1)}% → {fmt(sv['coverage'] * 100, 1)}% | "
            f"{fmt(sb.get('mae'))}{_ci(ci.get('base'), 'mae')} | {fmt(sv.get('mae'))}{_ci(ci.get('var'), 'mae')} | "
            f"{d('mae')}{_ci(ci.get('diff'), 'mae')} | {d('mae_pen')}{_ci(ci.get('diff'), 'mae_pen')} | "
            f"{fmt((sv['coverage'] - sb['coverage']) * 100, 1)}%p{_ci(ci.get('diff'), 'coverage', 3)} |\n"
        )
    md += "\n## 2. 층별 (참값 회/분; 데이터셋별)\n\n"
    md += "| 데이터셋 | 층 | 기록 n | 창 n | coverage V0→변형 | MAE V0 | MAE 변형 | ΔMAE [쌍체 CI] | bias V0 | bias 변형 | 중앙AE V0→변형 | p95 V0→변형 | 경고 |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|\n"
    for ds in DS_ORDER:
        for st in STRATUM_KEYS:
            sv = cell_summary(recs, vid, ds, st, with_ci_against=base_id)
            sb = cell_summary(recs, base_id, ds, st)
            if sv.get("n_win", 0) == 0:
                md += f"| {ds} | {STRATUM_NAMES[st]} | 0 | 0 | – | – | – | – | – | – | – | – | 표본 없음 |\n"
                continue
            warn = "표본 부족 — 해석 불가" if sv["n_rec"] < 3 else ("해석불가(n_rec<10, 판정 제외)" if sv["n_rec"] < MIN_REC_FOR_STRATUM and st != "ALL" else ("CI 넓음 — 해석 주의" if sv["n_rec"] < 10 else ""))
            md += (
                f"| {ds} | {STRATUM_NAMES[st]} | {sv['n_rec']} | {sv['n_win']} | {fmt(sb['coverage'] * 100, 1)}% → {fmt(sv['coverage'] * 100, 1)}% | "
                f"{fmt(sb.get('mae'))} | {fmt(sv.get('mae'))} | {fmt(sv.get('mae', NAN) - sb.get('mae', NAN))}{_ci(sv.get('ci', {}).get('diff'), 'mae')} | "
                f"{fmt(sb.get('bias'))} | {fmt(sv.get('bias'))} | {fmt(sb.get('median_ae'))} → {fmt(sv.get('median_ae'))} | {fmt(sb.get('p95_ae'))} → {fmt(sv.get('p95_ae'))} | {warn} |\n"
            )
    md += "\n## 3. 분포·지연·안정성 (V0 → 변형)\n\n| 범위 | LoA V0 | LoA 변형 | MAE_pen V0 | MAE_pen 변형 | 첫 유효값 지연 중앙/최소/최대(s) V0 | 변형 | 1초 점프>4 비율 V0 | 변형 |\n|---|---|---|---|---|---|---|---|---|\n"
    for ds, lab in (("bidmc", "BIDMC"), ("marsh", "MARSH dev")):
        sv = cell_summary(recs, vid, ds, "ALL")
        sb = cell_summary(recs, base_id, ds, "ALL")
        loa = lambda s: f"{fmt(s.get('loa_lo'))}~{fmt(s.get('loa_hi'))}" if "loa_lo" in s else "–"

        def dj(v):
            ds_, js, ps = [], 0, 0
            for r in recs:
                if r["ds"] != ds:
                    continue
                f, j, p = first_delay_and_jumps(r["series"][v])
                if f is not None:
                    ds_.append(f)
                js += j
                ps += p
            nn = sum(1 for r in recs if r["ds"] == ds) - len(ds_)
            dd = f"{np.median(ds_):.0f} / {min(ds_)} / {max(ds_)} (값 없음 {nn})" if ds_ else "값 없음"
            return dd, (f"{js}/{ps} = {fmt(100 * js / ps, 2)}%" if ps else "–")

        d0, j0 = dj(base_id)
        d1, j1 = dj(vid)
        md += f"| {lab} | {loa(sb)} | {loa(sv)} | {fmt(sb['mae_pen'])} | {fmt(sv['mae_pen'])} | {d0} | {d1} | {j0} | {j1} |\n"
    if jr is not None:
        md += "\n## 4. 판정 (addendum-8 A8-4)\n\n"
        md += f"- (a) MAE: 쌍체 ΔMAE 95% CI = [{fmt(jr['d_mae_ci'][0], 3)}, {fmt(jr['d_mae_ci'][1], 3)}] → 쌍체 기준 {'통과' if jr['a_paired'] else '미통과'}, 독립 CI 비중첩 기준 {'통과' if jr['a_indep'] else '미통과'}\n"
        md += "- (b) coverage 감소(V0−변형, %p): " + ", ".join(f"{k} {fmt(v * 100, 2)}" for k, v in jr["coverage_drop"].items()) + " (한계 5.0)\n"
        md += "- (c) 층(n_rec≥10만 판정): " + "; ".join(f"{c['ds']}/{STRATUM_NAMES[c['stratum']]} n={c['n_rec']} {c['status']}" + (f" (ΔMAE {fmt(c['d_mae'])})" if "d_mae" in c else "") for c in jr["cells"]) + "\n"
        md += f"- (d) ΔMAE_pen 쌍체 CI = [{fmt(jr['d_mae_pen_ci'][0], 3)}, {fmt(jr['d_mae_pen_ci'][1], 3)}]\n"
        md += f"\n**판정: {jr['label']}**" + (f" — 미달: {', '.join(jr['misses'])}" if jr["misses"] else "") + "\n"
        md += "\n- 개선이어도 홀드아웃 확인 전에는 '코어 반영 후보'일 뿐이다.\n"
    else:
        md += "\n## 4. 판정\n\n판정 대상 아님(관찰용) — 수치만 보고한다.\n"
    return md


def summary_md(recs, vlist, judgements: dict, eq: dict, diag: dict, notes: str) -> str:
    base = vlist[0][0]
    md = "# 2단계 ablation 요약 (SDD-317, 개발 세트 한정)\n\n"
    md += "- 사전등록: `verify-addendum-8.md` + `experiments.json`(실험 실행 전 커밋). 비교 기준 V0 = 코어 호흡 계산의 파이썬 거울.\n"
    md += f"- 거울 동치 게이트: 프레임 {eq['frames']}개 중 불일치 {eq['mismatch_frames']}개 ({fmt(100 * eq['mismatch_fraction'], 4)}%), 기록별 최악 {fmt(100 * eq['worst_record_fraction'], 3)}%, 둘 다 값 있는 프레임의 최대 |Δ| = {eq['max_abs_diff_both_valid']:.3g} 회/분 → **{'통과' if eq['pass'] else '실패'}**\n"
    md += "- 홀드아웃(MARSH 14명, CapnoBase)은 열지 않았다. 공개 PPG는 손가락/귀/손목이며 LINK BAND 이마 반사형이 아니다. **결과는 관찰이며 인과 단정이 아니다.**\n"
    judged = [v for v in vlist[1:] if v[2].get("judged")]
    n_imp = sum(1 for v in judged if judgements[v[0]]["label"] == "개선")
    md += f"- 판정 대상 {len(judged)}건 중 **개선 {n_imp}건** (다중성 보정 없음, 우연 가능성 감안).\n\n"
    md += "## 1. 판정 요약\n\n| ID | 이름 | 판정 | 풀링 ΔMAE [쌍체 CI] | 풀링 ΔMAE_pen [쌍체 CI] | Δcoverage(풀링, %p) | 미달 항목 |\n|---|---|---|---|---|---|---|\n"
    b_all = cell_summary(recs, base, None, "ALL")
    for vid, _p, meta in vlist[1:]:
        sv = cell_summary(recs, vid, None, "ALL", with_ci_against=base)
        ci = sv["ci"]
        lab = judgements[vid]["label"] if meta.get("judged") else "관찰용(판정 없음)"
        miss = ", ".join(judgements[vid]["misses"]) if meta.get("judged") and judgements[vid]["misses"] else "–"
        md += (
            f"| {vid} | {meta.get('name', '')} | {lab} | {fmt(sv['mae'] - b_all['mae'])}{_ci(ci['diff'], 'mae')} | "
            f"{fmt(sv['mae_pen'] - b_all['mae_pen'])}{_ci(ci['diff'], 'mae_pen')} | {fmt((sv['coverage'] - b_all['coverage']) * 100, 2)} | {miss} |\n"
        )
    md += "\n## 2. 층별 MAE 변화 (Δ = 변형 − V0, 회/분; n_rec<10 칸은 괄호로 '해석불가')\n\n"
    cols = [(ds, st) for ds in DS_ORDER for st in ("lt6", "6_12", "12_20", "gt20")]
    md += "| ID | " + " | ".join(f"{ds}/{STRATUM_NAMES[st]}" for ds, st in cols) + " |\n|---|" + "---|" * len(cols) + "\n"
    base_cells = {c: cell_summary(recs, base, c[0], c[1]) for c in cols}
    md += "| V0 MAE (기록 n) | " + " | ".join(f"{fmt(base_cells[c].get('mae'))} ({base_cells[c].get('n_rec', 0)})" for c in cols) + " |\n"
    for vid, _p, _m in vlist[1:]:
        cells = []
        for c in cols:
            sv = cell_summary(recs, vid, c[0], c[1])
            if sv.get("n_win", 0) == 0:
                cells.append("–")
                continue
            dm = sv.get("mae", NAN) - base_cells[c].get("mae", NAN)
            txt = f"{dm:+.2f}" if dm == dm else "–"
            cells.append(f"({txt})" if sv["n_rec"] < MIN_REC_FOR_STRATUM else txt)
        md += f"| {vid} | " + " | ".join(cells) + " |\n"
    md += "\n## 3. 층별 bias 변화 (변형 bias; 괄호 안은 V0)\n\n| ID | " + " | ".join(f"{ds}/{STRATUM_NAMES[st]}" for ds, st in cols) + " |\n|---|" + "---|" * len(cols) + "\n"
    for vid, _p, _m in vlist:
        cells = []
        for c in cols:
            sv = cell_summary(recs, vid, c[0], c[1])
            b0 = base_cells[c].get("bias", NAN)
            cells.append("–" if sv.get("n_win", 0) == 0 else (fmt(sv.get("bias"), 2) if vid == base else f"{fmt(sv.get('bias'), 2)} ({fmt(b0, 2)})"))
        md += f"| {vid} | " + " | ".join(cells) + " |\n"
    md += "\n## 4. 변형 진단\n\n"
    for vid, _p, _m in vlist:
        d = diag.get(vid, {})
        md += f"- {vid}: 호흡 계산 프레임 {d.get('calc_frames', 0)}, 시간축 복귀 프레임 {d.get('fallback_frames', 0)}\n"
    if notes.strip():
        md += "\n" + notes.strip() + "\n"
    return md


# ---------------------------------------------------------------- 실행

def run_ablation(out_dir: str = OUT_DIR, results_dir: str = RESULTS) -> dict:
    from .adapters.loaders import load_record
    from .core_runner import build, core_provenance
    from .splits import check_leakage, load_splits

    # 홀드아웃 접근 로그를 ablation 전용 파일로 (dev_open 만 기록되어야 한다)
    guard.ACCESS_LOG = os.path.join(results_dir, "access-log-ablation.jsonl")
    if os.path.exists(guard.ACCESS_LOG):
        os.remove(guard.ACCESS_LOG)
    reg = load_registry()
    vlist = variant_list(reg)
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
            variants = [VariantState(v, p) for v, p, _ in vlist]
            recs.append(process_for_ablation(rec, variants))
    base = vlist[0][0]
    eq = equivalence(recs, base)
    with open(os.path.join(out_dir, "equivalence.json"), "w", encoding="utf-8", newline="\n") as f:
        f.write(canon_json({k: v for k, v in eq.items()}) + "\n")
    if not eq["pass"]:
        print("거울 동치 게이트 실패 — 변형 결과를 쓰지 않는다. results/ablation/equivalence.json 참조")
        return {"pass": False, "equivalence": {k: eq[k] for k in ("frames", "mismatch_frames", "mismatch_fraction", "worst_record_fraction")}}
    # 창별 CSV
    header = ["ds", "rid", "L", "T", "truth", "truth_status", "core_C0"] + [v for v, _, _ in vlist]
    body = []
    for r in recs:
        for (L, T, tv, why) in r["windows"]:
            body.append([r["ds"], r["rid"], L, T, tv, why, r["core"][T - 1]] + [r["series"][v][T - 1] for v, _, _ in vlist])
    files = {"resp-windows-ablation.csv": rows_to_csv(header, body)}
    sm_rows = []
    for r in recs:
        for v, _, _ in vlist:
            f, j, p = first_delay_and_jumps(r["series"][v])
            sm_rows.append([r["ds"], r["rid"], v, f, j, p])
    files["frame-summary.csv"] = rows_to_csv(["ds", "rid", "variant", "first_resp_delay_s", "jumps", "jump_pairs"], sm_rows)
    diag = {v: {"calc_frames": sum(r["calc_frames"][v] for r in recs), "fallback_frames": sum(r["fallback_frames"][v] for r in recs)} for v, _, _ in vlist}
    files["variant-diagnostics.json"] = canon_json(diag) + "\n"
    judgements = {}
    for vid, _p, meta in vlist[1:]:
        judgements[vid] = judge(recs, vid, base) if meta.get("judged") else None
    files["judgements.json"] = canon_json({k: ({kk: vv for kk, vv in v.items() if kk not in ("pooled", "pooled_base")} if v else None) for k, v in judgements.items()}) + "\n"
    notes_path = os.path.join(results_dir, "ablation-notes.md")
    notes = open(notes_path, encoding="utf-8").read() if os.path.exists(notes_path) else ""
    for vid, _p, meta in vlist[1:]:
        fb = {"calc_frames": diag[vid]["calc_frames"], "fallback": diag[vid]["fallback_frames"]}
        files[f"../ablation-v1-{vid}.md"] = variant_md(recs, vid, base, meta, judgements[vid], fb)
    files["../ablation-summary.md"] = summary_md(recs, vlist, {k: v for k, v in judgements.items() if v}, eq, diag, notes)
    for name, txt in files.items():
        with open(os.path.normpath(os.path.join(out_dir, name)), "w", encoding="utf-8", newline="\n") as f:
            f.write(txt)
    meta = {"core_src_tree": prov["core_src_tree"], "equivalence_pass": True, "holdout_opened": False}
    return meta


def main() -> int:
    print(json.dumps(run_ablation(), ensure_ascii=False, sort_keys=True))
    return 0
