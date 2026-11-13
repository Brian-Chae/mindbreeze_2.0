"""SDD-327 T6 — 회원 리포트 책(PDF)용 SVG 생성기 (JS 없음, 서버 렌더).

좌표계·색·범례는 확정 시안 v11(`book/index.html`)의 SVG에서 역산한 값이다.
- 시간 그래프 viewBox 620x242: 플롯 x 46~586, 배경 띠 y 44~200(156), 선 영역 y 52~200(148)
- 분포 그래프 viewBox 620x242: 곡선 y = 198 - density*150, 막대 폭 21.1·간격 22.5
- 안정된 5분 척도 viewBox 600x99: 트랙 x 22~578
입력 데이터는 `MemberReport` 계약(집계값만)이며 타 회원 값은 없다.
"""

from __future__ import annotations

from html import escape
from typing import Optional, Sequence

from app.schemas.member_report import Distribution, MetricSeries, ReferenceScale, Segment

COLOR_ME = "#24564F"
COLOR_GROUP = "#765B7A"
COLOR_TEXT = "#4D5F57"
COLOR_GRID = "#D7DED5"
FONT_SIZE = 12
FONT_FAMILY = "BookSans, BookSerif"

X0, X1 = 46.0, 586.0
BAND_TOP, BAND_BOTTOM = 44.0, 200.0
LINE_TOP, LINE_BASE = 52.0, 200.0
LINE_H = LINE_BASE - LINE_TOP  # 148

# 시안의 구간 배경색(지표 쪽 / 여정 쪽)
BAND_COLORS_METRIC = ("#e7e3e9", "#ffffff", "#f2f1f3", "#d7e6dc")
BAND_COLORS_JOURNEY = ("#F0F3ED", "#FCFAF5", "#F0F3ED", "#FCFAF5")


def _n(v: float) -> str:
    """좌표 표기(소수 둘째 자리)."""
    return f"{v:.2f}"


def _txt(x: float, y: float, text: str, anchor: str = "middle", fill: str = COLOR_TEXT,
         extra: str = "") -> str:
    return (f'<text fill="{fill}" font-size="{FONT_SIZE}" text-anchor="{anchor}" '
            f'x="{_n(x)}" y="{_n(y)}"{extra}>{escape(text)}</text>')


def _fmt(v: float, decimals: int) -> str:
    return f"{v:.{decimals}f}"


def _runs(points: Sequence[Optional[tuple[float, float]]]) -> list[list[tuple[float, float]]]:
    """None 으로 끊긴 연속 구간 목록."""
    runs: list[list[tuple[float, float]]] = []
    cur: list[tuple[float, float]] = []
    for p in points:
        if p is None:
            if cur:
                runs.append(cur)
            cur = []
        else:
            cur.append(p)
    if cur:
        runs.append(cur)
    return runs


def _path(points: Sequence[tuple[float, float]]) -> str:
    return " ".join(("M" if i == 0 else "L") + f"{_n(x)},{_n(y)}" for i, (x, y) in enumerate(points))


