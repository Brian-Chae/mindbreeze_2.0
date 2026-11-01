"""SDD-269 저장 데이터 기반 결측 구간 파생 — 순수 함수(DB·시계 의존 없음).

분석 데이터 창(1초 단위)과 측정 기록 파일(segment) 의 시간 흔적에서 "신호가 끊긴 구간"을 계산한다.
- 원인은 단정하지 않는다(`signal_lost`/`unknown`). 데이터를 지어내지 않고 빈 구간만 설명한다.
- 모든 시각은 기기 ms. 구간은 [start_ms, end_ms).
"""
from dataclasses import dataclass, field

WINDOW_MS = 1000.0
GAP_THRESHOLD_MS = 1500.0  # 인접 창/파일 시간 간격이 이 값을 넘으면 구간 후보
MIN_GAP_MS = 2000.0  # 병합 후 이 길이 미만은 잡음으로 보고 버린다

R_QUALITY, R_INDEX, R_TIME, R_SEGMENT = 'quality_zero', 'index_gap', 'time_gap', 'segment_gap'


@dataclass(frozen=True)
class WindowPoint:
    group: str | None  # play_group_id (None 도 하나의 그룹)
    window_index: int
    device_ms: float | None
    quality_zero: bool  # signal_quality == 0 또는 quality == 'invalid'


@dataclass(frozen=True)
class SegmentSpan:
    start_ms: float
    end_ms: float


@dataclass(frozen=True)
class DerivedGap:
    start_ms: float
    end_ms: float
    reasons: frozenset[str] = field(default_factory=frozenset)

    @property
    def length_ms(self) -> float:
        return self.end_ms - self.start_ms

    @property
    def reason(self) -> str:
        return 'signal_lost' if R_QUALITY in self.reasons else 'unknown'


def _quality_gaps(rows: list[WindowPoint]) -> list[DerivedGap]:
    out: list[DerivedGap] = []
    run: list[WindowPoint] = []

    def flush() -> None:
        if run:
            out.append(DerivedGap(run[0].device_ms, run[-1].device_ms + WINDOW_MS, frozenset({R_QUALITY})))
            run.clear()
    for w in rows:
        if w.quality_zero and w.device_ms is not None:
            # 연속 = 직전 품질0 창과 index 가 이어지고 시간 간격이 정상일 때만
            if run and (w.window_index != run[-1].window_index + 1 or w.device_ms - run[-1].device_ms > GAP_THRESHOLD_MS):
                flush()
            run.append(w)
        else:
            flush()
    flush()
    return out


def _window_gaps(windows: list[WindowPoint]) -> list[DerivedGap]:
    groups: dict[str | None, list[WindowPoint]] = {}
    for w in windows:
        groups.setdefault(w.group, []).append(w)
    out: list[DerivedGap] = []
    for rows in groups.values():
        rows = sorted(rows, key=lambda w: w.window_index)
        out += _quality_gaps(rows)
        timed = [w for w in rows if w.device_ms is not None]
        for a, b in zip(timed, timed[1:]):
            start, end = a.device_ms + WINDOW_MS, b.device_ms
            if end <= start:
                continue
            reasons = set()
            if b.window_index - a.window_index > 1:
                reasons.add(R_INDEX)
            if b.device_ms - a.device_ms > GAP_THRESHOLD_MS:
                reasons.add(R_TIME)
            if reasons:
                out.append(DerivedGap(start, end, frozenset(reasons)))
    return out


def _segment_gaps(segments: list[SegmentSpan]) -> list[DerivedGap]:
    out: list[DerivedGap] = []
    spans = sorted(segments, key=lambda s: (s.start_ms, s.end_ms))
    reach: float | None = None
    for s in spans:
        if reach is not None and s.start_ms - reach > GAP_THRESHOLD_MS:
            out.append(DerivedGap(reach, s.start_ms, frozenset({R_SEGMENT})))
        reach = s.end_ms if reach is None else max(reach, s.end_ms)
    return out


def merge_gaps(gaps: list[DerivedGap]) -> list[DerivedGap]:
    """겹치거나 맞닿은(≤0ms) 구간을 합치고 사유 합집합을 유지한다."""
    merged: list[DerivedGap] = []
    for g in sorted(gaps, key=lambda g: (g.start_ms, g.end_ms)):
        if merged and g.start_ms <= merged[-1].end_ms:
            last = merged[-1]
            merged[-1] = DerivedGap(last.start_ms, max(last.end_ms, g.end_ms), last.reasons | g.reasons)
        else:
            merged.append(g)
    return merged


def derive_gaps(windows: list[WindowPoint], segments: list[SegmentSpan]) -> list[DerivedGap]:
    """R1~R4 후보를 모아 병합하고 최소 길이 미만을 버린다."""
    merged = merge_gaps(_window_gaps(windows) + _segment_gaps(segments))
    return [g for g in merged if g.length_ms >= MIN_GAP_MS]


def subtract_recorded(derived: list[tuple[float, float, frozenset[str]]],
                      recorded: list[tuple[float, float]]) -> list[tuple[float, float, frozenset[str]]]:
    """(ms 단위) 기록된 구간과 겹치는 부분을 파생에서 뺀다(recorded 우선). 남은 조각이 MIN_GAP 미만이면 버린다."""
    out = []
    for s, e, r in derived:
        pieces = [(s, e)]
        for rs, re_ in sorted(recorded):
            nxt = []
            for ps, pe in pieces:
                if re_ <= ps or rs >= pe:
                    nxt.append((ps, pe))
                    continue
                if rs > ps:
                    nxt.append((ps, rs))
                if re_ < pe:
                    nxt.append((re_, pe))
            pieces = nxt
        out += [(ps, pe, r) for ps, pe in pieces if pe - ps >= MIN_GAP_MS]
    return out
