"""4단계 홀드아웃 1회 평가 실행기 (verify-addendum-10). 후보 3개(C0=V0 거울, W4a, W2a)를 동시에 1회만 잰다.

- 호출 경로는 cli `run-holdout --unlock-token <승인 파일 sha256> --confirm-single-run` 하나뿐이다.
- 해제 검증(guard.unlock) 통과 후에만 열리고, 실행 기록(run-record.json)을 *처리 시작 전에* 쓴다 → 중간에 죽어도 재실행 불가.
- 결과를 본 뒤 고치지 않는다. 버그는 그대로 보고한다.
"""
from __future__ import annotations

import json
import os
import time
from typing import Optional

import numpy as np

from . import ablation, ablation2, guard
from .ablation import EXPERIMENTS_PATH, cell_summary, equivalence, judge, load_registry, paired_bootstrap, rec_vec, totals_stats
from .ablation2 import (
    build_groups,
    gate_front,
    gate_hrv,
    hrv_table,
    paired_ci,
    process_record2,
    resp_family,
)
from .common import PRIMARY_L, SCORE_HOP_S, canon_json, sha256_file
from .report import fmt, rows_to_csv
from .splits import check_leakage, load_splits
from .truth import truth_for_record
from .variants2 import split_params

DS_HOLD = ("marsh", "capnobase")
BASE_ID = "V0"
LABEL = {"V0": "C0", "W4a": "W4a", "W2a": "W2a"}
REPORT_STRATA = (("lt6", "<6", 0.0, 6.0), ("6_8", "6–8", 6.0, 8.0), ("8_10", "8–10", 8.0, 10.0), ("10_12", "10–12", 10.0, 12.0), ("12_20", "12–20", 12.0, 20.0), ("gt20", ">20", 20.0, 1e9))
SENS_L = (30, 120)
NAN = float("nan")


def holdout_variants(reg: dict) -> list:
    h = reg["phase4_holdout"]
    base = reg["baseline"]
    out = [(base["id"], dict(base["params"]), {"judged": False, "name": "C0 (V0 mirror)"})]
    for c in h["candidates"]:
        if c["id"] == "C0":
            continue
        out.append((c["id"], dict(c["params"]), c))
    for _i, p, _m in out:
        split_params(p)
    return out


def holdout_rids() -> list:
    s = load_splits()
    from .adapters.loaders import capnobase_ids

    return [("marsh", r) for r in s["holdout"]["marsh"]] + [("capnobase", r) for r in capnobase_ids()]


# ---------------------------------------------------------------- 층 (보고용 6층)

def _bin_of(v: float) -> Optional[str]:
    for key, _name, lo, hi in REPORT_STRATA:
        if lo <= v < hi:
            return key
    return None


def _arrays(recs: list, vid: str, stratum: str, windows_key: Optional[int] = None):
    out = []
    for r in recs:
        wins = r["windows"] if windows_key is None else r["windows_L"][windows_key]
        s = r["series"][vid]
        t, c = [], []
        for (_L, T, tv, _why) in wins:
            if tv is None:
                continue
            if stratum != "ALL" and _bin_of(tv) != stratum:
                continue
            t.append(tv)
            v = s[T - 1]
            c.append(v if v is not None else NAN)
        if t:
            out.append((f"{r['ds']}/{r['rid']}", np.asarray(t), np.asarray(c)))
    return out


def cell(recs: list, vid: str, stratum: str, base: str = BASE_ID, windows_key: Optional[int] = None, ci: bool = True) -> dict:
    a = _arrays(recs, vid, stratum, windows_key)
    if not a:
        return {"n_rec": 0, "n_win": 0}
    vv = np.array([rec_vec(x[1], x[2]) for x in a])
    tot = vv.sum(axis=0)
    st = totals_stats(tot)
    t_all = np.concatenate([x[1] for x in a])
    c_all = np.concatenate([x[2] for x in a])
    ok = np.isfinite(c_all)
    e = (c_all - t_all)[ok]
    out = {"n_rec": len(a), "n_win": int(tot[0]), "n_valid": int(tot[1]), **st, "median_ae": float(np.median(np.abs(e))) if ok.any() else NAN}
    if ci and vid != base and len(a) >= 3:
        b = _arrays(recs, base, stratum, windows_key)
        vb = np.array([rec_vec(x[1], x[2]) for x in b])
        pb = paired_bootstrap(vv, vb)
        bt = totals_stats(vb.sum(axis=0))
        out["base_mae"], out["base_coverage"], out["base_bias"] = bt["mae"], bt["coverage"], bt["bias"]
        out["d_mae"] = st["mae"] - bt["mae"]
        out["d_mae_ci"] = pb["diff"]["mae"]
        out["d_mae_pen"] = st["mae_pen"] - bt["mae_pen"]
        out["d_mae_pen_ci"] = pb["diff"]["mae_pen"]
        out["d_cov"] = st["coverage"] - bt["coverage"]
    elif vid == base:
        out["base_mae"], out["base_coverage"], out["base_bias"] = st["mae"], st["coverage"], st["bias"]
    return out


