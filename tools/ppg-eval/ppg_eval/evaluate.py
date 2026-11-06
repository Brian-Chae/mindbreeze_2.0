"""기록 1건 처리: 변환 → 코어 → 참값·창별 행. 결과는 결정론적(실행 시각 없음)."""
from __future__ import annotations

import os

import numpy as np

from .common import PRIMARY_L, SCORE_HOP_S, WINDOWS_S, WORK, BEAT_TOL_S
from .convert import prepare
from .core_runner import run_core
from .metrics import prf
from .shadow import Shadow
from .truth import beat_match, detect_r_peaks, ecg_rr_series, truth_for_record, truth_hr_at, truth_hrv_at

NAN = float("nan")


def core_beats(rows) -> np.ndarray:
    """addendum-3 #2: emission 별 상대 인덱스로 박동 시각 복원, 0.3초 이내 중복은 처음 것 유지."""
    out = []
    for r in rows:
        for e in r["rr_end_ts"]:
            idx = (r["k"] + 1) * 50 - 1 - int(round((r["win_end_ts"] - e) / 20.0))
            t = idx / 50.0
            if not out or t > out[-1] + 0.3:
                out.append(t)
            elif t > out[-1]:
                pass
    # 중복 제거는 시간순 단조 가정. 비단조 후보는 정렬 후 재적용
    a = np.asarray(sorted(set(out)))
    keep = []
    for t in a:
        if not keep or t - keep[-1] > 0.3:
            keep.append(t)
    return np.asarray(keep)


LAG_GRID = np.round(np.arange(0.0, 1.5001, 0.01), 2)
BLOCK_S = 30.0


def block_beat_eval(core: np.ndarray, truth: np.ndarray, dur: float):
    """addendum-5: 30초 블록별 lag 선택 후 ±100ms 1:1 매칭. 반환 dict(tp, n_core, n_truth, lags, ppi_err)."""
    tp_all = nc_all = nt_all = 0
    lags, ppi = [], []
    a = 0.0
    while a < dur:
        c = core[(core >= a - 1.5) & (core < a + BLOCK_S + 1.5)]
        t_sel = truth[(truth >= a - 2.0) & (truth < a + BLOCK_S + 2.0)]
        t_in = truth[(truth >= a) & (truth < a + BLOCK_S)]
        c_in0 = core[(core >= a) & (core < a + BLOCK_S)]
        if len(c_in0) >= 3 and len(t_sel) >= 3:
            best_lg, best_tp = 0.0, -1
            for lg in LAG_GRID:
                tp, _ = beat_match(t_sel, c - lg, BEAT_TOL_S)
                if tp > best_tp:
                    best_lg, best_tp = float(lg), tp
            sh = c - best_lg
            sh_in = sh[(sh >= a) & (sh < a + BLOCK_S)]
            tp, prs = beat_match(t_in, sh_in, BEAT_TOL_S)
            tp_all += tp
            nc_all += len(sh_in)
            nt_all += len(t_in)
            lags.append(best_lg)
            for (i1, j1), (i2, j2) in zip(prs, prs[1:]):
                if i2 == i1 + 1 and j2 == j1 + 1:
                    ppi.append((sh_in[j2] - sh_in[j1]) * 1000.0 - (t_in[i2] - t_in[i1]) * 1000.0)
        a += BLOCK_S
    return {"tp": tp_all, "n_core": nc_all, "n_truth": nt_all, "lags": lags, "ppi": np.asarray(ppi)}


