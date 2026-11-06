"""CLI: `python -m ppg_eval.cli run-dev [--out DIR]`, `run-holdout` (잠금 — 이번 SDD 에서는 항상 거부)."""
from __future__ import annotations

import argparse
import json
import os
import sys

import numpy as np

from .common import PRIMARY_L, RESULTS, TOOL_DIR, canon_json, sha256_file
from .core_runner import build, core_provenance
from .evaluate import process_record
from .adapters.loaders import load_record
from .report import fmt, hrv_agg, md_resp_table, resp_table, rows_to_csv
from .splits import SPLITS_PATH, check_leakage, load_splits

DEV_ORDER = ["bidmc", "marsh", "mimic_nonaf", "mimic_af", "dalia"]
RESP_DS = ["bidmc", "marsh"]
HRV_DS = ["bidmc", "marsh", "mimic_nonaf", "mimic_af", "dalia"]


def run_dev(out: str) -> dict:
    s = load_splits()
    bad = check_leakage(s)
    if bad:
        raise SystemExit(f"분할 누수: {bad}")
    prov = core_provenance()
    build()
    os.makedirs(out, exist_ok=True)
    summaries, resp_rows, hrv_rows = [], [], []
    for ds in DEV_ORDER:
        for rid in s["dev"][ds]:
            rec = load_record(ds, rid)
            sm, rr, hh = process_record(rec, keep_pkts=False)
            summaries.append(sm)
            resp_rows += rr
            hrv_rows += hh
    # 파일
    files = {}
    files["records.csv"] = rows_to_csv(
        ["ds", "rid", "fs", "duration_s", "flipped", "gain", "first_resp_delay_s", "jumps", "jump_pairs", "ref_beats", "n_truth_beats", "n_core_beats", "beat_lag_s", "beat_lag_range_s", "beat_precision", "beat_recall", "beat_f1", "ppi_err_mean_ms", "ppi_err_sd_ms", "ppi_err_mae_ms", "shadow_mismatch_frames", "resp_calc_frames", "h1_removed_ratio_mean", "h1_time_ratio_mean", "h2_nan_seg_frame_frac", "h2_nan_seg_frac", "reseeds", "uint24_clipped", "ecg_truth_reliable", "rpeak_f1", "nan_frac"],
        [[sm[k] for k in ["ds", "rid", "fs", "duration_s", "flipped", "gain", "first_resp_delay_s", "jumps", "jump_pairs", "ref_beats", "n_truth_beats", "n_core_beats", "beat_lag_s", "beat_lag_range_s", "beat_precision", "beat_recall", "beat_f1", "ppi_err_mean_ms", "ppi_err_sd_ms", "ppi_err_mae_ms", "shadow_mismatch_frames", "resp_calc_frames", "h1_removed_ratio_mean", "h1_time_ratio_mean", "h2_nan_seg_frame_frac", "h2_nan_seg_frac", "reseeds", "uint24_clipped", "ecg_truth_reliable", "rpeak_f1", "nan_frac"]] for sm in summaries],
    )
    files["resp-windows.csv"] = rows_to_csv(["ds", "rid", "L", "T", "truth", "truth_status", "core", "core_reason", "rr_buf"], resp_rows)
    files["hrv-windows.csv"] = rows_to_csv(["ds", "rid", "T", "truth_hr", "core_hr", "truth_sdnn", "core_sdnn", "truth_rmssd", "core_rmssd"], hrv_rows)
    agg = {"resp": {}, "hrv": {}, "h3": {}}
    for ds in RESP_DS:
        for L in (30, 60, 120):
            agg["resp"][f"{ds}_L{L}"] = resp_table(resp_rows, ds, L)
        agg["resp"][f"{ds}_L60_T120"] = resp_table(resp_rows, ds, 60, 120)
        defd = [(r[4]) for r in resp_rows if r[0] == ds and r[2] == 60 and r[4] is not None]
        defd120 = [(r[4]) for r in resp_rows if r[0] == ds and r[2] == 60 and r[4] is not None and r[3] >= 120]
        out_band = lambda v: sum(1 for x in v if x < 9.0 or x > 24.0)
        agg["h3"][ds] = {"all": (out_band(defd) / len(defd)) if defd else None, "T120": (out_band(defd120) / len(defd120)) if defd120 else None, "n_all": len(defd), "n_T120": len(defd120)}
    rel = {x["rid"] for x in summaries if x["ds"] == "marsh" and x["ecg_truth_reliable"]}
    rel_b = {x["rid"] for x in summaries if x["ds"] == "bidmc" and x["ecg_truth_reliable"]}
    for ds in HRV_DS:
        agg["hrv"][ds] = hrv_agg(hrv_rows, ds)
    agg["hrv"]["marsh_reliable"] = hrv_agg(hrv_rows, "marsh", rel)
    agg["hrv"]["bidmc_reliable"] = hrv_agg(hrv_rows, "bidmc", rel_b)
    files["aggregate.json"] = canon_json({k: v for k, v in agg.items()}) + "\n"
    # R-peak 검출기 품질(MARSH dev)
    from .rpeak_quality import marsh_detector_quality

    q = marsh_detector_quality(s["dev"]["marsh"])
    files["rpeak-detector-quality.json"] = canon_json(q) + "\n"
    md = build_baseline_md(summaries, agg, q, prov, s)
    files["baseline-c0.md"] = md
    meta = {"core": {"core_src_tree": prov["core_src_tree"], "core_clean": True}, "splits_sha256": sha256_file(SPLITS_PATH), "convert": "resample_poly-kaiser5.0-v1", "n_records": len(summaries), "holdout_opened": False}
    files["run-meta.json"] = canon_json(meta) + "\n"
    files["provenance.json"] = canon_json({"repo_head": prov["repo_head"]}) + "\n"  # 커밋마다 달라지므로 재현성 해시 비교 대상 제외
    for name, txt in files.items():
        with open(os.path.join(out, name), "w", encoding="utf-8", newline="\n") as f:
            f.write(txt)
    return meta


