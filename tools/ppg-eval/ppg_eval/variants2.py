"""3단계 변형(W1~W5) 파이프라인 거울 (SDD-317, verify-addendum-9). 코어·기존 거울(shadow.py, variants.py)은 수정하지 않는다.

`Buffer` = `Shadow._update` 의 충실한 포트 + 정제 규칙 변형(pm30 / malik20 / local11). refine=\"v0\" 이면 Shadow 와 동일(시험으로 확인).
`Pipeline` = Buffer + 호흡 상태들(변형별 detrend 등) + 시간영역(SDNN·RMSSD) + SQI 게이트.
후보 항목은 (rr_eff, ts_nom, ts_eff, rr_nom, t_sec) 튜플이다.
 - rr_nom/ts_nom: 코어와 같은 정수 샘플 기준 RR·박동 시각(범위 게이트·중복 제거에 쓰며 후보 집합을 바꾸지 않는다)
 - rr_eff/ts_eff: 버퍼·호흡·HRV 가 쓰는 값. W3(포물선 보간) 외에는 rr_nom/ts_nom 과 같다.
"""
from __future__ import annotations

import math
from typing import Optional

import numpy as np

from . import variants as V
from .shadow import BUF_TARGET_MS, HARD_CAP, INTERVAL_MS, LF_BUF, RESEED_STREAK, RESP_MIN_MS, RR_RESET_MS, _beats_covering, _jsmed

ER, TN, TE, RN, TS = 0, 1, 2, 3, 4  # 항목 인덱스

PIPE_BASE = {"refine": "v0", "sqi_gate": None, "sqi_scope": "window_mean", "peak_interp": "none"}
REFINES = ("v0", "pm30", "malik20", "local11")
AGED_MS = 20000.0
LOCAL_N = 11
MALIK_TOL = 0.20


def split_params(params: Optional[dict]) -> tuple[dict, dict]:
    """(파이프라인 파라미터, 호흡 파라미터). 알 수 없는 키는 KeyError."""
    pipe = dict(PIPE_BASE)
    resp = {}
    for k, v in (params or {}).items():
        if k in PIPE_BASE:
            pipe[k] = v
        elif k in V.BASE_PARAMS:
            resp[k] = v
        else:
            raise KeyError(f"알 수 없는 파라미터: {k}")
    if pipe["refine"] not in REFINES:
        raise KeyError(f"알 수 없는 refine: {pipe['refine']}")
    if pipe["peak_interp"] not in ("none", "parabolic"):
        raise KeyError(f"알 수 없는 peak_interp: {pipe['peak_interp']}")
    return pipe, resp


def pipe_key(pipe: dict) -> tuple:
    return (pipe["refine"], pipe["sqi_gate"], pipe["sqi_scope"], pipe["peak_interp"])


# ---------------------------------------------------------------- 스펙트럼 (detrend none/linear/mean/slope)

def spectrum2(rr, ts, key: tuple):
    """variants.spectrum 의 확장. detrend ∈ none|linear(2단계 V4)|mean|slope. none/linear 는 기존 함수에 위임."""
    tmode, end_nan, detrend = key
    if detrend in ("none", "linear"):
        return V.spectrum(rr, ts, key)
    xo, yo, fallback = V.time_axis(rr, ts, tmode)
    rs = V.resample(xo, yo, end_nan)
    if rs is None or len(rs) < 16:
        return "insufficient_resampled_points", None, None, fallback
    fin = np.isfinite(rs)
    if detrend == "mean":
        if fin.any():
            rs = rs - float(np.mean(rs[fin]))
    elif detrend == "slope":
        idx = np.arange(len(rs), dtype=np.float64)
        if fin.sum() >= 2:
            b = float(np.polyfit(idx[fin], rs[fin], 1)[0])
            rs = rs - b * (idx - float(np.mean(idx[fin])))
    else:
        raise KeyError(f"알 수 없는 detrend: {detrend}")
    freqs, psd = V.welch(rs)
    return "ok", freqs, psd, fallback