def process_record(rec, keep_pkts: bool = True):
    os.makedirs(WORK, exist_ok=True)
    pkts, info, ir, x50 = prepare(rec.ppg, rec.fs)
    path = os.path.join(WORK, f"{rec.ds}_{rec.rid}.pkts")
    with open(path, "wb") as f:
        f.write(pkts)
    rows = run_core(path)
    if not keep_pkts:
        os.remove(path)
    dur = len(rows)

    # 그림자(H1/H2/H9)
    sh = Shadow()
    mism = 0
    ratio_series = []
    nan_seg_frames = 0
    resp_frames = 0
    for r in rows:
        d = sh.step(r["rr"], r["rr_end_ts"], r["win_end_ts"])
        if d["buf_len"] != r["rr_buf"]:
            mism += 1
        if r["resp"] is not None or r["resp_reason"] not in ("no_ppg_data", "insufficient_rr_buffer"):
            pass
        if d["resp_computed"]:
            resp_frames += 1
            if d["segs_nan"] > 0:
                nan_seg_frames += 1
        ratio_series.append((d["removed_ratio"], d["time_ratio"], d["resp_computed"], d["segs"], d["segs_nan"], d["nan_pts"]))

    # 호흡 행
    resp_rows = []
    for L in WINDOWS_S:
        T = L
        while T <= dur:
            tv, why = truth_for_record(rec, float(L), float(T))
            r = rows[T - 1]
            resp_rows.append((rec.ds, rec.rid, L, T, tv, why, r["resp"], r["resp_reason"], r["rr_buf"]))
            T += SCORE_HOP_S

    # 호흡 연속성/지연
    resp_series = [r["resp"] for r in rows]
    first = next((i + 1 for i, v in enumerate(resp_series) if v is not None), None)
    jumps = pairs = 0
    for a, b in zip(resp_series, resp_series[1:]):
        if a is not None and b is not None:
            pairs += 1
            if abs(b - a) > 4.0:
                jumps += 1

    # 박동
    cb = core_beats(rows)
    if rec.beats_truth is not None:
        tb = rec.beats_truth
        ref_src = "annotated"
    else:
        tb = detect_r_peaks(rec.ecg, rec.ecg_fs) if rec.ecg is not None else np.array([])
        ref_src = "detected_ecg"
    tb = tb[tb < dur]
    be = block_beat_eval(cb, tb, float(dur))
    p, rcl, f1 = prf(be["tp"], be["n_truth"], be["n_core"])
    ppi_err = be["ppi"]
    lags = be["lags"]
    lag = float(np.median(lags)) if lags else NAN
    lag_range = (max(lags) - min(lags)) if lags else NAN
    tb_eval = tb  # n_truth_beats 보고용
    cbc = cb

    # HR / HRV
    hrv_rows = []
    hr_ok = rec.beats_truth is not None or rec.ecg is not None
    if hr_ok and len(tb) > 10:
        rr_t, end_t = ecg_rr_series(tb)
        T = 30
        while T <= dur:
            r = rows[T - 1]
            th = truth_hr_at(tb, float(T))
            ts, tr = truth_hrv_at(rr_t, end_t, float(T))
            hrv_rows.append((rec.ds, rec.rid, T, th, r["hr"], ts, r["sdnn"], tr, r["rmssd"]))
            T += SCORE_HOP_S

    # 정제 제거율 / 시간압축 (호흡 계산 가능 프레임만)
    rem = [x[0] for x in ratio_series if x[2] and x[0] is not None]
    tr_ = [x[1] for x in ratio_series if x[2] and x[1] is not None]
    summary = {
        "ds": rec.ds,
        "rid": rec.rid,
        "fs": rec.fs,
        "duration_s": dur,
        "flipped": info["flipped"],
        "gain": info["gain"],
        "uint24_clipped": info["uint24_clipped"],
        "first_resp_delay_s": first,
        "jumps": jumps,
        "jump_pairs": pairs,
        "ref_beats": ref_src,
        "n_truth_beats": int(be["n_truth"]),
        "n_core_beats": int(be["n_core"]),
        "beat_lag_s": lag,
        "beat_lag_range_s": lag_range,
        "beat_precision": p,
        "beat_recall": rcl,
        "beat_f1": f1,
        "ppi_err_mean_ms": float(ppi_err.mean()) if len(ppi_err) else NAN,
        "ppi_err_sd_ms": float(ppi_err.std(ddof=1)) if len(ppi_err) > 1 else NAN,
        "ppi_err_mae_ms": float(np.abs(ppi_err).mean()) if len(ppi_err) else NAN,
        "shadow_mismatch_frames": mism,
        "shadow_frames": dur,
        "resp_calc_frames": resp_frames,
        "h1_removed_ratio_mean": float(np.mean(rem)) if rem else NAN,
        "h1_time_ratio_mean": float(np.mean(tr_)) if tr_ else NAN,
        "h2_nan_seg_frame_frac": (nan_seg_frames / resp_frames) if resp_frames else NAN,
        "h2_nan_seg_frac": (sh.seg_nan / sh.seg_total) if sh.seg_total else NAN,
        "reseeds": sh.reseeds,
        "meta": rec.meta,
    }
    return summary, resp_rows, hrv_rows