def scopes(recs: list) -> dict:
    return {
        "pooled": recs,
        "marsh_holdout": [r for r in recs if r["ds"] == "marsh"],
        "capnobase": [r for r in recs if r["ds"] == "capnobase"],
        "capnobase_adult": [r for r in recs if r["ds"] == "capnobase" and r["age_group"] == "adult"],
        "capnobase_pediatric": [r for r in recs if r["ds"] == "capnobase" and r["age_group"] == "pediatric"],
        "capnobase_unknown_age": [r for r in recs if r["ds"] == "capnobase" and r["age_group"] == "unknown"],
    }


# ---------------------------------------------------------------- 기록 처리

def process_holdout_record(rec, vlist, groups, v2g) -> dict:
    r = process_record2(rec, vlist, groups, v2g)
    r["age_group"] = rec.meta.get("age_group", "")
    dur = r["dur"]
    r["windows_L"] = {}
    for L in SENS_L:
        w = []
        for T in range(L, dur + 1, SCORE_HOP_S):
            tv, why = truth_for_record(rec, float(L), float(T))
            w.append((L, T, tv, why))
        r["windows_L"][L] = w
    r["meta"] = {k: (None if (isinstance(v, float) and v != v) else v) for k, v in rec.meta.items()}
    return r


# ---------------------------------------------------------------- 리포트

def _ci(c, nd=2):
    return f" [{fmt(c[0], nd)}, {fmt(c[1], nd)}]" if c and c[0] == c[0] else ""


def resp_scope_table(recs_by_scope: dict, cand_ids: list, stratum: str = "ALL", windows_key: Optional[int] = None) -> str:
    md = "| 범위 | 후보 | 기록 n | 창 n | coverage | MAE | bias | MAE_pen | ΔMAE [쌍체 95% CI] | ΔMAE_pen [CI] | Δcov(%p) |\n|---|---|---|---|---|---|---|---|---|---|---|\n"
    for sc, rs in recs_by_scope.items():
        for vid in [BASE_ID] + cand_ids:
            c = cell(rs, vid, stratum, windows_key=windows_key)
            if c["n_win"] == 0:
                md += f"| {sc} | {LABEL[vid]} | 0 | 0 | – | – | – | – | – | – | – |\n"
                continue
            if vid == BASE_ID:
                md += f"| {sc} | {LABEL[vid]} | {c['n_rec']} | {c['n_win']} | {fmt(c['coverage'] * 100, 1)}% | {fmt(c['mae'])} | {fmt(c['bias'])} | {fmt(c['mae_pen'])} | – | – | – |\n"
            else:
                md += (
                    f"| {sc} | {LABEL[vid]} | {c['n_rec']} | {c['n_win']} | {fmt(c['coverage'] * 100, 1)}% | {fmt(c['mae'])} | {fmt(c['bias'])} | {fmt(c['mae_pen'])} | "
                    f"{fmt(c.get('d_mae'))}{_ci(c.get('d_mae_ci'))} | {fmt(c.get('d_mae_pen'))}{_ci(c.get('d_mae_pen_ci'))} | {fmt(c.get('d_cov', NAN) * 100, 2)} |\n"
                )
    return md


def strata_table(rs: list, cand_ids: list, scope: str) -> str:
    md = f"\n### 층별 — {scope} (참값 회/분; n_rec<3 표본 부족, <10 해석불가)\n\n| 층 | 후보 | 기록 n | 창 n | coverage | MAE | bias | ΔMAE [쌍체 CI] | 경고 |\n|---|---|---|---|---|---|---|---|---|\n"
    for key, name, _lo, _hi in REPORT_STRATA:
        for vid in [BASE_ID] + cand_ids:
            c = cell(rs, vid, key)
            if c["n_win"] == 0:
                if vid == BASE_ID:
                    md += f"| {name} | – | 0 | 0 | – | – | – | – | 표본 없음 |\n"
                continue
            warn = "표본 부족 — 해석 불가" if c["n_rec"] < 3 else ("해석불가(n_rec<10)" if c["n_rec"] < 10 else "")
            d = "–" if vid == BASE_ID else f"{fmt(c.get('d_mae'))}{_ci(c.get('d_mae_ci'))}"
            md += f"| {name} | {LABEL[vid]} | {c['n_rec']} | {c['n_win']} | {fmt(c['coverage'] * 100, 1)}% | {fmt(c['mae'])} | {fmt(c['bias'])} | {d} | {warn} |\n"
    return md


