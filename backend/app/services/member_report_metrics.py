"""SDD-327 T1 — 회원 개인 리포트 지표 집계(순수 함수, DB 무관).

`EEGFeatureWindow` 윈도우(1초)를 분 단위로 모아 아래를 계산한다. 출력은 T0 계약
(`app.schemas.member_report`)의 수치 필드만이며, 문장(conclusion 등)은 T4 몫이다.

- 분 단위 개인 시계열 (`person_minutes_from_windows`)
- 구간 4개 중앙값·전후 변화량 (`compute_change`, `segment_values`)
- 시계열(`build_series`) · LF/HF 흐름 전용 norm(log1p)
- 안정된 5분 선택 (`pick_stable_window`)
- 히어로 전후 4쌍 수치 (`build_effect_pairs`)

규칙(시안 `personal-report/build.py` 이식):
- 분 값은 해당 분 윈도우의 유효 비율(invalid 가 아닌 비율) ≥ 50% 일 때만 사용, 지표별 평균.
- 결측은 0으로 채우지 않고 None 유지.
- 구간 값은 구간 안 분 값의 중앙값. 전 = 준비·호흡, 후 = 명상 후반.
- 클래스 단계(준비·호흡/몸 움직임/명상 전반/명상 후반)의 DB 기록은 현재 없다
  (조사: session·class_program·class_scheduling 모델에 단계 컬럼 없음) → plan 기본값
  `DEFAULT_SEGMENTS`를 쓰고, 호출자가 `segments` 인자로 덮어쓸 수 있다.
"""

from __future__ import annotations

import math
import statistics
from dataclasses import dataclass
from typing import Callable, Iterable, Optional, Sequence

from app.schemas.member_report import (
    MIN_VALID_MINUTES,
    Change,
    Direction,
    EffectPair,
    MetricKey,
    MetricSeries,
    Segment,
    SegmentValue,
)
from app.services.report_narrative import direction_for_change

# ── 상수 ──────────────────────────────────────────────────────────
MIN_MINUTE_VALID_RATIO = 0.5  # 분 값 채택 최소 유효 윈도우 비율 (시안 nv/n ≥ 0.5)
STABLE_WINDOW_MIN = 5  # 안정된 5분
STABLE_MIN_COVERAGE = 4  # 5분 중 움직임·심박이 있는 분 최소 개수
STABLE_CONTAMINATION_MOTION = 0.05  # 안정 창 평균 움직임이 이 값을 넘으면 '움직임 오염' (기본값)

# 시안(몸돌봄 2회차) 구간 — 클래스 단계 기록이 없을 때의 plan 기본값
DEFAULT_SEGMENTS: tuple[Segment, ...] = (
    Segment(key="prep", label="준비·호흡", start_min=2, end_min=12),
    Segment(key="move", label="몸 움직임", start_min=13, end_min=31),
    Segment(key="first_half", label="명상 전반", start_min=33, end_min=47),
    Segment(key="second_half", label="명상 후반", start_min=48, end_min=63),
)

# 윈도우 속성 → 분 시계열 키. rmssd/sdnn/lf_hf 는 계약 키와 별개로 안정 창에서도 쓴다.
_ATTR_BY_KEY: dict[str, str] = {
    "motion": "motion",
    "heart_rate": "heart_rate",
    "rmssd": "rmssd",
    "sdnn": "sdnn",
    "lf_hf": "lf_hf_ratio",
    "focus": "focus_index",
    "relaxation": "relaxation_index",
    "emotional_balance": "emotional_stability",
}
MIND_KEYS = ("focus", "relaxation", "emotional_balance")
BODY_ATTR_KEYS = ("motion", "heart_rate", "rmssd", "sdnn", "lf_hf")  # PPG/ACC 유래 — EEG quality 와 무관

# 방향 임계(절대값). None 이면 변화율 5% (`direction_for_change` 공용 규칙)
_DIRECTION_THRESHOLD: dict[str, Optional[float]] = {
    "heart_rate": 3.0, "rmssd": 5.0, "sdnn": 5.0, "motion": None,
    "focus": None, "relaxation": None, "emotional_balance": None,
}
# 표시 자릿수·단위·라벨 (시안 v11)
METRIC_DECIMALS: dict[str, int] = {
    "motion": 3, "heart_rate": 1, "rmssd": 1, "lf_hf": 2,
    "focus": 1, "relaxation": 1, "emotional_balance": 1, "aperiodic": 2,
}
METRIC_UNIT: dict[str, str] = {
    "motion": "가속도 크기", "heart_rate": "회/분", "rmssd": "ms", "lf_hf": "비율",
    "focus": "지표", "relaxation": "지표", "emotional_balance": "지표", "aperiodic": "지수",
}

