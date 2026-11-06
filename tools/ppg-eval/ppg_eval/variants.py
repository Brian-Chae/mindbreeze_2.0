"""코어 HrvState::respiratory 의 거울 구현 + 변형 V1~V6 (SDD-317 2단계, verify-addendum-8).

코어는 수정하지 않는다. RR 버퍼는 기존 `Shadow`(98,174프레임 0건 불일치 검증)가 만들고, 호흡 계산
(4Hz 재표본 → Welch → 피크 → 5중앙값)과 리셋 시점 처리를 여기서 거울로 구현한다.
변형 파라미터의 기본값 = 코어 동작(V0). 변형은 한 번에 하나의 파라미터만 바꾼다.
"""
from __future__ import annotations

import math
from typing import Optional

import numpy as np

from .shadow import RESP_MIN_MS, Shadow

FS = 4.0
RATE_MIN = 6.0
RATE_MAX = 40.0
HIST_N = 5

BASE_PARAMS = {
    "band_lo": 0.15,
    "band_hi": 0.4,
    "end_nan": "keep",  # keep(코어 동작: 마지막 구간 NaN) | hold | truncate
    "time_axis": "cumulative",  # cumulative(코어) | real
    "detrend": "none",  # none(코어) | linear
    "peak": "max",  # max(코어) | continuity
    "cont_hz": 0.04,
    "cont_ratio": 0.5,
}


def merged(params: Optional[dict]) -> dict:
    p = dict(BASE_PARAMS)
    if params:
        unknown = set(params) - set(BASE_PARAMS)
        if unknown:
            raise KeyError(f"알 수 없는 파라미터: {sorted(unknown)}")
        p.update(params)
    return p


def spectrum_key(p: dict) -> tuple:
    """스펙트럼(재표본+Welch)에 영향을 주는 파라미터만. 같은 키는 계산을 공유한다."""
    return (p["time_axis"], p["end_nan"], p["detrend"])


def time_axis(rr, ts, mode: str):
    """반환 (xo, yo, fallback). xo 길이 = len(yo)+1."""
    rr = np.asarray(rr, dtype=np.float64)
    secs = rr / 1000.0
    if mode == "real":
        ts_a = np.asarray(ts, dtype=np.float64)
        starts = ts_a - rr
        origin = starts[0]
        xo = np.concatenate([starts - origin, [ts_a[-1] - origin]]) / 1000.0
        if len(xo) >= 2 and bool(np.all(np.diff(xo) > 0.0)):
            return xo, secs, False
        mode_fallback = True
    else:
        mode_fallback = False
    xo = np.concatenate([[0.0], np.cumsum(secs)])  # 코어: 순차 누적합
    return xo, secs, mode_fallback


def resample(xo, yo, end_nan: str):
    """코어 resample/interpolate_linear 거울. 4Hz. 반환 None=n<4."""
    m = len(yo)
    total = xo[-1]
    n = int(math.floor(total * FS))
    if n < 4:
        return None
    xn = np.arange(n) / FS
    out = np.empty(n, dtype=np.float64)
    lo = xn <= xo[0]
    hi = xn >= xo[-1]
    mid = ~(lo | hi)
    out[lo] = yo[0]
    out[hi] = yo[-1]
    xm = xn[mid]
    if len(xm):
        j = np.searchsorted(xo, xm, side="left")
        i = j - 1
        x1, x2, y1 = xo[i], xo[i + 1], yo[i]
        has2 = (i + 1) < m
        y2 = np.where(has2, yo[np.minimum(i + 1, m - 1)], y1 if end_nan == "hold" else np.nan)
        out[mid] = y1 + ((y2 - y1) * (xm - x1)) / (x2 - x1)
    if end_nan == "truncate":
        out = out[xn <= xo[m - 1]]
    return out


def _next_pow2(n: int) -> int:
    p = 1
    while p < n:
        p *= 2
    return p


