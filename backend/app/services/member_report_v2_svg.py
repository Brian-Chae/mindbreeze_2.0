"""SDD-328 B4 — v2 책(PDF)용 SVG. 안착 2분 회색 배경, 그룹 평균 ±1SD 띠 + 평균 점선, 나의 매분 선, 분포(히스토그램+KDE).

JS 없음·서버 렌더. 좌표계는 v1(`member_report_svg.py`)과 같은 viewBox 620x242 를 쓴다.
"""

from __future__ import annotations

from html import escape
from typing import Optional, Sequence

from app.schemas.member_report_v2 import SETTLE_MINUTES, DistributionV2, SeriesV2

COLOR_ME = "#24564F"
COLOR_GROUP = "#817286"
COLOR_TEXT = "#4D5F57"
COLOR_GRID = "#D7DED5"
COLOR_SETTLE = "#E4E4E4"
FONT_SIZE = 12
FONT_FAMILY = "BookSans, BookSerif"
X0, X1 = 46.0, 586.0
TOP, BASE = 44.0, 200.0
H = BASE - TOP


def _n(v: float) -> str:
    return f"{v:.2f}"


def _txt(x: float, y: float, text: str, anchor: str = "middle", fill: str = COLOR_TEXT, extra: str = "") -> str:
    return (f'<text fill="{fill}" font-size="{FONT_SIZE}" text-anchor="{anchor}" x="{_n(x)}" y="{_n(y)}"{extra}>'
            f'{escape(text)}</text>')


def _runs(points: Sequence[Optional[tuple[float, float]]]) -> list[list[tuple[float, float]]]:
    out: list[list[tuple[float, float]]] = []
    cur: list[tuple[float, float]] = []
    for p in points:
        if p is None:
            if cur:
                out.append(cur)
            cur = []
        else:
            cur.append(p)
    if cur:
        out.append(cur)
    return out


def _path(pts: Sequence[tuple[float, float]]) -> str:
    return " ".join(("M" if i == 0 else "L") + f"{_n(x)},{_n(y)}" for i, (x, y) in enumerate(pts))