def hrv_md(tab: dict, cand_ids: list) -> str:
    md = "\n## HRV·박동 (신뢰 ECG 기록만; HR_rr=60000/AVNN; 참값=ECG; 판정 아님)\n\n| 범위 | 지표 | 후보 | 기록 n | coverage | MAE | bias | 상대 bias | ΔMAE [쌍체 CI] | Δbias [쌍체 CI] |\n|---|---|---|---|---|---|---|---|---|---|\n"
    for scope in ("pooled", "marsh", "capnobase"):
        for metric, lab in (("hr", "HR_rr(bpm)"), ("sdnn", "SDNN(ms)"), ("rmssd", "RMSSD(ms)")):
            for vid in [BASE_ID] + cand_ids:
                c = tab.get(vid, {}).get(scope, {}).get(metric, {})
                if "mae" not in c:
                    md += f"| {scope} | {lab} | {LABEL[vid]} | {c.get('n_rec', 0)} | – | – | – | – | – | – |\n"
                    continue
                dm, db = c.get("d_mae"), c.get("d_bias")
                md += (
                    f"| {scope} | {lab} | {LABEL[vid]} | {c['n_rec']} | {fmt(c['coverage'] * 100, 1)}% | {fmt(c['mae'])} | {fmt(c['bias'])} | {fmt(c['rel_bias'] * 100, 1)}% | "
                    f"{(fmt(dm['diff']) + _ci(dm['ci'])) if dm else '–'} | {(fmt(db['diff']) + _ci(db['ci'])) if db else '–'} |\n"
                )
    md += "\n| 범위 | 후보 | 기록 n | 숙성 박동 F1 | ΔF1 [쌍체 CI] |\n|---|---|---|---|---|\n"
    for scope in ("pooled", "marsh", "capnobase"):
        for vid in [BASE_ID] + cand_ids:
            f = tab.get(vid, {}).get(scope, {}).get("f1", {})
            if "f1" not in f:
                md += f"| {scope} | {LABEL[vid]} | {f.get('n_rec', 0)} | – | – |\n"
                continue
            d = f.get("d_f1")
            md += f"| {scope} | {LABEL[vid]} | {f['n_rec']} | {fmt(f['f1'], 3)} | {(fmt(d['diff'], 3) + _ci(d['ci'], 3)) if d else '–'} |\n"
    return md