def time_series_svg(
    series: MetricSeries,
    segments: Sequence[Segment],
    first_minute: int,
    last_minute: int,
    start_clock: str,
    decimals: int,
    my_segment_values: dict[str, Optional[float]],
    band_colors: Sequence[str] = BAND_COLORS_METRIC,
    aria_label: str = "수업 네 구간의 그룹 중앙값과 나의 흐름",
) -> str:
    """수업 시간 흐름 그래프. 그룹 띠(50%·80%) + 그룹 중앙(점선) + 나의 매분 선(실선)."""
    span = max(last_minute - first_minute, 1)

    def x(minute: float) -> float:
        return X0 + (minute - first_minute) / span * (X1 - X0)

    use_norm = series.values is None
    amin, amax = series.axis_min, series.axis_max
    axis_ok = (not use_norm) and amin is not None and amax is not None
    lo: float = amin if (axis_ok and amin is not None) else 0.0
    hi: float = amax if (axis_ok and amax is not None) else 1.0
    rng = (hi - lo) or 1.0

    def y(v: float) -> float:
        h = (v - lo) / rng if not use_norm else v
        return max(BAND_TOP, min(LINE_BASE, LINE_BASE - h * LINE_H))

    parts: list[str] = [
        f'<svg aria-label="{escape(aria_label)}" role="img" viewBox="0 0 620 242" '
        f'font-family="{FONT_FAMILY}" xmlns="http://www.w3.org/2000/svg">'
    ]
    # 구간 배경 띠 + 구간 이름
    for i, seg in enumerate(segments):
        xs = x(seg.start_min)
        xe = x(segments[i + 1].start_min) if i + 1 < len(segments) else X1
        parts.append(f'<rect fill="{band_colors[i % len(band_colors)]}" x="{_n(xs)}" y="{_n(BAND_TOP)}" '
                     f'width="{_n(xe - xs)}" height="{_n(BAND_BOTTOM - BAND_TOP)}"/>')
        parts.append(_txt(x((seg.start_min + seg.end_min) / 2), 24, seg.label))

    minutes = series.minutes
    gb = series.group_band
    # 그룹 분포 띠(옅은 80%, 진한 50%)
    if gb is not None:
        for lo_arr, hi_arr, opacity in ((gb.p10, gb.p90, ".12"), (gb.p25, gb.p75, ".26")):
            pairs: list[Optional[tuple[float, float, float]]] = []
            for m, a, b in zip(minutes, lo_arr, hi_arr):
                pairs.append(None if a is None or b is None else (x(m), y(a), y(b)))
            # 연속 구간별 폴리곤(위 경계 정방향 → 아래 경계 역방향)
            cur: list[tuple[float, float, float]] = []
            groups: list[list[tuple[float, float, float]]] = []
            for p in pairs:
                if p is None:
                    if cur:
                        groups.append(cur)
                    cur = []
                else:
                    cur.append(p)
            if cur:
                groups.append(cur)
            for g in groups:
                if len(g) < 2:
                    continue
                top = [f"{_n(px)},{_n(py_hi)}" for px, _py_lo, py_hi in g]
                bot = [f"{_n(px)},{_n(py_lo)}" for px, py_lo, _py_hi in reversed(g)]
                parts.append(f'<polygon fill="{COLOR_GROUP}" opacity="{opacity}" points="{" ".join(top + bot)}"/>')

    # 가로 눈금선 4개(+ 눈금 숫자)
    for k in range(4):
        gy = LINE_BASE - k * LINE_H / 3
        parts.append(f'<line stroke="{COLOR_GRID}" stroke-width="0.7" x1="{_n(X0)}" x2="{_n(X1)}" '
                     f'y1="{_n(gy)}" y2="{_n(gy)}"/>')
        if axis_ok:
            parts.append(_txt(40, gy + 4, _fmt(lo + k * rng / 3, decimals), "end"))

    # 그룹 중앙(점선)
    if gb is not None:
        for run in _runs([None if v is None else (x(m), y(v)) for m, v in zip(minutes, gb.p50)]):
            if len(run) >= 2:
                parts.append(f'<path d="{_path(run)}" fill="none" stroke="{COLOR_GROUP}" stroke-dasharray="5 3" '
                             f'stroke-linejoin="round" stroke-width="1.8"/>')

    # 나의 매분 값(실선) — 결측 분은 선을 끊는다
    mine = series.norm if use_norm else series.values
    if mine is not None:
        for run in _runs([None if v is None else (x(m), y(v)) for m, v in zip(minutes, mine)]):
            if len(run) >= 2:
                parts.append(f'<path d="{_path(run)}" fill="none" stroke="{COLOR_ME}" stroke-linejoin="round" '
                             f'stroke-width="2.3"/>')
            else:
                parts.append(f'<circle cx="{_n(run[0][0])}" cy="{_n(run[0][1])}" r="1.8" fill="{COLOR_ME}"/>')

    # 구간 시작 분 + 마지막 분 눈금
    ticks = [s.start_min for s in segments] + [last_minute]
    for m in ticks:
        parts.append(_txt(x(m), 218, f"{m}분"))
    unit = series.axis_unit
    if series.value_transform == "log1p":
        unit = f"{unit} · 세로축 log(1+값)"
    parts.append(_txt(310, 239, f"{start_clock}부터 경과 시간 · {unit}"))

    # 나의 구간 중앙값(전 구간·후 구간 짧은 점선) — 값 척도가 있는 지표만
    if axis_ok and segments:
        for seg, xs, xe in (
            (segments[0], X0, x(segments[1].start_min) if len(segments) > 1 else X1),
            (segments[-1], x(segments[-1].start_min), X1),
        ):
            v = my_segment_values.get(seg.key)
            if v is not None:
                parts.append(f'<line stroke="{COLOR_GROUP}" stroke-dasharray="5 3" stroke-width="2" '
                             f'x1="{_n(xs)}" x2="{_n(xe)}" y1="{_n(y(v))}" y2="{_n(y(v))}"/>')
    parts.append("</svg>")
    return "".join(parts)


