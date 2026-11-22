"""SDD-328 B1 — 회원 리포트 v2 집계 코어(순수 함수, DB·AI 무관).

규칙 정본: 확정 시안 `report-generic-real-v3-1117/build.py` + `specs/sdd-328-generic-member-report/spec.md` §3.1.

표기 규칙
- 이 모듈의 분 인덱스 `i` 는 0부터(`PersonMinutes` 와 동일). 화면 표기 분 = i + 1.
- 안착 제외: 인덱스 0·1. 처음 5분 = 인덱스 2~6, 마지막 5분 = 인덱스 n-5~n-1 (n = 유효 측정 길이 = 표기 마지막 분).
- 결측은 보간·0 채움하지 않는다(빈 분은 None, 중앙값·평균에서 제외).
"""

from __future__ import annotations

import math
import statistics
from dataclasses import dataclass
from typing import Optional, Sequence

import numpy as np

from app.schemas.member_report_v2 import MIN_GROUP_N, SETTLE_MINUTES, WINDOW_MINUTES
from app.services.member_report_metrics import Minutes

KDE_GRID = 81  # 시안 격자 점 수
HIST_BINS = 24  # 시안 히스토그램 구간 수
AXIS_PAD = 0.1  # 시간 그래프 세로축 여백 비율(시안)
DIST_PAD = 0.06  # 분포 가로축 여백 비율(시안)


def is_num(v: object) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def median_of(values: Sequence[Optional[float]]) -> Optional[float]:
    vals = [float(v) for v in values if is_num(v)]
    return statistics.median(vals) if vals else None


def window_median(minutes: Minutes, start: int, end: int) -> Optional[float]:
    """인덱스 [start, end] (양끝 포함)의 분별 값 중앙값. 값이 하나도 없으면 None."""
    return median_of([minutes.get(i) for i in range(start, end + 1)])


def first_window_idx() -> tuple[int, int]:
    return SETTLE_MINUTES, SETTLE_MINUTES + WINDOW_MINUTES - 1


def last_window_idx(n: int) -> tuple[int, int]:
    return n - WINDOW_MINUTES, n - 1


def valid_after_settle(minutes: Minutes, n: int) -> int:
    """안착 이후(인덱스 2 ~ n-1) 값이 있는 분 수."""
    return sum(1 for i, v in minutes.items() if SETTLE_MINUTES <= i < n and is_num(v))


def measured_length(person: dict[str, Minutes]) -> int:
    """유효 측정 길이 n = 값이 있는 마지막 분 인덱스 + 1(표기 마지막 분). 값이 없으면 0."""
    last = [i for ms in person.values() for i, v in ms.items() if is_num(v)]
    return (max(last) + 1) if last else 0


# ── 상대 변화(%) ──────────────────────────────────────────────────
def base_value(minutes: Minutes) -> Optional[float]:
    """상대 변화 기준값 = 처음 5분 중앙값. 결측·0 이하면 None(→ 해당 지표 poor_signal)."""
    a, b = first_window_idx()
    base = window_median(minutes, a, b)
    return base if base is not None and base > 0 else None


def pct_vs(base: float, v: float) -> float:
    return (v / base - 1.0) * 100.0


def to_relative(minutes: Minutes, base: float) -> Minutes:
    """분별 값을 `base`(회원 처음 5분 중앙값) 기준 상대 변화(%)로 바꾼다. 결측은 건너뛴다(보간 없음)."""
    return {i: pct_vs(base, float(v)) for i, v in minutes.items() if is_num(v)}


# ── 가장 편안했던 5분 ─────────────────────────────────────────────
@dataclass(frozen=True)
class QuietPick:
    start: int  # 인덱스(0부터)
    motion_mean: float
    hr_median: float


def pick_quiet_window(motion: Minutes, heart_rate: Minutes, n: int) -> Optional[QuietPick]:
    """인덱스 2 이후 연속 5분 중 움직임·심박이 모두 있는 창에서
    ① 움직임 평균 최소 → ② 심박 중앙값 최소 → ③ 이른 시각. 후보가 없으면 None."""
    best: Optional[tuple[float, float, int]] = None
    for i in range(SETTLE_MINUTES, n - WINDOW_MINUTES + 1):
        idx = range(i, i + WINDOW_MINUTES)
        if not all(is_num(motion.get(j)) and is_num(heart_rate.get(j)) for j in idx):
            continue
        key = (statistics.fmean(float(motion[j]) for j in idx),
               float(statistics.median(float(heart_rate[j]) for j in idx)), i)
        if best is None or key < best:
            best = key
    return None if best is None else QuietPick(start=best[2], motion_mean=best[0], hr_median=best[1])


def when_label(start_idx: int, n: int) -> str:
    """시기 표현. n×0.3 미만 → 초반, n×0.7 이상 → 끝나갈 무렵, 그 사이 → 중간."""
    if start_idx >= n * 0.7:
        return "수업이 끝나갈 무렵"
    if start_idx >= n * 0.3:
        return "수업 중간에"
    return "수업 초반에"


def calm_cross_minutes(heart_rate: Minutes, relaxation: Minutes, n: int) -> int:
    """직전 분보다 1분 동안 뛴 횟수는 줄고 이완도는 오른 분 수(인덱스 3 이후, 두 분 모두 값이 있을 때만)."""
    cnt = 0
    for i in range(SETTLE_MINUTES + 1, n):
        h0, h1, r0, r1 = heart_rate.get(i - 1), heart_rate.get(i), relaxation.get(i - 1), relaxation.get(i)
        if all(is_num(x) for x in (h0, h1, r0, r1)) and h1 < h0 and r1 > r0:  # type: ignore[operator]
            cnt += 1
    return cnt


