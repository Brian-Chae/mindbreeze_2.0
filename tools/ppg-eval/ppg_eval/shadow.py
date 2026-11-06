"""코어 HrvState::update_rr_buffer / respiratory 게이트의 거울 구현(진단 전용, 코어 무수정).
가설 H1(정제 제거율·시간 압축)·H2(Welch NaN 구간)을 코어 출력만으로 측정하기 위함.
거울의 RR 버퍼 길이가 매 emission 코어 rr_buffer_len 과 일치해야(H9) 가설 지표를 신뢰한다."""
from __future__ import annotations

import math

import numpy as np

RR_RESET_MS = 5000.0
RESEED_STREAK = 12
HARD_CAP = 400
BUF_TARGET_MS = 70000.0
LF_BUF = 120
INTERVAL_MS = 1000.0
RESP_MIN_MS = 60000.0


def _beats_covering(rr, target):
    acc = 0.0
    for i, r in enumerate(reversed(rr)):
        acc += r
        if acc >= target:
            return i + 1
    return len(rr)


def _jsmed(v):
    s = sorted(v)
    return s[len(s) >> 1]


class Shadow:
    def __init__(self):
        self.rr, self.ts = [], []
        self.last_end = -math.inf
        self.last_calc = 0.0
        self.streak = 0
        self.rej = []
        self.cum_new = 0
        self.cum_removed = 0
        self.reseeds = 0
        self.resp_calcs = 0
        self.nan_pts_total = 0
        self.seg_total = 0
        self.seg_nan = 0

    def step(self, rr, ts, now_ms):
        """한 emission 처리. 반환 dict(frame 진단)."""
        diag = {"resp_computed": False, "nan_pts": 0, "segs": 0, "segs_nan": 0}
        if rr:
            self._update(rr, ts, now_ms)
            self._calc(now_ms, diag)
        diag["buf_len"] = len(self.rr)
        diag["removed_ratio"] = (self.cum_removed / self.cum_new) if self.cum_new else None
        if len(self.ts) >= 2:
            span = self.ts[-1] - self.ts[0]
            diag["time_ratio"] = (sum(self.rr) / span) if span > 0 else None
        else:
            diag["time_ratio"] = None
        return diag

    def _update(self, rr, ts, now_ms):
        cand = list(zip(rr, ts))
        newest = max(c[1] for c in cand)
        if newest < self.last_end - RR_RESET_MS:
            self.last_end = -math.inf
            self.rr.clear()
            self.ts.clear()
            self.last_calc = 0.0
        future = now_ms + RR_RESET_MS
        if self.last_end > future:
            self.last_end = -math.inf
            self.rr.clear()
            self.ts.clear()
        cand = [c for c in cand if c[1] <= future]
        last = self.last_end
        cand = [c for c in cand if c[1] > last]
        n_new = len(cand)
        self.cum_new += n_new
        valid = [c for c in cand if 200.0 <= c[0] <= 2000.0]
        in_range = list(valid)
        pool = list(self.rr) if len(self.rr) >= 5 else [c[0] for c in valid]
        if len(pool) >= 3:
            med = _jsmed(pool)
            if med > 0:
                valid = [c for c in valid if abs(c[0] - med) <= med * 0.25]
        seed_prev = 0
        if not valid and in_range:
            self.streak += 1
            self.rej.extend(in_range)
            if self.streak >= RESEED_STREAK:
                med = _jsmed([c[0] for c in self.rej])
                seed = [c for c in self.rej if abs(c[0] - med) <= med * 0.25]
                cur = {c[1] for c in cand}
                seed_prev = sum(1 for c in seed if c[1] not in cur)
                self.rr.clear()
                self.ts.clear()
                self.last_calc = 0.0
                valid = seed
                self.streak = 0
                self.rej.clear()
                self.reseeds += 1
        elif valid:
            self.streak = 0
            self.rej.clear()
        cur_valid = len({c[1] for c in valid} & {c[1] for c in cand})
        self.cum_removed += n_new - cur_valid
        self.cum_removed -= seed_prev
        if not valid:
            for c in cand:
                if c[1] > self.last_end:
                    self.last_end = c[1]
            return
        for c in valid:
            self.rr.append(c[0])
            self.ts.append(c[1])
        for c in cand:
            if c[1] > self.last_end:
                self.last_end = c[1]
        if len(self.rr) >= 5:
            med = _jsmed(self.rr)
            if med > 0:
                keep = [abs(r - med) <= med * 0.25 for r in self.rr]
                if not all(keep):
                    self.cum_removed += sum(1 for k in keep if not k)
                    self.rr = [r for r, k in zip(self.rr, keep) if k]
                    self.ts = [t for t, k in zip(self.ts, keep) if k]
        keep_n = min(max(LF_BUF, _beats_covering(self.rr, BUF_TARGET_MS)), HARD_CAP)
        if len(self.rr) > keep_n:
            cut = len(self.rr) - keep_n
            self.rr = self.rr[cut:]
            self.ts = self.ts[cut:]

    def _calc(self, now_ms, diag):
        if len(self.rr) < 30:
            return
        if now_ms - self.last_calc < INTERVAL_MS:
            return
        self._resp(diag)
        self.last_calc = now_ms

    def _resp(self, diag):
        total = sum(self.rr)
        elapsed = (self.ts[-1] - self.ts[0]) if len(self.ts) >= 2 else math.inf
        if total < RESP_MIN_MS or elapsed < RESP_MIN_MS:
            return
        secs = [r / 1000.0 for r in self.rr]
        t = np.concatenate([[0.0], np.cumsum(np.asarray(secs))])
        n = int(math.floor(t[-1] * 4.0))
        if n < 4 or n < 16:
            return
        xn = np.arange(n) / 4.0
        nan_mask = xn > t[len(secs) - 1]  # interpolate_linear: 마지막 구간 y2 undefined → NaN
        nan_mask &= xn < t[-1]
        window = max(64, min(256, n // 2))
        step = window - window // 2
        segs = nan = 0
        s = 0
        while s + window <= n:
            segs += 1
            if nan_mask[s : s + window].any():
                nan += 1
            s += step
        diag.update({"resp_computed": True, "nan_pts": int(nan_mask.sum()), "segs": segs, "segs_nan": nan})
        self.resp_calcs += 1
        self.nan_pts_total += int(nan_mask.sum())
        self.seg_total += segs
        self.seg_nan += nan