def distribution_svg(dist: Distribution, decimals: int, axis_unit: str,
                     aria_label: str = "같은 수업 분포와 나의 매분 히스토그램") -> str:
    """그룹 분포 곡선 + 나의 매분 히스토그램. 평균 라벨은 자기 선 바로 위(그룹 y13, 나 y36)."""
    t0, t1 = dist.axis_ticks[0], dist.axis_ticks[-1]
    rng = (t1 - t0) or 1.0

    def x(v: float) -> float:
        return max(X0, min(X1, X0 + (v - t0) / rng * (X1 - X0)))

    xg, xm = x(dist.mean_group), x(dist.mean_me)
    parts: list[str] = [
        f'<svg aria-label="{escape(aria_label)}" role="img" viewBox="0 0 620 242" '
        f'font-family="{FONT_FAMILY}" xmlns="http://www.w3.org/2000/svg">'
    ]
    # 평균 라벨 — 오른쪽 가장자리에서는 끝 정렬로 잘림 방지
    for xv, y_, label, color in ((xg, 13, f"그룹 평균 {_fmt(dist.mean_group, decimals)}", COLOR_GROUP),
                                 (xm, 36, f"나의 평균 {_fmt(dist.mean_me, decimals)}", COLOR_ME)):
        anchor = "end" if xv > 500 else "start"
        parts.append(_txt(xv, y_, label, anchor, color, ' data-mean-label="true"'))

    # 평균 ± 1SD 음영
    sx0, sx1 = x(dist.mean_group - dist.sd_group), x(dist.mean_group + dist.sd_group)
    parts.append(f'<rect fill="#E8EEE5" x="{_n(sx0)}" y="48" width="{_n(sx1 - sx0)}" height="150"/>')

    # 그룹 밀도 곡선
    n = len(dist.density)
    pts = ["46,198"]
    for i, d in enumerate(dist.density):
        px = X0 + i * (X1 - X0) / max(n - 1, 1)
        pts.append(f"{_n(px)},{_n(198 - max(0.0, min(1.0, d)) * 150)}")
    pts.append("586,198")
    parts.append(f'<polygon fill="#765B7A22" points="{" ".join(pts)}" stroke="{COLOR_GROUP}" stroke-width="1.8"/>')

    # 나의 매분 히스토그램 — 계약에는 구간 위치가 없어 나의 평균선 둘레에 연속 배치한다.
    bars = list(dist.my_bars)
    if bars:
        step, width = 22.5, 21.1
        total = sum(bars) or 1.0
        centroid = sum((i + 0.5) * step * b for i, b in enumerate(bars)) / total
        start = max(X0, min(X1 - step * len(bars), xm - centroid))
        for i, b in enumerate(bars):
            h = max(0.0, min(1.0, b)) * 150
            if h <= 0:
                continue
            parts.append(f'<rect fill="#47756B" fill-opacity=".12" stroke="{COLOR_ME}" stroke-width="1" rx="1" '
                         f'x="{_n(start + i * step)}" y="{_n(198 - h)}" width="{_n(width)}" height="{_n(h)}"/>')

    # 평균선(그룹=점선, 나=실선) + 기준선
    parts.append(f'<line stroke="{COLOR_GROUP}" stroke-dasharray="4 3" stroke-width="1.5" '
                 f'x1="{_n(xg)}" x2="{_n(xg)}" y1="43" y2="198"/>')
    parts.append(f'<line stroke="{COLOR_ME}" stroke-width="2" x1="{_n(xm)}" x2="{_n(xm)}" y1="43" y2="198"/>')
    parts.append(f'<line stroke="#A9B4A8" stroke-width="1" x1="46" x2="586" y1="198" y2="198"/>')
    for k, tv in enumerate(dist.axis_ticks):
        parts.append(_txt(X0 + k * (X1 - X0) / max(len(dist.axis_ticks) - 1, 1), 216, _fmt(tv, decimals)))
    parts.append(_txt(310, 237, axis_unit))
    parts.append("</svg>")
    return "".join(parts)


