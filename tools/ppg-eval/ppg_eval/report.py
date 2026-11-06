"""집계·CSV·markdown 생성 (결정론: 실행 시각·경로 없음)."""
from __future__ import annotations

import csv
import io

import numpy as np

from .common import PRIMARY_L, STRATA, canon_json
from .metrics import bias_loa, cluster_bootstrap, resp_stats, stratum_of

NAN = float("nan")


def fmt(v, nd=2):
    if v is None or (isinstance(v, float) and v != v):
        return "–"
    return f"{v:.{nd}f}"


def rows_to_csv(header, rows) -> str:
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(header)
    for r in rows:
        w.writerow(["" if (x is None or (isinstance(x, float) and x != x)) else (f"{x:.6f}" if isinstance(x, (float, np.floating)) else x) for x in r])
    return buf.getvalue()


def _arrays(resp_rows, ds, L, T_min=0, stratum=None):
    per = {}
    for (d, rid, l, T, tv, why, core, reason, buf) in resp_rows:
        if d != ds or l != L or tv is None or T < T_min:
            continue
        if stratum is not None and stratum_of(tv) != stratum:
            continue
        t, c = per.setdefault(rid, ([], []))
        t.append(tv)
        c.append(core if core is not None else NAN)
    return {k: (np.asarray(a), np.asarray(b)) for k, (a, b) in per.items()}


def resp_table(resp_rows, ds, L=PRIMARY_L, T_min=0):
    """층별 + 전체 행 리스트."""
    out = []
    for label, st in [("ALL", None)] + [(n, n) for n, _, _ in STRATA]:
        per = _arrays(resp_rows, ds, L, T_min, st)
        recs = list(per.values())
        if not recs:
            out.append({"stratum": label, "n_rec": 0, "n_win": 0})
            continue
        t = np.concatenate([a for a, _ in recs])
        c = np.concatenate([b for _, b in recs])
        s = resp_stats(t, c)
        s["stratum"] = label
        s["n_rec"] = len(recs)
        s["ci"] = cluster_bootstrap(recs) if len(recs) >= 3 else {}
        s["undefined_note"] = ""
        out.append(s)
    return out


def md_resp_table(rows, title) -> str:
    h = "| 층(참값 회/분) | 기록 n | 창 n | coverage [95% CI] | MAE [CI] | MAE_pen [CI] | 중앙AE | p95 | bias [CI] | LoA | CP≤2 | 경고 |\n|---|---|---|---|---|---|---|---|---|---|---|---|\n"
    out = f"**{title}**\n\n" + h
    names = {"ALL": "전체", "lt6": "<6", "6_12": "6–12", "12_20": "12–20", "gt20": ">20"}
    for r in rows:
        nm = names[r["stratum"]]
        if r.get("n_win", 0) == 0:
            out += f"| {nm} | 0 | 0 | – | – | – | – | – | – | – | – | 표본 없음 |\n"
            continue
        ci = r.get("ci", {})
        c = lambda k, nd=2: (f" [{fmt(ci[k][0], nd)}, {fmt(ci[k][1], nd)}]" if k in ci else "")
        warn = ""
        if r["n_rec"] < 3:
            warn = "표본 부족 — 해석 불가"
        elif r["n_rec"] < 10:
            warn = "CI 넓음 — 해석 주의"
        loa = f"{fmt(r.get('loa_lo'))}~{fmt(r.get('loa_hi'))}" if "loa_lo" in r else "–"
        out += (
            f"| {nm} | {r['n_rec']} | {r['n_win']} | {fmt(r['coverage'] * 100, 1)}%{c('coverage', 3)} | {fmt(r.get('mae'))}{c('mae')} | {fmt(r['mae_pen'])}{c('mae_pen')} | "
            f"{fmt(r.get('median_ae'))} | {fmt(r.get('p95_ae'))} | {fmt(r.get('bias'))}{c('bias')} | {loa} | {fmt(r['cp2'] * 100, 1) if 'cp2' in r else '–'}% | {warn} |\n"
        )
    return out + "\n"


def hrv_agg(hrv_rows, ds):
    d = [r for r in hrv_rows if r[0] == ds]
    res = {}
    if not d:
        return res
    ch = np.array([np.nan if r[4] is None else r[4] for r in d], float)
    th = np.array([np.nan if r[3] is None else r[3] for r in d], float)
    defined = np.isfinite(th)
    res["hr"] = {"n_truth": int(defined.sum()), "coverage": float(np.isfinite(ch[defined]).mean()) if defined.any() else NAN, **bias_loa(ch, th)}
    for name, ti, ci in (("sdnn", 5, 6), ("rmssd", 7, 8)):
        tv = np.array([np.nan if r[ti] is None else r[ti] for r in d], float)
        cv = np.array([np.nan if r[ci] is None else r[ci] for r in d], float)
        defd = np.isfinite(tv)
        ok = defd & np.isfinite(cv)
        rel = (cv[ok] - tv[ok]) / tv[ok] if ok.any() else np.array([])
        res[name] = {
            "n_truth": int(defd.sum()),
            "coverage": float(np.isfinite(cv[defd]).mean()) if defd.any() else NAN,
            "truth_mean": float(tv[ok].mean()) if ok.any() else NAN,
            "core_mean": float(cv[ok].mean()) if ok.any() else NAN,
            "rel_bias": float(rel.mean()) if len(rel) else NAN,
            **bias_loa(cv, tv),
        }
    return res