def build_report(recs, vlist, cand_ids, eq, eqh, eqf, judgements, fam, hrv_tab, run_info) -> str:
    sc = scopes(recs)
    md = "# 홀드아웃 1회 평가 결과 (SDD-317 4단계, 원자료 표)\n\n"
    md += f"- 사전등록: `verify-addendum-10.md` + `experiments.json`(`phase4_holdout`). 동결 SHA `{run_info['frozen_sha']}`, 실행 시 HEAD `{run_info['head']}`.\n"
    md += "- 후보 3개(C0=V0 거울, W4a, W2a)를 동시에 1회 평가. **결과를 본 뒤 알고리즘·임계·후보를 바꾸지 않았다.** 해석은 `holdout-summary.md`.\n"
    md += f"- 기록: MARSH 홀드아웃 {len(sc['marsh_holdout'])} + CapnoBase {len(sc['capnobase'])} (성인 {len(sc['capnobase_adult'])} / 소아 {len(sc['capnobase_pediatric'])} / 나이 미기재 {len(sc['capnobase_unknown_age'])}).\n"
    md += "- 데이터 출처 표기: CapnoBase — Karlen W, Raman S, Ansermino JM, Dumont GA. *Multiparameter respiratory rate estimation from the photoplethysmogram.* IEEE Trans Biomed Eng 2013;60(7):1946–53. DOI 10.1109/TBME.2013.2246160 (연구용 자유 사용, 재식별 금지). MARSH — 공개 데이터셋(1단계 분할 그대로).\n"
    md += "- 공개 PPG는 손가락/귀 등이며 LINK BAND 이마 반사형이 아니다. 소아 28건 포함. 결과는 관찰이며 인과 단정·정확도 보증이 아니다.\n\n"
    md += "## 0. 게이트 (홀드아웃 기록 전체)\n\n"
    md += f"- G-resp(C0 거울 == 코어): 프레임 {eq['frames']} 중 불일치 {eq['mismatch_frames']} ({fmt(100 * eq['mismatch_fraction'], 4)}%), 기록별 최악 {fmt(100 * eq['worst_record_fraction'], 3)}%, 최대 |Δ| {eq['max_abs_diff_both_valid']:.3g} → **{'통과' if eq['pass'] else '실패'}**\n"
    md += f"- G-hrv(C0 SDNN·RMSSD == 코어): 불일치 {eqh['mismatch_frames']}/{eqh['frames']} ({fmt(100 * eqh['mismatch_fraction'], 4)}%), 기록별 최악 {fmt(100 * eqh['worst_record_fraction'], 3)}% → **{'통과' if eqh['pass'] else '실패'}**\n"
    md += f"- (참고) 전단 거울 불일치 {eqf['mismatch_frames']}/{eqf['frames']} — 이번 후보는 코어 RR 을 쓰므로 판정 무관.\n"
    if not eq["pass"]:
        md += "- **G-resp 실패: 아래 모든 수치는 해석 불가로 표시한다(수정·재실행하지 않음).**\n"
    md += "\n## 1. 판정 (풀링 56건, addendum-8 A8-4 규칙 그대로; 후보 2개 중 개선 n건)\n\n| 후보 | 판정 | 풀링 ΔMAE [쌍체 95% CI] | Bonferroni CI | p(raw) | p(Holm, m=2) | ΔMAE_pen [CI] | Δcoverage(%p) | 미달 항목 |\n|---|---|---|---|---|---|---|---|---|\n"
    b_all = cell_summary(recs, BASE_ID, None, "ALL")
    for vid in cand_ids:
        j = judgements[vid]
        sv = cell_summary(recs, vid, None, "ALL", with_ci_against=BASE_ID)
        ci = sv["ci"]
        f = fam[vid]
        md += (
            f"| {LABEL[vid]} | {j['label']} | {fmt(sv['mae'] - b_all['mae'])}{_ci(ci['diff']['mae'])} | {_ci(f['ci_bonf'])} | {fmt(f['p_raw'], 4)} | {fmt(f['p_holm'], 4)} | "
            f"{fmt(sv['mae_pen'] - b_all['mae_pen'])}{_ci(ci['diff']['mae_pen'])} | {fmt((sv['coverage'] - b_all['coverage']) * 100, 2)} | {', '.join(j['misses']) or '–'} |\n"
        )
    md += "\n판정 층 칸(n_rec≥10만 판정, 점추정 ΔMAE≤0):\n\n| 후보 | 데이터셋 | 층 | 기록 n | 상태 | ΔMAE |\n|---|---|---|---|---|---|\n"
    for vid in cand_ids:
        for c in judgements[vid]["cells"]:
            md += f"| {LABEL[vid]} | {c['ds']} | {c['stratum']} | {c['n_rec']} | {c['status']} | {fmt(c.get('d_mae'))} |\n"
    md += "\n## 2. 호흡수 — 범위별 (창 L=60s 주 결과, 전체 채점창)\n\n" + resp_scope_table(sc, cand_ids)
    md += "\n## 3. 층별 보고 (6층; 판정 층과 별개 보고용)\n"
    for name in ("pooled", "marsh_holdout", "capnobase", "capnobase_adult", "capnobase_pediatric"):
        md += strata_table(sc[name], cand_ids, name)
    for L in SENS_L:
        md += f"\n## 4-{L}. 민감도: 참값 창 길이 L={L}s (코어 출력은 동일, 채점창만 변경)\n\n" + resp_scope_table({k: sc[k] for k in ("pooled", "marsh_holdout", "capnobase")}, cand_ids, windows_key=L)
    md += hrv_md(hrv_tab, cand_ids) if hrv_tab else "\n## HRV: G-hrv 실패로 미생성\n"
    return md


# ---------------------------------------------------------------- 실행