def build_baseline_md(summaries, agg, q, prov, s) -> str:
    from .common import PRIMARY_L

    md = f"# C0 기준선 — 현재 코어(변경 없음), 개발 세트만\n\n- 코어 src 트리: `{prov['core_src_tree']}` / 저장소 HEAD: `{prov['repo_head']}` (코어 src 깨끗함)\n- 변환: `resample_poly-kaiser5.0-v1`, 분할 규칙: verify.md V1 (홀드아웃 열지 않음)\n- 공개 PPG는 손가락/귀/손목(투과·임상)이며 이마 반사형이 아니다. 아래 수치는 LINK BAND 정확도가 아니라 **같은 코어를 공개 라벨 데이터에 먹인 기준선**이다.\n\n"
    md += f"## 1. 호흡수 (창 L={PRIMARY_L}s, 채점 hop 10s)\n\n"
    for ds, nm in (("bidmc", "BIDMC (53명, 수기 호흡 이벤트 2인)"), ("marsh", "MARSH dev (15명, 임피던스 정점)")):
        md += md_resp_table(agg["resp"][f"{ds}_L60"], f"{nm} — 전체 채점창")
        md += md_resp_table(agg["resp"][f"{ds}_L60_T120"], f"{nm} — T≥120s 창만(워밍업 제외 참고, 보조)")
        for L in (30, 120):
            r = agg["resp"][f"{ds}_L{L}"][0]
            md += f"- 민감도 L={L}s: n_win={r.get('n_win', 0)}, coverage={fmt(r.get('coverage', float('nan')) * 100 if r.get('n_win') else None, 1)}%, MAE={fmt(r.get('mae'))}, bias={fmt(r.get('bias'))}\n"
        md += "\n"
    # 지연·점프
    md += "## 2. 첫 유효값 지연 · 1초 점프\n\n| 데이터셋 | 기록 n | 첫 유효값 지연 중앙/최소/최대(s) | 1초 점프>4회/분 비율 |\n|---|---|---|---|\n"
    for ds in ("bidmc", "marsh"):
        rs = [x for x in summaries if x["ds"] == ds]
        d = [x["first_resp_delay_s"] for x in rs if x["first_resp_delay_s"] is not None]
        j = sum(x["jumps"] for x in rs)
        p = sum(x["jump_pairs"] for x in rs)
        md += f"| {ds} | {len(rs)} | {np.median(d):.0f} / {min(d)} / {max(d)} (값 없음 기록 {len(rs) - len(d)}) | {j}/{p} = {fmt(100 * j / p, 2) if p else '–'}% |\n"
    md += "\n## 3. 박동 검출·PPI (±100ms 1:1, 30초 블록별 지연 보정)\n\n"
    md += "| 데이터셋 | 기록 n | 참 박동 기준 | precision | recall | F1 | PPI 오차 SD(ms) 기록 중앙 | PPI |오차| 평균(ms) | 블록 지연 범위 중앙(s) |\n|---|---|---|---|---|---|---|---|---|---|\n"
    groups = [(ds, ds, [x for x in summaries if x["ds"] == ds]) for ds in HRV_DS]
    groups.insert(1, ("bidmc", "bidmc (ECG≈모니터HR 기록만, A7-1)", [x for x in summaries if x["ds"] == "bidmc" and x["ecg_truth_reliable"]]))
    groups.insert(3, ("marsh", "marsh (ECG 주석 신뢰 기록만)", [x for x in summaries if x["ds"] == "marsh" and x["ecg_truth_reliable"]]))
    for ds, label, rs in groups:
        if not rs:
            continue
        tp = lambda k: float(np.nanmedian([x[k] for x in rs]))
        tot_c = sum(x["n_core_beats"] for x in rs)
        tot_t = sum(x["n_truth_beats"] for x in rs)
        # 풀링 P/R: TP = P*n_core
        tp_sum = sum((x["beat_precision"] if x["beat_precision"] == x["beat_precision"] else 0) * x["n_core_beats"] for x in rs)
        p = tp_sum / tot_c if tot_c else float("nan")
        r = tp_sum / tot_t if tot_t else float("nan")
        f = 2 * p * r / (p + r) if (p + r) > 0 else float("nan")
        md += f"| {label} | {len(rs)} | {rs[0]['ref_beats']} | {fmt(p, 3)} | {fmt(r, 3)} | {fmt(f, 3)} | {fmt(tp('ppi_err_sd_ms'), 1)} | {fmt(tp('ppi_err_mae_ms'), 1)} | {fmt(tp('beat_lag_range_s'), 2)} |\n"
    md += "\n- 기록별 F1 하위 5건(진단용):\n"
    worst = sorted(summaries, key=lambda x: (x["beat_f1"] if x["beat_f1"] == x["beat_f1"] else 9))[:5]
    for x in worst:
        md += f"  - {x['ds']}/{x['rid']}: F1={fmt(x['beat_f1'], 3)}, 지연범위={fmt(x['beat_lag_range_s'], 2)}s\n"
    md += "\n## 4. HR · SDNN · RMSSD (T=30,40,… 채점창; 코어 표시값 vs ECG 참값)\n\n"
    md += "| 데이터셋 | 지표 | 참값 정의 창 n | coverage | bias(코어−참) | LoA | MAE | 상대 편향 |\n|---|---|---|---|---|---|---|---|\n"
    for ds in ["bidmc", "bidmc_reliable", "marsh", "marsh_reliable", "mimic_nonaf", "mimic_af", "dalia"]:
        a = agg["hrv"].get(ds, {})
        for nm, unit in (("hr", "bpm"), ("sdnn", "ms"), ("rmssd", "ms")):
            v = a.get(nm)
            if not v:
                continue
            loa = f"{fmt(v.get('loa_lo'), 1)}~{fmt(v.get('loa_hi'), 1)}" if "loa_lo" in v else "–"
            rel = fmt(v.get("rel_bias", float("nan")) * 100, 1) + "%" if "rel_bias" in v and v["rel_bias"] == v["rel_bias"] else "–"
            dlabel = {"marsh_reliable": "marsh (신뢰 기록만)", "bidmc_reliable": "bidmc (신뢰 기록만)"}.get(ds, ds)
            md += f"| {dlabel} | {nm} ({unit}) | {v['n_truth']} | {fmt(v['coverage'] * 100, 1)}% | {fmt(v.get('bias'), 2)} | {loa} | {fmt(v.get('mae'), 2)} | {rel} |\n"
    md += "\n- 주의: ECG 기반 HRV 와 PPG 기반 PRV 는 같은 양이 아니다. 아래 편향은 '코어 PRV – ECG HRV' 차이이며 정확도 결론이 아니다.\n"
    md += "\n## 5. 가설 3종 (코어 수정 없이 측정)\n\n"
    rs = [x for x in summaries if x["ds"] in ("bidmc", "marsh")]
    mism = sum(x["shadow_mismatch_frames"] for x in summaries)
    frames = sum(x["shadow_frames"] for x in summaries)
    md += f"- 신뢰성 점검(H9): 거울 구현의 RR 버퍼 길이가 코어 `rr_buffer_len` 과 불일치한 프레임 {mism}/{frames} ({fmt(100 * mism / frames, 3)}%).\n\n"
    md += "| 데이터셋 | H1 정제 제거 RR 비율(호흡 계산 프레임 평균) | H1 시간 압축(버퍼합/시각차) | H2 NaN 포함 Welch 구간 비율 | H2 NaN 구간이 있는 호흡 계산 프레임 비율 | H3 참값이 9–24 밖인 창(전체 / T≥120) |\n|---|---|---|---|---|---|\n"
    for ds in ("bidmc", "marsh"):
        r = [x for x in summaries if x["ds"] == ds]
        m = lambda k: float(np.nanmean([x[k] for x in r]))
        h3 = agg["h3"][ds]
        md += f"| {ds} | {fmt(100 * m('h1_removed_ratio_mean'), 1)}% | {fmt(m('h1_time_ratio_mean'), 3)} | {fmt(100 * m('h2_nan_seg_frac'), 1)}% | {fmt(100 * m('h2_nan_seg_frame_frac'), 1)}% | {fmt(100 * h3['all'], 1)}% (n={h3['n_all']}) / {fmt(100 * h3['T120'], 1)}% (n={h3['n_T120']}) |\n"
    md += "\n- 해석 한계: 제거율·압축·NaN 은 '발생 빈도'이며 호흡 오차에 미치는 영향의 인과는 아니다(그것은 ablation A1·A2, 이 SDD 범위 밖). 영향 가늠용으로 `resp-windows.csv` 에 창별 코어값이 있다.\n"
    md += "\n## 6. R-peak 검출기(BIDMC·MIMIC 참 박동 생성용) 품질 — MARSH dev 수기 ECG 주석 대비\n\n"
    md += f"- 기록 n={q['n_rec']}, 상수 오프셋(주석−검출 중앙값) 기록별 보정 후 ±50ms F1 중앙={fmt(q['f1_median'], 4)}, 최소={fmt(q['f1_min'], 4)}, 풀링 F1={fmt(q['f1_pooled'], 4)}, 오프셋 중앙={fmt(q['offset_median_s'], 4)}s (범위 {fmt(q['offset_min_s'], 4)}~{fmt(q['offset_max_s'], 4)})\n"
    md += f"- F1<0.98 기록: {q['n_below_098']}건 → 이 검출기로 만든 BIDMC·MIMIC 참 박동 품질은 위 수준이 상한 근거다.\n"
    ex = [x["rid"] for x in summaries if x["ds"] == "marsh" and not x["ecg_truth_reliable"]]
    exb = [x["rid"] for x in summaries if x["ds"] == "bidmc" and not x["ecg_truth_reliable"]]
    md += f"- addendum-7 게이트(ECG 검출 HR vs 모니터 HR 차 >10%) 제외 BIDMC 기록: {', '.join(exb) if exb else '없음'} (MIMIC 은 모니터 HR 없음 → 게이트 미적용, 전 기록만 보고)\n"
    md += f"- addendum-6 게이트(F1<0.98) 제외 MARSH 기록: {', '.join(ex) if ex else '없음'} → 박동·HR·HRV '신뢰 기록만' 행에서 제외(호흡 층은 영향 없음, 전 기록 포함 행은 별도 유지).\n"
    nan_recs = [x for x in summaries if x["nan_frac"] > 0]
    nanr = ", ".join(f"{x['ds']}/{x['rid']}({100 * x['nan_frac']:.2f}%)" for x in nan_recs) or "없음"
    big = ", ".join(f"{x['ds']}/{x['rid']}" for x in nan_recs if x["nan_frac"] > 0.01) or "없음"
    md += f"- 입력 NaN 보간 기록(PPG 기준, addendum-6 A6-1): {nanr}; 1% 초과: {big}\n"
    md += "\n## 7. 정제 규칙 상세·한계\n\n- MIMIC PERform 은 호흡 이벤트가 없어 호흡 층에서 제외, PPG-DaLiA 는 호흡 파형만 있어 제외.\n- BIDMC·MIMIC 환자 중복 여부는 식별자가 없어 확인 불가.\n- 개발 세트 결과이며, 홀드아웃(MARSH 14명, CapnoBase 42건)은 열지 않았다.\n"
    return md


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="ppg_eval")
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run-dev")
    r.add_argument("--out", default=os.path.join(RESULTS, "dev"))
    h = sub.add_parser("run-holdout")
    h.add_argument("--unlock-token")
    h.add_argument("--confirm-single-run", action="store_true")
    a = ap.parse_args(argv)
    if a.cmd == "run-dev":
        print(json.dumps(run_dev(a.out), ensure_ascii=False, sort_keys=True))
        return 0
    if a.cmd == "run-holdout":
        from .guard import HoldoutLocked, require_open

        try:
            require_open("capnobase", "*")
        except HoldoutLocked as e:
            print(f"거부: {e}", file=sys.stderr)
            return 2
    return 2


if __name__ == "__main__":
    sys.exit(main())