# ── 그룹 평균 ± SD ────────────────────────────────────────────────
@dataclass(frozen=True)
class BandData:
    mean: list[Optional[float]]
    sd: list[Optional[float]]
    n: list[int]

    @property
    def any_shown(self) -> bool:
        return any(m is not None for m in self.mean)


def group_band(others: Sequence[Minutes], n: int, ndigits: int = 3) -> BandData:
    """분별 그룹 평균과 모집단 SD(ddof=0), 유효 인원. 본인은 `others` 에 넣지 않는다.

    안착 분(0·1)은 평균을 두지 않는다. 유효 인원 < MIN_GROUP_N 인 분은 mean·sd = None(선·띠 끊김)."""
    mean: list[Optional[float]] = []
    sd: list[Optional[float]] = []
    cnt: list[int] = []
    for i in range(n):
        if i < SETTLE_MINUTES:
            mean.append(None), sd.append(None), cnt.append(0)
            continue
        vals = [float(o[i]) for o in others if is_num(o.get(i))]
        cnt.append(len(vals))
        if len(vals) >= MIN_GROUP_N:
            mean.append(round(statistics.fmean(vals), ndigits))
            sd.append(round(statistics.pstdev(vals), ndigits))
        else:
            mean.append(None), sd.append(None)
    return BandData(mean=mean, sd=sd, n=cnt)


# ── 시간 그래프 세로축 ────────────────────────────────────────────
def axis_range(mine: Sequence[float], band: Optional[BandData]) -> Optional[tuple[float, float]]:
    """나의 값 + 그룹 평균±SD(표시되는 분)의 범위에 10% 여백(시안 chart())."""
    vv = [float(v) for v in mine if is_num(v)]
    if band is not None:
        for m, s in zip(band.mean, band.sd):
            if m is not None and s is not None:
                vv += [m - s, m + s]
    if not vv:
        return None
    lo, hi = min(vv), max(vv)
    pad = max((hi - lo) * AXIS_PAD, 0.001)
    return round(lo - pad, 3), round(hi + pad, 3)


# ── 분포(히스토그램 + KDE) ────────────────────────────────────────
@dataclass(frozen=True)
class DistData:
    lo: float
    hi: float
    axis_ticks: list[float]
    mean_me: float
    mean_group: float
    sd_group: float
    n_people: int
    n_person_minutes: int
    my_minutes: int
    density: list[float]
    my_bars: list[float]


def distribution(mine: Minutes, others: Sequence[Minutes], n: int) -> Optional[DistData]:
    """나의 분 값 히스토그램 + 그룹 분 값 가우시안 KDE. 그룹 인원 < MIN_GROUP_N 이면 None."""
    my_vals = [float(v) for i, v in mine.items() if SETTLE_MINUTES <= i < n and is_num(v)]
    per_person = [[float(v) for i, v in o.items() if SETTLE_MINUTES <= i < n and is_num(v)] for o in others]
    per_person = [p for p in per_person if p]
    group = [v for p in per_person for v in p]
    if not my_vals or len(per_person) < MIN_GROUP_N:
        return None
    span = (max(my_vals + group) - min(my_vals + group)) or 1.0
    lo = min(my_vals + group) - span * DIST_PAD
    hi = max(my_vals + group) + span * DIST_PAD
    g = np.asarray(group, dtype=float)
    avg, sd = float(g.mean()), float(g.std())  # ddof=0
    bw = max(sd * len(g) ** (-0.2) * 1.06, (hi - lo) / 80)
    grid = np.linspace(lo, hi, KDE_GRID)
    density = np.exp(-0.5 * ((grid[:, None] - g[None, :]) / bw) ** 2).sum(axis=1) / (len(g) * bw * math.sqrt(2 * math.pi))
    binw = (hi - lo) / HIST_BINS
    m = np.asarray(my_vals, dtype=float)
    hist = np.array([float(((m >= lo + j * binw) & (m < lo + (j + 1) * binw)).sum()) / (len(m) * binw)
                     for j in range(HIST_BINS)])
    top = max(float(density.max()), float(hist.max())) or 1.0
    return DistData(
        lo=round(lo, 3), hi=round(hi, 3), axis_ticks=[round(lo, 3), round((lo + hi) / 2, 3), round(hi, 3)],
        mean_me=round(float(m.mean()), 3), mean_group=round(avg, 3), sd_group=round(sd, 3),
        n_people=len(per_person), n_person_minutes=len(g), my_minutes=len(my_vals),
        density=[round(float(d) / top, 4) for d in density], my_bars=[round(float(h) / top, 4) for h in hist])


# ── LF/HF 흐름 ────────────────────────────────────────────────────
def log1p_series(minutes: Minutes) -> Minutes:
    return {i: math.log1p(float(v)) for i, v in minutes.items() if is_num(v) and float(v) > -1}


def norm_series(minutes_log: Minutes, n: int) -> Optional[list[Optional[float]]]:
    """log1p 값을 개인 범위(+10% 여백)로 0~1 에 놓는다. 세로 숫자는 보내지 않는다."""
    vals = [v for i, v in minutes_log.items() if SETTLE_MINUTES <= i < n]
    if not vals:
        return None
    lo, hi = min(vals), max(vals)
    pad = max((hi - lo) * AXIS_PAD, 0.001)
    lo, hi = lo - pad, hi + pad
    return [round((minutes_log[i] - lo) / (hi - lo), 4) if i in minutes_log and i >= SETTLE_MINUTES else None
            for i in range(n)]