def time_series_svg_v2(series: SeriesV2, decimals: int, start_clock: str,
                       aria_label: str = "시간에 따른 나의 흐름") -> str:
    """분 단위 시간 그래프. 값이 없는 분은 선을 끊고, 유효 인원 10명 미만인 분은 평균·띠를 그리지 않는다."""
    minutes = series.minutes
    n = len(minutes)
    first_m, last_m = (minutes[0], minutes[-1]) if minutes else (1, 1)
    span = max(last_m - first_m, 1)
    use_norm = series.values is None
    lo = series.axis_min if (not use_norm and series.axis_min is not None) else 0.0
    hi = series.axis_max if (not use_norm and series.axis_max is not None) else 1.0
    rng = (hi - lo) or 1.0
    # 분은 표기(1부터) 이므로 첫 분의 중심 = X0, 마지막 분 = X1.

    def x(m: float) -> float:
        return X0 + (m - first_m) / span * (X1 - X0)

    def y(v: float) -> float:
        h = (v - lo) / rng if not use_norm else v
        return max(TOP, min(BASE, BASE - h * H))

    parts = [f'<svg aria-label="{escape(aria_label)}" role="img" viewBox="0 0 620 242" font-family="{FONT_FAMILY}" '
             f'xmlns="http://www.w3.org/2000/svg">']
    if series.settle_shade and n:
        w = x(first_m + SETTLE_MINUTES) - X0
        parts.append(f'<rect fill="{COLOR_SETTLE}" x="{_n(X0)}" y="{_n(TOP)}" width="{_n(w)}" height="{_n(H)}" '
                     f'data-settle="true"/>')
    gb = series.group_band
    if gb is not None:
        top = [None if (m is None or s is None) else (x(mn), y(m + s)) for mn, m, s in zip(minutes, gb.mean, gb.sd)]
        bot = [None if (m is None or s is None) else (x(mn), y(m - s)) for mn, m, s in zip(minutes, gb.mean, gb.sd)]
        i = 0
        while i < n:
            if top[i] is None:
                i += 1
                continue
            j = i
            while j < n and top[j] is not None:
                j += 1
            run_t = [p for p in top[i:j] if p]
            run_b = [p for p in bot[i:j] if p]
            if len(run_t) >= 2:
                pts = [f"{_n(px)},{_n(py)}" for px, py in run_t] + [f"{_n(px)},{_n(py)}" for px, py in reversed(run_b)]
                parts.append(f'<polygon fill="#CBC7D2" opacity=".6" points="{" ".join(pts)}"/>')
            i = j
    for k in range(4):
        gy = BASE - k * H / 3
        parts.append(f'<line stroke="{COLOR_GRID}" stroke-width="0.7" x1="{_n(X0)}" x2="{_n(X1)}" y1="{_n(gy)}" y2="{_n(gy)}"/>')
        if not use_norm and series.axis_min is not None and series.axis_max is not None:
            parts.append(_txt(40, gy + 4, f"{lo + k * rng / 3:.{decimals}f}", "end"))
    if gb is not None:
        for run in _runs([None if v is None else (x(m), y(v)) for m, v in zip(minutes, gb.mean)]):
            if len(run) >= 2:
                parts.append(f'<path d="{_path(run)}" fill="none" stroke="{COLOR_GROUP}" stroke-dasharray="5 4" '
                             f'stroke-linejoin="round" stroke-width="1.8"/>')
    mine = series.norm if use_norm else series.values
    if mine is not None:
        for run in _runs([None if v is None else (x(m), y(v)) for m, v in zip(minutes, mine)]):
            if len(run) >= 2:
                parts.append(f'<path d="{_path(run)}" fill="none" stroke="{COLOR_ME}" stroke-linejoin="round" stroke-width="2.3"/>')
            else:
                parts.append(f'<circle cx="{_n(run[0][0])}" cy="{_n(run[0][1])}" r="1.8" fill="{COLOR_ME}"/>')
    ticks = sorted({first_m, minutes[n // 4] if n else first_m, minutes[n // 2] if n else first_m,
                    minutes[(3 * n) // 4] if n else first_m, last_m})
    for m in ticks:
        parts.append(_txt(x(m), 218, f"{m}분"))
    unit = series.axis_unit + (" · 세로축 log(1+값)" if series.value_transform == "log1p" else "")
    parts.append(_txt(310, 239, f"{start_clock}부터 경과 시간 · {unit}"))
    parts.append("</svg>")
    return "".join(parts)


def distribution_svg_v2(dist: DistributionV2, decimals: int, axis_unit: str,
                        aria_label: str = "같은 수업 분포와 나의 매분 히스토그램") -> str:
    """나의 매분 히스토그램(막대) + 그룹 매분 KDE 곡선 + 평균선(나 실선/그룹 점선) + 그룹 ±1SD 음영."""
    lo, hi = dist.lo, dist.hi
    rng = (hi - lo) or 1.0

    def x(v: float) -> float:
        return max(X0, min(X1, X0 + (v - lo) / rng * (X1 - X0)))

    xg, xm = x(dist.mean_group), x(dist.mean_me)
    parts = [f'<svg aria-label="{escape(aria_label)}" role="img" viewBox="0 0 620 242" font-family="{FONT_FAMILY}" '
             f'xmlns="http://www.w3.org/2000/svg">']
    for xv, yy, label, color in ((xg, 13, f"그룹 평균 {dist.mean_group:.{decimals}f}", COLOR_GROUP),
                                 (xm, 36, f"나의 평균 {dist.mean_me:.{decimals}f}", COLOR_ME)):
        parts.append(_txt(xv, yy, label, "end" if xv > 500 else "start", color, ' data-mean-label="true"'))
    s0, s1 = x(dist.mean_group - dist.sd_group), x(dist.mean_group + dist.sd_group)
    parts.append(f'<rect fill="#E1DEDF" x="{_n(s0)}" y="48" width="{_n(s1 - s0)}" height="150" data-sd-band="true"/>')
    bars = list(dist.my_bars)
    if bars:
        bw = (X1 - X0) / len(bars)
        for j, b in enumerate(bars):
            h = max(0.0, min(1.0, b)) * 150
            if h > 0:
                parts.append(f'<rect fill="{COLOR_ME}" fill-opacity=".4" x="{_n(X0 + j * bw)}" y="{_n(198 - h)}" '
                             f'width="{_n(bw - 1)}" height="{_n(h)}"/>')
    d = list(dist.density)
    if d:
        pts = " ".join(f"{_n(X0 + i * (X1 - X0) / max(len(d) - 1, 1))},{_n(198 - max(0.0, min(1.0, v)) * 150)}"
                       for i, v in enumerate(d))
        parts.append(f'<polyline fill="none" stroke="{COLOR_GROUP}" stroke-width="1.6" points="{pts}"/>')
    parts.append(f'<line stroke="{COLOR_GROUP}" stroke-dasharray="5 3" stroke-width="1.5" x1="{_n(xg)}" x2="{_n(xg)}" y1="43" y2="198"/>')
    parts.append(f'<line stroke="{COLOR_ME}" stroke-width="2" x1="{_n(xm)}" x2="{_n(xm)}" y1="43" y2="198"/>')
    parts.append('<line stroke="#A9B4A8" stroke-width="1" x1="46" x2="586" y1="198" y2="198"/>')
    ticks = dist.axis_ticks
    for k, tv in enumerate(ticks):
        parts.append(_txt(X0 + k * (X1 - X0) / max(len(ticks) - 1, 1), 216, f"{tv:.{decimals}f}"))
    parts.append(_txt(310, 237, axis_unit))
    parts.append("</svg>")
    return "".join(parts)