class RespState(V.VariantState):
    """VariantState + detrend 확장 + (V0 전용) W4 관찰 통계 수집."""

    def __init__(self, vid: str, params: Optional[dict] = None, observe: bool = False):
        super().__init__(vid, params)
        self.observe = observe
        self.obs: dict = {"slope_s_per_min": [], "mean_rr_s": [], "lf_ratio": [], "floor_flag": []}

    def calc(self, rr, ts, cache: dict):
        total = float(sum(rr))
        stamps = [t for t in ts if math.isfinite(t)]
        elapsed = (stamps[-1] - stamps[0]) if len(stamps) >= 2 else math.inf
        if total < RESP_MIN_MS or elapsed < RESP_MIN_MS:
            return self._fail()
        key = V.spectrum_key(self.p)
        if key not in cache:
            cache[key] = spectrum2(rr, ts, key)
        status, freqs, psd, fallback = cache[key]
        self.calc_frames += 1
        if fallback:
            self.fallback_frames += 1
        if status != "ok":
            return self._fail()
        dom, max_p = V.pick_peak(freqs, psd, self.p, self.f_prev)
        if self.observe:
            self._observe(rr, ts, freqs, psd, dom)
        if dom is None or not math.isfinite(dom) or not (max_p > 0.0):
            return self._fail()
        rate = dom * 60.0
        if rate < V.RATE_MIN or rate > V.RATE_MAX or not math.isfinite(rate):
            return self._fail()
        self.f_prev = dom
        self.hist.append(rate)
        if len(self.hist) > V.HIST_N:
            self.hist.pop(0)
        self.resp = V._median(self.hist)

    def _observe(self, rr, ts, freqs, psd, dom):
        """addendum-9 A9-5 (iii)–(v): V0 의 재표본 기울기·평균 RR·저주파 비율·대역 하단 지배 여부."""
        xo, yo, _ = V.time_axis(rr, ts, "cumulative")
        rs = V.resample(xo, yo, self.p["end_nan"])
        if rs is None:
            return
        fin = np.isfinite(rs)
        if fin.sum() >= 2:
            b = float(np.polyfit(np.arange(len(rs), dtype=np.float64)[fin], rs[fin], 1)[0])
            self.obs["slope_s_per_min"].append(abs(b) * V.FS * 60.0)
        self.obs["mean_rr_s"].append(float(np.mean(yo)))
        ok = ~np.isnan(psd)
        low = float(np.sum(psd[ok & (freqs < self.p["band_lo"])]))
        band = float(np.sum(psd[ok & (freqs >= self.p["band_lo"]) & (freqs <= self.p["band_hi"])]))
        if band > 0:
            self.obs["lf_ratio"].append(low / band)
        inband = freqs[(freqs >= self.p["band_lo"]) & (freqs <= self.p["band_hi"])]
        if dom is not None and len(inband) >= 2:
            self.obs["floor_flag"].append(1 if dom <= float(np.sort(inband)[1]) + 1e-12 else 0)


# ---------------------------------------------------------------- RR 버퍼 (Shadow._update 포트 + 정제 변형)

class Buffer:
    def __init__(self, refine: str = "v0"):
        self.refine = refine
        self.w = 0.30 if refine == "pm30" else 0.25
        self.e: list = []  # (rr_eff, ts_nom, ts_eff, rr_nom, t_sec)
        self.last_end = -math.inf
        self.last_calc = 0.0
        self.streak = 0
        self.rej: list = []
        self.cum_new = 0
        self.cum_removed = 0
        self.reseeds = 0
        self.reset_events = 0  # 시계 역행·재시드로 호흡 상태를 초기화해야 하는 횟수(소비자가 읽고 0 으로)
        self.reseed_event = False

    @property
    def rr(self) -> list:
        return [x[ER] for x in self.e]

    @property
    def ts_eff(self) -> list:
        return [x[TE] for x in self.e]

    def skip(self, cand: list) -> None:
        for c in cand:
            if c[TN] > self.last_end:
                self.last_end = c[TN]

    def update(self, cand: list, now_ms: float) -> None:
        newest = max(c[TN] for c in cand)
        if newest < self.last_end - RR_RESET_MS:
            self.last_end = -math.inf
            self.e.clear()
            self.last_calc = 0.0
            self.reset_events += 1
        future = now_ms + RR_RESET_MS
        if self.last_end > future:
            self.last_end = -math.inf
            self.e.clear()
        cand = [c for c in cand if c[TN] <= future]
        last = self.last_end
        cand = [c for c in cand if c[TN] > last]
        n_new = len(cand)
        self.cum_new += n_new
        valid = [c for c in cand if 200.0 <= c[RN] <= 2000.0]
        in_range = list(valid)
        if self.refine == "malik20":
            prev = self.e[-1][ER] if self.e else None
            kept = []
            for c in valid:
                if prev is None or abs(c[ER] - prev) <= MALIK_TOL * prev:
                    kept.append(c)
                    prev = c[ER]
            valid = kept
        else:
            if len(self.e) >= 5:
                pool = [x[ER] for x in (self.e[-LOCAL_N:] if self.refine == "local11" else self.e)]
            else:
                pool = [c[ER] for c in valid]
            if len(pool) >= 3:
                med = _jsmed(pool)
                if med > 0:
                    valid = [c for c in valid if abs(c[ER] - med) <= med * self.w]
        seed_prev = 0
        if not valid and in_range:
            self.streak += 1
            self.rej.extend(in_range)
            if self.streak >= RESEED_STREAK:
                med = _jsmed([c[ER] for c in self.rej])
                seed = [c for c in self.rej if abs(c[ER] - med) <= med * self.w]
                cur = {c[TN] for c in cand}
                seed_prev = sum(1 for c in seed if c[TN] not in cur)
                self.e.clear()
                self.last_calc = 0.0
                valid = seed
                self.streak = 0
                self.rej.clear()
                self.reseeds += 1
                self.reset_events += 1
                self.reseed_event = True
        elif valid:
            self.streak = 0
            self.rej.clear()
        cur_valid = len({c[TN] for c in valid} & {c[TN] for c in cand})
        self.cum_removed += n_new - cur_valid
        self.cum_removed -= seed_prev
        if not valid:
            for c in cand:
                if c[TN] > self.last_end:
                    self.last_end = c[TN]
            return
        for c in valid:
            self.e.append(c)
        for c in cand:
            if c[TN] > self.last_end:
                self.last_end = c[TN]
        if self.refine != "malik20" and len(self.e) >= 5:
            med = _jsmed([x[ER] for x in self.e])
            if med > 0:
                keep = [abs(x[ER] - med) <= med * self.w for x in self.e]
                if not all(keep):
                    self.cum_removed += sum(1 for k in keep if not k)
                    self.e = [x for x, k in zip(self.e, keep) if k]
        keep_n = min(max(LF_BUF, _beats_covering([x[ER] for x in self.e], BUF_TARGET_MS)), HARD_CAP)
        if len(self.e) > keep_n:
            self.e = self.e[len(self.e) - keep_n :]


