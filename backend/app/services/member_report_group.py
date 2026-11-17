"""SDD-327 T2 — 회원 리포트 그룹 분포 집계 + 최소 인원 가드(순수 함수, DB 무관).

같은 클래스 회차 참여자의 분 시계열(`member_report_metrics.PersonMinutes`)을 받아
계약 `Distribution`·`SegmentCompareRow`·`GroupBand` 의 **수치만** 만든다(문장은 T4).

개인정보 가드(verify V4):
- 유효 인원(해당 지표 유효 분 ≥ MIN_VALID_MINUTES) < MIN_GROUP_N 이면 `compute_group` 은 None
  → 호출자는 body.group=None·series.group_band=None·group_hidden_reason="min_n" 으로 둔다(숫자도 미전송).
- 매분 띠는 그 분의 유효 인원 < MIN_BAND_N 이면 p10~p90 모두 None.
- 결과에는 집계(곡선·평균·SD·백분위·중앙값)만 담고 타 회원 ID·개별 값은 담지 않는다.
- LF/HF 는 흐름 전용 → 항상 None.
"""

from __future__ import annotations

import math
import statistics
from dataclasses import dataclass
from typing import Mapping, Optional, Sequence

import numpy as np

from app.schemas.member_report import (
    MIN_BAND_N,
    MIN_GROUP_N,
    Distribution,
    GroupBand,
    Segment,
    SegmentCompareRow,
)
from app.services.member_report_metrics import (
    DEFAULT_SEGMENTS,
    METRIC_DECIMALS,
    Minutes,
    PersonMinutes,
    StableWindow,
    compared_minutes,
    is_valid_person,
    segment_median,
)

GRID_POINTS = 181  # 밀도 곡선 균등 격자 수 (시안 샘플 181점)
HIST_BINS = 20  # 나의 매분 히스토그램 구간 수 (시안 build.py 21 경계)
AXIS_TICKS = 5
GROUP_TICK_PAD = 0.06  # 분포 축 여백 (시안 0.06)
HEADROOM = 1.12  # 최댓값 위 여유 (시안 ymax * 1.12)
NO_GROUP_METRICS = frozenset({"lf_hf"})  # 흐름 전용 지표


@dataclass(frozen=True)
class GroupResult:
    """한 지표의 그룹 집계 수치. T4/T5 가 GroupBlock·MetricSeries 에 끼워 넣는다."""

    distribution: Distribution
    rows: list[SegmentCompareRow]
    band: GroupBand  # 길이 = first..last 분 수
    n_valid: int  # 유효 인원(나 포함)


def valid_people(
    metric_by_person: Mapping[str, Minutes], first: int, last: int
) -> dict[str, Minutes]:
    """유효 분 ≥ MIN_VALID_MINUTES 인 참여자만 남긴다."""
    return {pid: m for pid, m in metric_by_person.items() if is_valid_person(m, first, last)}


def _in_range(minutes: Minutes, first: int, last: int) -> list[float]:
    return [float(v) for m, v in minutes.items()
            if first <= m <= last and isinstance(v, (int, float)) and math.isfinite(v)]


def _kde(x: np.ndarray, grid: np.ndarray) -> np.ndarray:
    """가우시안 KDE, 대역폭 = Silverman(1.06·σ·n^-1/5). 시안 build.py 와 동일."""
    x = x[np.isfinite(x)]
    if len(x) < 5:
        return np.zeros_like(grid)
    bw = 1.06 * float(np.std(x)) * len(x) ** (-1 / 5) or 1e-6
    z = (grid[:, None] - x[None, :]) / bw
    return np.exp(-0.5 * z * z).sum(1) / (len(x) * bw * math.sqrt(2 * math.pi))


def compute_band(
    people: Mapping[str, Minutes], first: int, last: int, decimals: int = 4
) -> GroupBand:
    """매분 그룹 띠. 그 분 인원 < MIN_BAND_N 이면 5개 백분위 모두 None."""
    cols: dict[str, list[Optional[float]]] = {k: [] for k in ("p10", "p25", "p50", "p75", "p90")}
    qs = {"p10": 10, "p25": 25, "p50": 50, "p75": 75, "p90": 90}
    for minute in range(first, last + 1):
        vals = [float(m[minute]) for m in people.values()
                if minute in m and isinstance(m[minute], (int, float)) and math.isfinite(m[minute])]
        if len(vals) < MIN_BAND_N:
            for k in cols:
                cols[k].append(None)
            continue
        pct = np.percentile(vals, list(qs.values()))
        for (k, _), v in zip(qs.items(), pct):
            cols[k].append(round(float(v), decimals))
    return GroupBand(**cols)