# {분: 값} — 지표 하나의 개인 분 시계열
Minutes = dict[int, float]
PersonMinutes = dict[str, Minutes]


# ── 분 시계열 ─────────────────────────────────────────────────────
def _is_num(v: object) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def person_minutes_from_windows(
    windows: Iterable[object],
    mind_normalizer: Optional[Callable[[str, float], Optional[float]]] = None,
) -> PersonMinutes:
    """1초 윈도우 → 지표별 {경과 분: 평균값}.

    - 경과 초는 `rel_sec` 속성이 있으면 그것, 없으면 `window_index` (수업 시작 기준).
    - 마음 지표: 분 안에서 quality=='invalid' 가 아닌 윈도우 비율이 50% 미만이면 그 분 제외.
      몸 지표(HR·RMSSD 등): EEG quality 와 무관하게 값이 있는 윈도우 비율 50% 미만이면 제외.
    - 마음 3지표는 `mind_normalizer(key, raw)`(0~100 정규화 훅)가 있으면 적용, None 반환 시 결측.
    """
    buckets: dict[int, list[object]] = {}
    for w in windows:
        sec = getattr(w, "rel_sec", None)
        if sec is None:
            sec = getattr(w, "window_index", None)
        if not _is_num(sec) or sec < 0:
            continue
        buckets.setdefault(int(sec) // 60, []).append(w)

    out: PersonMinutes = {k: {} for k in _ATTR_BY_KEY}
    for minute, ws in buckets.items():
        if not ws:
            continue
        # quality 는 EEG 판정(포화·lead-off) 전용이다. 몸 지표(HR·RMSSD·SDNN·LF/HF·움직임)는 PPG/ACC 에서 나오고
        # PPG 무효 창은 업로드 단계에서 이미 null 이므로, EEG invalid 창이어도 값이 있으면 쓴다.
        eeg_ok = [w for w in ws if getattr(w, "quality", "valid") != "invalid"]
        for key, attr in _ATTR_BY_KEY.items():
            body = key in BODY_ATTR_KEYS
            # 시안 nv/n ≥ 0.5 — nv: 몸 지표=그 지표 값이 있는 창, 마음 지표=EEG 유효 창
            nv = sum(1 for w in ws if _is_num(getattr(w, attr, None))) if body else len(eeg_ok)
            if nv / len(ws) < MIN_MINUTE_VALID_RATIO:
                continue
            vals: list[float] = []
            for w in (ws if body else eeg_ok):
                raw = getattr(w, attr, None)
                if not _is_num(raw):
                    continue
                if key in MIND_KEYS and mind_normalizer is not None:
                    raw = mind_normalizer(key, float(raw))
                    if not _is_num(raw):
                        continue
                vals.append(float(raw))
            if vals:
                out[key][minute] = sum(vals) / len(vals)
    return out


def valid_minutes(minutes: Minutes, first: int, last: int) -> int:
    """분석 범위(first..last) 안의 유효 분 수."""
    return sum(1 for m, v in minutes.items() if first <= m <= last and _is_num(v))


def is_valid_person(minutes: Minutes, first: int, last: int) -> bool:
    """개인 유효 시간 ≥ MIN_VALID_MINUTES."""
    return valid_minutes(minutes, first, last) >= MIN_VALID_MINUTES


# ── 구간 값·전후 변화 ─────────────────────────────────────────────
def _segment_vals(minutes: Minutes, seg: Segment) -> list[float]:
    return [v for m, v in minutes.items() if seg.start_min <= m <= seg.end_min and _is_num(v)]


def segment_median(minutes: Minutes, seg: Segment) -> Optional[float]:
    vals = _segment_vals(minutes, seg)
    return statistics.median(vals) if vals else None


def segment_values(minutes: Minutes, segments: Sequence[Segment], decimals: int) -> list[SegmentValue]:
    """나의 구간 중앙값 4개(계약 `my_segments`). 값 없으면 None."""
    out: list[SegmentValue] = []
    for seg in segments:
        med = segment_median(minutes, seg)
        out.append(SegmentValue(segment_key=seg.key, value=None if med is None else round(med, decimals)))
    return out


def compared_minutes(minutes: Minutes, seg: Segment) -> int:
    return len(_segment_vals(minutes, seg))


def _segment_by_key(segments: Sequence[Segment], key: str) -> Segment:
    for s in segments:
        if s.key == key:
            return s
    raise ValueError(f"구간 {key} 없음")


def compute_change(
    metric: str,
    minutes: Minutes,
    segments: Sequence[Segment] = DEFAULT_SEGMENTS,
    first: Optional[int] = None,
    last: Optional[int] = None,
) -> Optional[Change]:
    """전(준비·호흡 중앙값) → 후(명상 후반 중앙값) 변화. 신호 부족·결측이면 None.

    LF/HF 는 흐름 전용이라 호출하지 않는다(`build_series` 의 norm 만 사용).
    """
    first = segments[0].start_min if first is None else first
    last = segments[-1].end_min if last is None else last
    if not is_valid_person(minutes, first, last):
        return None
    before = segment_median(minutes, _segment_by_key(segments, "prep"))
    after = segment_median(minutes, _segment_by_key(segments, "second_half"))
    if before is None or after is None:
        return None
    dec = METRIC_DECIMALS[metric]
    direction = direction_for_change(before, after, _DIRECTION_THRESHOLD.get(metric))
    unit = METRIC_UNIT[metric]
    return Change(
        before=round(before, dec), after=round(after, dec), delta=round(after - before, dec),
        direction=direction or "stable", decimals=dec, unit=unit, label=unit,
    )


# ── 시계열 ────────────────────────────────────────────────────────
def _percentile(vals: Sequence[float], q: float) -> float:
    """선형 보간 백분위(numpy 기본과 동일). q 는 0~100."""
    s = sorted(vals)
    if len(s) == 1:
        return s[0]
    pos = (len(s) - 1) * q / 100.0
    lo = math.floor(pos)
    hi = min(lo + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (pos - lo)


def axis_range(values: Sequence[float], pad_ratio: float = 0.08, floor_zero: bool = True) -> tuple[float, float]:
    """축 범위: 1~99 백분위 ± 8% 여백. 음수 없는 지표는 0 이상으로 자른다(시안 규칙)."""
    if not values:
        return 0.0, 1.0
    lo, hi = _percentile(values, 1), _percentile(values, 99)
    pad = (hi - lo) * pad_ratio or 1.0
    lo, hi = lo - pad, hi + pad
    if floor_zero:
        lo = max(lo, 0.0)
    return round(lo, 3), round(hi, 3)


def minute_axis(first: int, last: int) -> list[int]:
    return list(range(first, last + 1))


def build_series(
    metric: str,
    minutes: Minutes,
    first: int,
    last: int,
    group_band: Optional[object] = None,
    extra_axis_values: Sequence[float] = (),
) -> MetricSeries:
    """계약 `MetricSeries`. LF/HF 는 values=None·norm=log1p 정규화(0~1), 나머지는 values.

    - `extra_axis_values`: 축 범위에 함께 반영할 값(그룹 띠 p10/p90 등).
    - 그룹 숨김이면 `group_band=None` (숫자도 미전송).
    """
    xs = minute_axis(first, last)
    row = [minutes.get(m) if _is_num(minutes.get(m)) else None for m in xs]
    unit = METRIC_UNIT[metric]
    present = [v for v in row if v is not None]

    if metric == "lf_hf":
        # 흐름 전용: log1p 후 나의 최댓값으로 0~1 정규화. 결측분은 None 유지.
        logs = [None if v is None else math.log1p(max(v, 0.0)) for v in row]
        top = max((x for x in logs if x is not None), default=0.0)
        norm = [None if x is None else (round(x / top, 4) if top > 0 else 0.0) for x in logs]
        return MetricSeries(
            minutes=xs, values=None, norm=norm, value_transform="log1p",
            axis_min=None, axis_max=None, axis_unit=unit, group_band=None,
        )

    lo, hi = axis_range([*present, *extra_axis_values], floor_zero=True)
    return MetricSeries(
        minutes=xs, values=[None if v is None else round(v, 4) for v in row],
        norm=None, value_transform="linear", axis_min=lo, axis_max=hi, axis_unit=unit,
        group_band=group_band,  # type: ignore[arg-type]
    )


# ── 안정된 5분 ────────────────────────────────────────────────────
@dataclass(frozen=True)
class StableWindow:
    """움직임이 가장 적은 연속 5분. 값은 구간 중앙값(결측 None)."""

    start_min: int
    window_label: str  # 예 "[48,53)"
    heart_rate: Optional[float]
    rmssd: Optional[float]
    sdnn: Optional[float]
    mean_motion: float
    contaminated: bool  # 평균 움직임이 STABLE_CONTAMINATION_MOTION 초과


def pick_stable_window(
    person: PersonMinutes,
    segments: Sequence[Segment] = DEFAULT_SEGMENTS,
    first: Optional[int] = None,
    last: Optional[int] = None,
) -> Optional[StableWindow]:
    """명상 구간(전반 시작~마지막 분)에서 평균 움직임 최소인 연속 5분을 고른다(동률이면 이른 쪽).

    5분 중 움직임·심박이 모두 있는 분이 STABLE_MIN_COVERAGE 미만인 창은 후보에서 제외.
    후보가 없으면 None → 7쪽 생략.
    """
    first = segments[0].start_min if first is None else first
    last = segments[-1].end_min if last is None else last
    begin = _segment_by_key(segments, "first_half").start_min
    motion, hr = person.get("motion", {}), person.get("heart_rate", {})

    best: Optional[tuple[float, int]] = None
    for s in range(begin, last - STABLE_WINDOW_MIN + 2):
        mins = range(s, s + STABLE_WINDOW_MIN)
        covered = [m for m in mins if _is_num(motion.get(m)) and _is_num(hr.get(m))]
        if len(covered) < STABLE_MIN_COVERAGE:
            continue
        mean_motion = sum(motion[m] for m in covered) / len(covered)
        if best is None or mean_motion < best[0] - 1e-12:
            best = (mean_motion, s)
    if best is None:
        return None
    mean_motion, s = best

    def med(key: str) -> Optional[float]:
        vals = [person[key][m] for m in range(s, s + STABLE_WINDOW_MIN)
                if key in person and _is_num(person[key].get(m))]
        return round(statistics.median(vals), 3) if vals else None

    return StableWindow(
        start_min=s, window_label=f"[{s},{s + STABLE_WINDOW_MIN})",
        heart_rate=med("heart_rate"), rmssd=med("rmssd"), sdnn=med("sdnn"),
        mean_motion=round(mean_motion, 6),
        contaminated=mean_motion > STABLE_CONTAMINATION_MOTION,
    )


# ── 히어로 전후 4쌍 ───────────────────────────────────────────────
# (키, 표시 이름, 단위, 좋은 방향 → tone=calm). 시안 순서: 심박·이완도·움직임·집중도
_PAIR_SPEC: tuple[tuple[str, str, str, Optional[str]], ...] = (
    ("heart_rate", "심박", "회/분", "down"),
    ("relaxation", "이완도", "지표", "up"),
    ("motion", "움직임 가속도", "가속도 크기", "down"),
    ("focus", "집중도", "지표", None),  # 집중도는 방향에 가치 판단 없음 → neutral
)


def change_text(delta: float, direction: Direction, decimals: int) -> str:
    """시안 표기: '↓ 17.0 감소' / '↑ 14.3 상승' / '→ 0.2 비슷'."""
    mag = f"{abs(delta):.{decimals}f}"
    if direction == "down":
        return f"↓ {mag} 감소"
    if direction == "up":
        return f"↑ {mag} 상승"
    return f"→ {mag} 비슷"


def build_effect_pairs(changes: dict[str, Optional[Change]]) -> list[EffectPair]:
    """히어로 전후 4쌍의 수치 부분. 결측 지표는 건너뛴다(가용 지표만)."""
    pairs: list[EffectPair] = []
    for key, name, unit, calm_dir in _PAIR_SPEC:
        ch = changes.get(key)
        if ch is None:
            continue
        pairs.append(EffectPair(
            key=key, name=name, unit=unit,  # type: ignore[arg-type]
            before=f"{ch.before:.{ch.decimals}f}", after=f"{ch.after:.{ch.decimals}f}",
            change_text=change_text(ch.delta, ch.direction, ch.decimals),
            direction=ch.direction,
            tone="calm" if (calm_dir is not None and ch.direction == calm_dir) else "neutral",
        ))
    return pairs