# ---------------------------------------------------------------- 시간영역 (코어 time_domain 거울)

def time_domain(all_rr: list):
    """반환 (avnn, sdnn, rmssd) 또는 None(has_time False)."""
    win = min(max(60, _beats_covering(all_rr, 30500.0)), len(all_rr))
    rr = all_rr[len(all_rr) - win :]
    total = sum(rr)
    if len(rr) < 10 or total < 30000.0:
        return None
    avnn = sum(rr) / len(rr)
    v = 0.0
    for x in rr:
        d = x - avnn
        v += d * d
    sdnn = math.sqrt(v / len(rr))
    sq = 0.0
    n = len(rr) - 1
    for i in range(1, len(rr)):
        d = rr[i] - rr[i - 1]
        sq += d * d
    rmssd = math.sqrt(sq / n)
    return avnn, sdnn, rmssd


class Pipeline:
    """한 RR 버퍼 + 그 위에 얹힌 호흡 상태들. step() 은 프레임마다 호출한다."""

    def __init__(self, pipe: dict, resp_states: list):
        self.pipe = pipe
        self.buf = Buffer(pipe["refine"])
        self.resp_states = resp_states
        self.gate = pipe["sqi_gate"]
        self.has_time = False
        self.td: Optional[tuple] = None
        self.gated_frames = 0
        self.frames = 0
        self.aged: dict = {}  # ts_nom -> t_sec (버퍼에서 20초 이상 숙성된 박동의 합집합)

    def out_td(self):
        return self.td if self.has_time else None

    def step(self, cand: list, now_ms: float, sqi: float) -> bool:
        """한 프레임. 반환 True = 게이트로 출력 보류(출력은 호출자가 null 로 취급)."""
        self.frames += 1
        if self.gate is not None and sqi < self.gate:
            self.gated_frames += 1
            self.buf.skip(cand)  # 후보를 버퍼에 넣지 않고 '이미 본 것'으로 처리(나중 프레임에 다시 들어오지 않게)
            return True
        if cand:
            self.buf.update(cand, now_ms)
            if self.buf.reset_events:
                for v in self.resp_states:
                    v.reset()
                self.buf.reset_events = 0
            if self.buf.reseed_event:
                self.has_time = False
                self.buf.reseed_event = False
            self._calc(now_ms)
        cutoff = now_ms - AGED_MS
        for x in self.buf.e:
            if x[TE] > cutoff:
                break
            self.aged[x[TN]] = x[TS]
        return False

    def _calc(self, now_ms: float) -> None:
        b = self.buf
        if len(b.e) < 30:
            return
        if now_ms - b.last_calc < INTERVAL_MS:
            return
        rr = b.rr
        td = time_domain(rr)
        if td is None:
            self.has_time = False
        else:
            self.td, self.has_time = td, True
        ts = b.ts_eff
        cache: dict = {}
        for v in self.resp_states:
            v.calc(rr, ts, cache)
        b.last_calc = now_ms

    def aged_times(self) -> np.ndarray:
        return np.asarray(sorted(self.aged.values()), dtype=np.float64)