def welch(data: np.ndarray):
    """코어 welch 거울: Hamming, 50% 중첩, NaN 구간은 PSD 0, 구간 평균. 구간이 없으면 NaN."""
    n = len(data)
    window = max(64, min(256, n // 2))
    overlap = window // 2
    nfft = _next_pow2(window)
    freqs = (np.arange(nfft // 2 + 1) * FS) / nfft
    ham = 0.54 - 0.46 * np.cos((2.0 * np.pi * np.arange(window)) / (window - 1.0))
    wp = float(np.sum(ham * ham))
    acc = np.zeros(nfft // 2 + 1)
    cnt = 0
    start = 0
    while start + window <= n:
        seg = data[start : start + window]
        if not np.isnan(seg).any():
            padded = np.zeros(nfft)
            padded[:window] = seg * ham
            f = np.fft.rfft(padded)
            ps = (f.real**2 + f.imag**2) / (FS * wp)
            ps[1:-1] *= 2.0
            acc += ps
        cnt += 1  # NaN 구간은 PSD 0 으로 합산(코어 동작), 분모에는 포함
        start += window - overlap
    if cnt == 0:
        return freqs, np.full(len(freqs), np.nan)
    return freqs, acc / cnt


def spectrum(rr, ts, key: tuple):
    """반환 (status, freqs, psd, fallback). status: ok | insufficient_resampled_points."""
    tmode, end_nan, detrend = key
    xo, yo, fallback = time_axis(rr, ts, tmode)
    rs = resample(xo, yo, end_nan)
    if rs is None or len(rs) < 16:
        return "insufficient_resampled_points", None, None, fallback
    if detrend == "linear":
        idx = np.arange(len(rs), dtype=np.float64)
        fin = np.isfinite(rs)
        if fin.sum() >= 2:
            coef = np.polyfit(idx[fin], rs[fin], 1)
            rs = rs - np.polyval(coef, idx)
    freqs, psd = welch(rs)
    return "ok", freqs, psd, fallback


def pick_peak(freqs, psd, p: dict, f_prev: Optional[float]):
    """반환 (dom_freq|None, max_p). 코어: f<lo || f>hi 제외, 엄격 > 로 첫 최대 빈."""
    mask = (freqs >= p["band_lo"]) & (freqs <= p["band_hi"]) & ~np.isnan(psd)
    sub = np.where(mask, psd, -np.inf)
    if not np.isfinite(sub).any():
        return None, float("-inf")
    k = int(np.argmax(sub))
    max_p = float(sub[k])
    dom = float(freqs[k])
    if p["peak"] == "continuity" and f_prev is not None and max_p > 0:
        near = mask & (np.abs(freqs - f_prev) <= p["cont_hz"] + 1e-12)
        if near.any():
            sub2 = np.where(near, psd, -np.inf)
            k2 = int(np.argmax(sub2))
            if sub2[k2] >= p["cont_ratio"] * max_p:
                dom = float(freqs[k2])
    return dom, max_p


def _median(v):
    s = sorted(v)
    mid = len(s) // 2
    return s[mid] if len(s) % 2 else (s[mid - 1] + s[mid]) / 2.0


class VariantState:
    """한 변형의 호흡 상태(이력 5개 중앙값, 연속성용 직전 지배 주파수)."""

    def __init__(self, vid: str, params: Optional[dict] = None):
        self.id = vid
        self.p = merged(params)
        self.hist: list[float] = []
        self.resp: Optional[float] = None
        self.f_prev: Optional[float] = None
        self.fallback_frames = 0
        self.calc_frames = 0

    def reset(self):
        self.hist = []
        self.resp = None
        self.f_prev = None

    def _fail(self):
        self.resp = None
        self.hist = []
        self.f_prev = None

    def calc(self, rr, ts, cache: dict):
        total = float(sum(rr))
        stamps = [t for t in ts if math.isfinite(t)]
        elapsed = (stamps[-1] - stamps[0]) if len(stamps) >= 2 else math.inf
        if total < RESP_MIN_MS or elapsed < RESP_MIN_MS:
            return self._fail()
        key = spectrum_key(self.p)
        if key not in cache:
            cache[key] = spectrum(rr, ts, key)
        status, freqs, psd, fallback = cache[key]
        self.calc_frames += 1
        if fallback:
            self.fallback_frames += 1
        if status != "ok":
            return self._fail()
        dom, max_p = pick_peak(freqs, psd, self.p, self.f_prev)
        if dom is None or not math.isfinite(dom) or not (max_p > 0.0):
            return self._fail()
        rate = dom * 60.0
        if rate < RATE_MIN or rate > RATE_MAX or not math.isfinite(rate):
            return self._fail()
        self.f_prev = dom
        self.hist.append(rate)
        if len(self.hist) > HIST_N:
            self.hist.pop(0)
        self.resp = _median(self.hist)


class RespMirror(Shadow):
    """Shadow(RR 버퍼 거울) + 호흡 변형 상태들. 리셋(시계 역행·재시드)은 last_calc 가 0 으로 돌아가는 것으로 감지."""

    def __init__(self, variants: list[VariantState]):
        super().__init__()
        self.variants = variants

    def _update(self, rr, ts, now_ms):
        prev = self.last_calc
        super()._update(rr, ts, now_ms)
        if prev != 0.0 and self.last_calc == 0.0:
            for v in self.variants:
                v.reset()

    def _resp(self, diag):
        cache: dict = {}
        for v in self.variants:
            v.calc(self.rr, self.ts, cache)
