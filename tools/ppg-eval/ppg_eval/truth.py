"""참값 산출: 호흡 이벤트 → 창 호흡수 (verify V2), ECG R-peak 검출·참 HR/HRV (V4)."""
from __future__ import annotations

import numpy as np
from scipy.signal import butter, find_peaks, sosfiltfilt

from .common import RESP_TOL_RATE


def window_rate(events: np.ndarray, t_end: float, L: float):
    """창 (t_end-L, t_end] 의 호흡수(회/분). 반환 (rate|None, reason)."""
    ev = events[(events > t_end - L) & (events <= t_end)]
    k = len(ev)
    if k < 3:
        return None, "truth_undefined"
    iv = np.diff(ev)
    span = ev[-1] - ev[0]
    if span <= 0:
        return None, "truth_undefined"
    med = float(np.median(iv))
    if (ev[0] - (t_end - L)) > 1.5 * med or (t_end - ev[-1]) > 1.5 * med:
        return None, "truth_undefined"
    return 60.0 * (k - 1) / span, "ok"


def truth_for_record(rec, L: float, T: float):
    """레코드·창 → (참값|None, reason). BIDMC 는 두 주석자 규칙, 그 외는 단일 이벤트열."""
    names = sorted(rec.resp_events)
    if rec.ds == "bidmc":
        a, ra = window_rate(rec.resp_events["ann1"], T, L)
        b, rb = window_rate(rec.resp_events["ann2"], T, L)
        if a is None or b is None:
            return None, "truth_undefined"
        if abs(a - b) > RESP_TOL_RATE:
            return None, "annotator_disagree"
        return 0.5 * (a + b), "ok"
    if len(names) == 1:
        return window_rate(rec.resp_events[names[0]], T, L)
    return None, "no_resp_truth"


def detect_r_peaks(ecg: np.ndarray, fs: float) -> np.ndarray:
    """고정 R-peak 검출기(verify V4): 5–15Hz 대역통과 → 미분 제곱 → 150ms 이동적분 → 적응 임계 + 200ms 불응.
    적분 피크 후보 주변 ±100ms 에서 대역통과 |x| 최대점으로 정밀화. 반환: 초 단위 시각."""
    sos = butter(2, [5.0, 15.0], btype="band", fs=fs, output="sos")
    y = sosfiltfilt(sos, ecg - np.mean(ecg))
    d = np.diff(y, prepend=y[0])
    e = d * d
    w = max(1, int(round(0.150 * fs)))
    integ = np.convolve(e, np.ones(w) / w, mode="same")
    win = int(round(8 * fs))
    # 적응 임계: 8초 블록의 99% 분위수의 0.3배 (고정 규칙)
    thr = np.empty_like(integ)
    for s in range(0, len(integ), win):
        blk = integ[s : s + win]
        thr[s : s + win] = 0.3 * np.percentile(blk, 99)
    cand, _ = find_peaks(integ, height=thr, distance=max(1, int(round(0.200 * fs))))
    half = int(round(0.100 * fs))
    out = []
    ay = np.abs(y)
    for c in cand:
        lo, hi = max(0, c - half), min(len(y), c + half + 1)
        out.append(lo + int(np.argmax(ay[lo:hi])))
    out = np.unique(np.asarray(out, dtype=np.int64))
    # 불응기 재적용(정밀화로 근접해진 중복 제거: 더 큰 쪽 유지)
    keep = []
    for i in out:
        if keep and (i - keep[-1]) < int(round(0.200 * fs)):
            if ay[i] > ay[keep[-1]]:
                keep[-1] = i
            continue
        keep.append(i)
    return np.asarray(keep, dtype=np.float64) / fs


def beat_match(truth: np.ndarray, core: np.ndarray, tol: float):
    """1:1 greedy(가까운 쌍 우선) 매칭. 반환 (tp, matched_pairs[(truth_idx, core_idx)])."""
    if len(truth) == 0 or len(core) == 0:
        return 0, []
    pairs = []
    # 후보 쌍: 각 truth 에 대해 tol 내 core
    cand = []
    j0 = 0
    for i, t in enumerate(truth):
        while j0 < len(core) and core[j0] < t - tol:
            j0 += 1
        j = j0
        while j < len(core) and core[j] <= t + tol:
            cand.append((abs(core[j] - t), i, j))
            j += 1
    cand.sort()
    ut, uc = set(), set()
    for _, i, j in cand:
        if i in ut or j in uc:
            continue
        ut.add(i)
        uc.add(j)
        pairs.append((i, j))
    pairs.sort()
    return len(pairs), pairs


def ecg_rr_series(beats: np.ndarray):
    """참 박동열 → (RR ms, 종료 시각 s). 200–2000ms 범위만."""
    rr = np.diff(beats) * 1000.0
    end = beats[1:]
    m = (rr >= 200.0) & (rr <= 2000.0)
    return rr[m], end[m]


def truth_hrv_at(rr: np.ndarray, end: np.ndarray, T: float):
    """T 이하 RR 로 코어와 같은 창 정의(최근 max(60, 30.5s 채우는 개수))의 SDNN(모집단)·RMSSD(차분 개수 분모)."""
    idx = np.searchsorted(end, T, side="right")
    r = rr[:idx]
    if len(r) < 10:
        return None, None
    acc, cnt = 0.0, len(r)
    for i, v in enumerate(r[::-1]):
        acc += v
        if acc >= 30500.0:
            cnt = i + 1
            break
    win = max(60, cnt)
    r = r[-min(win, len(r)) :]
    if len(r) < 10 or r.sum() < 30000.0:
        return None, None
    sdnn = float(np.sqrt(np.mean((r - r.mean()) ** 2)))
    d = np.diff(r)
    rmssd = float(np.sqrt(np.sum(d * d) / len(d)))
    return sdnn, rmssd


def truth_hr_at(beats: np.ndarray, T: float, L: float = 30.0):
    b = beats[(beats > T - L) & (beats <= T)]
    if len(b) < 3:
        return None
    rr = np.diff(b) * 1000.0
    rr = rr[(rr >= 200) & (rr <= 2000)]
    if len(rr) < 2:
        return None
    return float(60000.0 / rr.mean())
