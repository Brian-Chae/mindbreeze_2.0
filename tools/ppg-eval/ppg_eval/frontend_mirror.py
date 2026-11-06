"""코어 PPG 전단(`dsp/ppg.rs::analyze`)의 파이썬 거울 + SQI + 포물선 보간 (SDD-317 3단계, verify-addendum-9).

코어는 수정하지 않는다. DC 제거 → 1–5Hz biquad → peaks_refractory(ratio 0.5, 300ms) → RR/박동 시각,
`ppg_sqi`(25샘플 창, 임계 250) 를 그대로 옮긴다. G-front 게이트가 코어 `rr_list`/`rr_end_ts_list` 와 대조한다.
"""
from __future__ import annotations

import math

import numpy as np
from scipy.signal import lfilter

FS = 50.0
STEP_MS = 1000.0 / FS  # 20ms
PPG_RING = 500
SQI_W = 25
SQI_THR = 250.0


def js_round(x: float) -> float:
    return math.floor(x + 0.5)


def bandpass_coefs(f1: float = 1.0, f2: float = 5.0, sps: float = FS):
    """biquadjs makeBandpassFilter 계수 (`biquad.rs::bandpass`/`build`)."""
    center = (f1 + f2) / 2.0
    bw = f2 - center
    resonance = 10.0 ** math.floor(math.log10(center))
    q = resonance * math.sqrt((center - bw) * (center + bw)) / (2.0 * bw)
    omega = 2.0 * math.pi * center / sps
    sn, cs = math.sin(omega), math.cos(omega)
    alpha = sn / (2.0 * q)
    a0 = 1.0 + alpha
    b = np.array([alpha / a0, 0.0, -alpha / a0])
    a = np.array([1.0, (-2.0 * cs) / a0, (1.0 - alpha) / a0])
    return b, a


_B, _A = bandpass_coefs()


def ppg_filter(data: np.ndarray) -> np.ndarray:
    mean = float(np.sum(data)) / len(data)
    return lfilter(_B, _A, data - mean)


def ppg_sqi(f: np.ndarray) -> np.ndarray:
    """코어 ppg_sqi 거울: 25샘플 창 평균 품질, 마지막으로 덮어쓴 창의 값(sqi[j] = ws[min(j, n-w)]) ×100."""
    n = len(f)
    if n < SQI_W:
        return np.zeros(n)
    a = np.abs(f)
    q = np.where(a <= SQI_THR, 1.0, np.maximum(0.0, 1.0 - np.minimum((a - SQI_THR) / SQI_THR, 1.0)))
    c = np.concatenate([[0.0], np.cumsum(q)])
    ws = (c[SQI_W:] - c[:-SQI_W]) / SQI_W  # 길이 n-w+1
    idx = np.minimum(np.arange(n), n - SQI_W)
    return ws[idx] * 100.0


def peaks_refractory(norm: list, ratio: float = 0.5, refractory_ms: float = 300.0) -> list:
    n = len(norm)
    if n < 3:
        return []
    refr = max(int(js_round(refractory_ms * (FS / 1000.0))), 1)
    srt = sorted(norm)
    p90 = srt[int(math.floor((n - 1) * 0.9))]
    bootstrap = max(p90 * ratio, 0.0)
    peaks: list = []
    recent: list = []
    for i in range(1, n - 1):
        if not (norm[i] > norm[i - 1] and norm[i] >= norm[i + 1]):
            continue
        thr = bootstrap
        if len(recent) >= 3:
            thr = (sum(recent) / len(recent)) * ratio
        if norm[i] < thr:
            continue
        last = peaks[-1] if peaks else -(1 << 60)
        if i - last < refr:
            if peaks:
                lp = peaks[-1]
                if norm[i] > norm[lp]:
                    peaks[-1] = i
                    if recent:
                        recent[-1] = norm[i]
            continue
        peaks.append(i)
        recent.append(norm[i])
        if len(recent) > 8:
            recent.pop(0)
    return peaks


def parabolic_delta(y, i: int) -> float:
    """3점 포물선 sub-sample 보정량 δ ∈ [-0.5, 0.5] (addendum-9 W3)."""
    den = y[i - 1] - 2.0 * y[i] + y[i + 1]
    if den == 0.0 or not math.isfinite(den):
        return 0.0
    d = 0.5 * (y[i - 1] - y[i + 1]) / den
    return float(min(0.5, max(-0.5, d)))


def window_slice(L: int):
    """analyze(): 처리 구간 (start, end)."""
    if L >= 500:
        return 100, L - 100
    if L > 150:
        return 100, L
    return 0, L


def analyze_front(ring: np.ndarray, ts_end: float, with_interp: bool = True) -> dict:
    """윈도 1개. 반환 dict: base=[(rr, ts, ts, rr)], interp=[(rr_eff, ts_nom, ts_eff, rr_nom)], sqi, n_peaks."""
    L = len(ring)
    s, e = window_slice(L)
    data = np.asarray(ring[s:e], dtype=np.float64)
    f = ppg_filter(data)
    sqi = float(np.mean(ppg_sqi(f)))  # red==ir 이므로 (s_red+s_ir)/2 의 평균과 같다
    norm = f - float(np.sum(f)) / len(f)
    nl = norm.tolist()
    peaks = peaks_refractory(nl)

    def ts_of(j: int) -> float:
        return ts_end - (L - 1 - (s + j)) * STEP_MS

    base, interp = [], []
    if len(peaks) >= 2:
        deltas = [parabolic_delta(nl, p) for p in peaks] if with_interp else [0.0] * len(peaks)
        for i in range(1, len(peaks)):
            iv = (peaks[i] - peaks[i - 1]) * STEP_MS
            if 200.0 <= iv <= 2000.0:
                t = ts_of(peaks[i])
                base.append((iv, t, t, iv))
                rr_eff = ((peaks[i] + deltas[i]) - (peaks[i - 1] + deltas[i - 1])) * STEP_MS
                interp.append((rr_eff, t, t + deltas[i] * STEP_MS, iv))
    return {"base": base, "interp": interp, "sqi": sqi, "n_peaks": len(peaks)}


def front_frames(ir: np.ndarray, rows: list, with_interp: bool = True) -> list:
    """기록 전체: 코어 emission 행(win_end_ts)마다 링(최근 500샘플) 윈도를 분석."""
    out = []
    for r in rows:
        n = (r["k"] + 1) * 50
        ring = ir[max(0, n - PPG_RING) : n]
        out.append(analyze_front(ring, r["win_end_ts"], with_interp))
    return out