def reference_scale_svg(scale: ReferenceScale) -> str:
    """안정된 5분 참고 척도. ● 나, ▲ 같은 수업 안정된 5분 중앙, 진한 띠 = 문헌 참고 범위."""
    rng = (scale.axis_max - scale.axis_min) or 1.0
    tx0, tw = 22.0, 556.0

    def x(v: float) -> float:
        return tx0 + (min(max(v, scale.axis_min), scale.axis_max) - scale.axis_min) / rng * tw

    gid = f"grad-{scale.key}"
    xb0, xb1 = x(scale.band_lo), x(scale.band_hi)
    xv = x(scale.value)
    d = scale.decimals
    parts = [
        f'<svg aria-label="{escape(scale.title)} 안정 5분 참고 척도" role="img" viewBox="0 0 600 99" '
        f'font-family="{FONT_FAMILY}" xmlns="http://www.w3.org/2000/svg">',
        f'<defs><linearGradient id="{gid}"><stop offset="0" stop-color="#DFE7DB"/>'
        f'<stop offset=".5" stop-color="#AABB9E"/><stop offset="1" stop-color="#CAD8C2"/></linearGradient></defs>',
        f'<rect fill="url(#{gid})" x="22" y="32" width="556" height="17" rx="8"/>',
        f'<rect fill="{COLOR_GROUP}" opacity=".65" x="{_n(xb0)}" y="30" width="{_n(xb1 - xb0)}" height="21" rx="4"/>',
        f'<line stroke="{COLOR_ME}" stroke-width="2.3" x1="{_n(xv)}" x2="{_n(xv)}" y1="19" y2="54"/>',
        f'<circle cx="{_n(xv)}" cy="25" r="4.5" fill="{COLOR_ME}"/>',
    ]
    if scale.group_median is not None:
        xm = x(scale.group_median)
        parts.append(f'<path d="M{_n(xm - 5)},62 L{_n(xm + 5)},62 L{_n(xm)},53 Z" fill="{COLOR_GROUP}"/>')
    parts.append(_txt(22, 13, f"● 나 {_fmt(scale.value, d)} {scale.unit}", "start", COLOR_ME))
    if scale.group_median is not None:
        parts.append(_txt(578, 13, f"▲ 같은 수업 안정된 5분 중앙 {_fmt(scale.group_median, d)}", "end", COLOR_GROUP))
    parts.append(_txt(xb0, 79, _fmt(scale.band_lo, d)))
    parts.append(_txt(xb1, 79, _fmt(scale.band_hi, d)))
    parts.append(_txt(22, 96, _fmt(scale.axis_min, d), "start"))
    parts.append(_txt(578, 96, _fmt(scale.axis_max, d), "end"))
    parts.append("</svg>")
    return "".join(parts)