def compute_distribution(
    pooled: Sequence[float], mine: Sequence[float], decimals: int
) -> Optional[Distribution]:
    """그룹 밀도(0~1)·나의 히스토그램(0~1)·평균/SD.

    정규화: 밀도와 막대 높이를 같은 값 max(밀도최대, 막대최대)·1.12 로 나눈다(상대 높이 보존, 0~1).
    축: 풀링 1~99 백분위(나의 2~98 포함) ± 6%, 하한 0(음수 없는 지표).
    """
    pooled_a = np.asarray([v for v in pooled if math.isfinite(v)], dtype=float)
    if len(pooled_a) == 0:
        return None
    mine_a = np.asarray([v for v in mine if math.isfinite(v)], dtype=float)

    lo, hi = np.percentile(pooled_a, [1, 99])
    if len(mine_a):
        lo = min(lo, np.percentile(mine_a, 2))
        hi = max(hi, np.percentile(mine_a, 98))
    pad = (hi - lo) * GROUP_TICK_PAD or 1.0
    lo, hi = max(float(lo - pad), 0.0), float(hi + pad)

    grid = np.linspace(lo, hi, GRID_POINTS)
    dens = _kde(pooled_a, grid)
    if len(mine_a):
        bins = np.linspace(lo, hi, HIST_BINS + 1)
        bars, _ = np.histogram(mine_a, bins=bins, density=True)
    else:
        bars = np.zeros(HIST_BINS)
    top = max(float(dens.max()), float(bars.max())) * HEADROOM or 1.0

    ticks = [round(float(t), 3) for t in np.linspace(lo, hi, AXIS_TICKS)]
    dec = max(decimals, 1)
    return Distribution(
        axis_ticks=[round(t, dec) for t in ticks],
        mean_me=round(float(mine_a.mean()), dec + 2) if len(mine_a) else 0.0,
        mean_group=round(float(pooled_a.mean()), dec + 2),
        sd_group=round(float(pooled_a.std()), 4),
        n_people=0,  # compute_group 이 채운다
        n_person_minutes=int(len(pooled_a)),
        my_minutes=int(len(mine_a)),
        density=[round(float(d) / top, 4) for d in dens],
        my_bars=[round(float(b) / top, 4) for b in bars],
    )


def compute_rows(
    mine: Minutes,
    people: Mapping[str, Minutes],
    segments: Sequence[Segment],
    decimals: int,
) -> list[SegmentCompareRow]:
    """구간별 나 vs 그룹. 그룹값 = 구간 중앙값을 가진 유효 참여자들의 중앙값(해당 인원 < MIN_GROUP_N 이면 None)."""
    rows: list[SegmentCompareRow] = []
    for seg in segments:
        mine_v = segment_median(mine, seg)
        per_person = [v for v in (segment_median(m, seg) for m in people.values()) if v is not None]
        group_v = statistics.median(per_person) if len(per_person) >= MIN_GROUP_N else None
        rows.append(SegmentCompareRow(
            segment_key=seg.key,
            mine=None if mine_v is None else round(mine_v, decimals),
            group=None if group_v is None else round(group_v, decimals),
            diff=None if mine_v is None or group_v is None else round(mine_v - group_v, decimals),
            compared_minutes=compared_minutes(mine, seg),
        ))
    return rows


def compute_group(
    metric: str,
    mine: Minutes,
    others: Mapping[str, Minutes],
    first: int,
    last: int,
    segments: Sequence[Segment] = DEFAULT_SEGMENTS,
) -> Optional[GroupResult]:
    """한 지표의 그룹 집계. 가드 미충족이면 None.

    - `others`: 같은 클래스 회차 참여자 {익명 키: 분 시계열} (나를 포함해도 되고 빼도 된다 — 키를
      모를 수 있으니 내 시계열은 `mine` 으로 따로 받고, 풀링에는 `others` + (유효하면) `mine`을 합친다.
      따라서 `others` 에 나를 중복해서 넣지 말 것).
    - 유효 인원(나 포함) < MIN_GROUP_N, 내가 유효하지 않음, 흐름 전용 지표 → None.
    """
    if metric in NO_GROUP_METRICS:
        return None
    if not is_valid_person(mine, first, last):
        return None
    pool = valid_people(others, first, last)
    people: dict[str, Minutes] = {**pool, "__me__": mine}
    n_valid = len(people)
    if n_valid < MIN_GROUP_N:
        return None

    dec = METRIC_DECIMALS.get(metric, 1)
    pooled = [v for m in people.values() for v in _in_range(m, first, last)]
    dist = compute_distribution(pooled, _in_range(mine, first, last), dec)
    if dist is None:
        return None
    dist = dist.model_copy(update={"n_people": n_valid})
    return GroupResult(
        distribution=dist,
        rows=compute_rows(mine, people, segments, dec),
        band=compute_band(people, first, last),
        n_valid=n_valid,
    )


def stable_group_stats(
    key: str, others: Sequence[Optional[StableWindow]]
) -> tuple[Optional[float], Optional[int]]:
    """안정된 5분 그룹 중앙값·인원(움직임 오염 표시 없는 사람만). key ∈ heart_rate|rmssd|sdnn.

    인원 < MIN_GROUP_N 이면 (None, None) — 숫자도 미전송.
    """
    vals = [getattr(w, key) for w in others
            if w is not None and not w.contaminated and getattr(w, key) is not None]
    if len(vals) < MIN_GROUP_N:
        return None, None
    return round(float(statistics.median(vals)), 1), len(vals)