def _write(path: str, txt: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(txt)


def run_holdout(token: Optional[str], out_dir: str = guard.HOLDOUT_DIR) -> dict:
    from .adapters.loaders import load_record
    from .core_runner import build, core_provenance

    info = guard.unlock(token)  # 실패하면 HoldoutLocked (아무 데이터도 열지 않음)
    os.makedirs(out_dir, exist_ok=True)
    guard.ACCESS_LOG = os.path.join(out_dir, "access-log-holdout.jsonl")
    t0 = int(time.time())
    record = {"status": "started", "started_unix": t0, "frozen_sha": info["frozen_sha"], "head": info["head"], "approval_sha256": info["approval_sha256"], "candidates": guard.CANDIDATES}
    _write(guard.RUN_RECORD, canon_json(record) + "\n")  # 처리 전에 기록 → 재실행 거부 보장
    ablation.DS_ORDER = DS_HOLD
    ablation2.DS_ORDER = DS_HOLD
    reg = load_registry(EXPERIMENTS_PATH)
    vlist = holdout_variants(reg)
    groups, v2g = build_groups(vlist)
    s = load_splits()
    bad = check_leakage(s)
    if bad:
        raise SystemExit(f"분할 누수: {bad}")
    prov = core_provenance()
    build()
    recs = []
    for ds, rid in holdout_rids():
        rec = load_record(ds, rid)
        recs.append(process_holdout_record(rec, vlist, groups, v2g))
    cand_ids = [v[0] for v in vlist[1:]]
    eq = equivalence(recs, BASE_ID)
    eqf = gate_front(recs)
    eqh = gate_hrv(recs)
    judgements = {vid: judge(recs, vid, BASE_ID) for vid in cand_ids}
    fam = resp_family(recs, cand_ids, BASE_ID)
    hrv_tab = hrv_table(recs, [BASE_ID] + cand_ids, BASE_ID) if eqh["pass"] else {}
    ri = {"frozen_sha": info["frozen_sha"], "head": info["head"]}
    files = {
        "equivalence-resp.json": canon_json(eq) + "\n",
        "equivalence-front.json": canon_json(eqf) + "\n",
        "equivalence-hrv.json": canon_json(eqh) + "\n",
        "judgements.json": canon_json({k: {kk: vv for kk, vv in v.items() if kk not in ("pooled", "pooled_base")} for k, v in judgements.items()}) + "\n",
        "family-holm.json": canon_json(fam) + "\n",
    }
    ids_all = [v[0] for v in vlist]
    body = []
    for r in recs:
        for (L, T, tv, why) in r["windows"]:
            body.append([r["ds"], r["rid"], r["age_group"], L, T, tv, why, r["core"][T - 1]] + [r["series"][v][T - 1] for v in ids_all])
        for L in SENS_L:
            for (_L, T, tv, why) in r["windows_L"][L]:
                body.append([r["ds"], r["rid"], r["age_group"], L, T, tv, why, r["core"][T - 1]] + [r["series"][v][T - 1] for v in ids_all])
    files["resp-windows-holdout.csv"] = rows_to_csv(["ds", "rid", "age_group", "L", "T", "truth", "truth_status", "core_C0"] + ids_all, body)
    hb = []
    for r in recs:
        for vid, rows in r["hrv_rows"].items():
            for (T, th, ts_, tr_, hv, sv, rv) in rows:
                hb.append([r["ds"], r["rid"], vid, T, th, ts_, tr_, hv, sv, rv])
    files["hrv-windows-holdout.csv"] = rows_to_csv(["ds", "rid", "variant", "T", "truth_hr", "truth_sdnn", "truth_rmssd", "hr_rr", "sdnn", "rmssd"], hb)
    files["records-holdout.json"] = canon_json([{"ds": r["ds"], "rid": r["rid"], "age_group": r["age_group"], "dur": r["dur"], "meta": r["meta"]} for r in recs]) + "\n"
    agg = {}
    for sc_name, rs in scopes(recs).items():
        agg[sc_name] = {}
        for key in ["ALL"] + [k for k, *_ in REPORT_STRATA]:
            agg[sc_name][key] = {LABEL[v]: cell(rs, v, key) for v in ids_all}
        for L in SENS_L:
            agg[sc_name][f"ALL_L{L}"] = {LABEL[v]: cell(rs, v, "ALL", windows_key=L) for v in ids_all}
    files["aggregate.json"] = canon_json(agg) + "\n"
    files["holdout-report.md"] = build_report(recs, vlist, cand_ids, eq, eqh, eqf, judgements, fam, hrv_tab, ri)
    for name, txt in files.items():
        _write(os.path.join(out_dir, name), txt)
    hashes = "".join(f"{sha256_file(os.path.join(out_dir, n))}  {n}\n" for n in sorted(files)) + f"{sha256_file(guard.ACCESS_LOG)}  access-log-holdout.jsonl\n"
    _write(os.path.join(out_dir, "sha256.txt"), hashes)
    record.update({"status": "done", "finished_unix": int(time.time()), "n_records": len(recs), "core_src_tree": prov["core_src_tree"], "g_resp": eq["pass"], "g_hrv": eqh["pass"], "labels": {LABEL[k]: v["label"] for k, v in judgements.items()}})
    _write(guard.RUN_RECORD, canon_json(record) + "\n")
    return record
