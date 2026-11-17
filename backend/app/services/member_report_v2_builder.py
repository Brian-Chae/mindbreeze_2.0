"""SDD-328 B3 — 회원 리포트 v2(`member_report.v2`) 조립기. AI 호출 없음(문장은 `member_report_v2_wording` 규칙).

- 순수 부분 `assemble_member_report_v2()`: 분 시계열(PersonMinutes)과 메타 → 계약 dict. DB 없이 테스트한다.
- DB 부분 `build_member_report_v2()`: v1 빌더의 로더(`_load_roster/_load_windows/_to_person_minutes`)를 재사용한다.

시간 기준
- 내부 분 인덱스 i 는 0부터(표기 분 = i+1). 회원의 **첫 유효 분을 0 으로 다시 맞춘다**(늦게 입장해도 안착 2분·처음 5분이
  본인 측정 시작 기준). 그룹 값도 같은 수만큼 옮겨 같은 수업 시각끼리 비교한다.
- 안착 제외 = 인덱스 0·1, 처음 5분 = 2~6, 마지막 5분 = n-5~n-1 (n = 마지막 유효 분 인덱스+1).
"""

from __future__ import annotations

import logging
import math
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

from app.schemas.member_report import Segment
from app.schemas.member_report_v2 import (
    MIN_GROUP_N,
    MIN_VALID_MINUTES,
    SETTLE_MINUTES,
    WINDOW_MINUTES,
    MemberReportV2,
)
from app.services import member_report_v2_core as core
from app.services import member_report_v2_wording as W
from app.services.member_report_metrics import Minutes, PersonMinutes

logger = logging.getLogger(__name__)

KEYS = ("motion", "heart_rate", "rmssd", "lf_hf", "focus", "relaxation", "emotional_balance")
ALL_KEYS = (*KEYS, "aperiodic")
LINEAR = ("motion", "heart_rate", "focus", "relaxation", "emotional_balance")
VALUE_ROUND = 3


# ── 입력 ──────────────────────────────────────────────────────────
@dataclass
class ApInput:
    """뇌파 1/f 입력(원시 EEG 가 있을 때만). first·last 는 처음/마지막 5분 지수, tiles 는 {분 인덱스: 지수}."""

    first: Optional[float] = None
    last: Optional[float] = None
    tiles: Minutes = field(default_factory=dict)
    reason: str = "no_raw"  # first/last 가 없을 때 결측 사유


@dataclass
class ReportInputs:
    program: str  # 프로그램 이름(회차 제외)
    program_label: str  # 회차 포함 라벨
    member_code: str
    session_date: str  # YYYY-MM-DD
    start_clock: str  # HH:MM
    issued_on: str  # YYYY-MM-DD
    person: PersonMinutes  # 회원 본인(첫 유효 분이 0 으로 맞춰진 상태)
    others: list[PersonMinutes]  # 본인 제외 그룹(같은 수만큼 옮겨진 상태)
    worn: bool = True
    ap: Optional[ApInput] = None


def rebase(person: PersonMinutes, shift: int) -> PersonMinutes:
    """모든 분 인덱스에서 shift 를 뺀다(음수 인덱스는 버린다)."""
    return {k: {i - shift: v for i, v in ms.items() if i - shift >= 0} for k, ms in person.items()}


def first_valid_index(person: PersonMinutes) -> Optional[int]:
    idx = [i for ms in person.values() for i, v in ms.items() if core.is_num(v)]
    return min(idx) if idx else None


# ── 작은 도우미 ───────────────────────────────────────────────────
def _label(a: int, b: int) -> str:
    return f"{a + 1}~{b + 1}분"


def _r(v: Optional[float], d: int) -> Optional[float]:
    return None if v is None else round(float(v), d)


def _series_values(minutes: Minutes, n: int) -> list[Optional[float]]:
    return [(_r(minutes.get(i), VALUE_ROUND) if i >= SETTLE_MINUTES and core.is_num(minutes.get(i)) else None)
            for i in range(n)]


def _group_views(key: str, others: list[PersonMinutes], base: Optional[float]) -> list[Minutes]:
    views = [o.get(key, {}) for o in others]
    if key == "rmssd" and base is not None:
        views = [core.to_relative(v, base) for v in views]
    return views


def _missing(key: str, reason: str) -> dict:
    return {"key": key, "title": W.TITLE[key], "chapter": W.CHAPTER[key], "state": "missing",
            "missing_reason": reason, "body": None}


def _section(key: str, body: dict) -> dict:
    return {"key": key, "title": W.TITLE[key], "chapter": W.CHAPTER[key], "state": "ok", "missing_reason": None,
            "body": body}


def _eyebrow(key: str) -> str:
    return f"{'몸의 변화' if W.CHAPTER[key] == 'body' else '마음의 변화'} / {W.TITLE[key]}"


def _series_dict(minutes: list[int], values: Optional[list], norm: Optional[list], transform: str,
                 axis: Optional[tuple[float, float]], unit: str, band: Optional[core.BandData]) -> dict:
    return {
        "minutes": minutes, "values": values, "norm": norm, "value_transform": transform,
        "axis_min": axis[0] if axis else None, "axis_max": axis[1] if axis else None, "axis_unit": unit,
        "settle_shade": True,
        "group_band": None if band is None else {"mean": band.mean, "sd": band.sd, "n": band.n},
    }


def _group_block(key: str, dist: core.DistData) -> dict:
    return {
        "title": W.GROUP_TITLE, "paragraphs": W.group_paragraphs(dist.n_people),
        "distribution": {
            "lo": dist.lo, "hi": dist.hi, "axis_ticks": dist.axis_ticks, "mean_me": dist.mean_me,
            "mean_group": dist.mean_group, "sd_group": dist.sd_group, "n_people": dist.n_people,
            "n_person_minutes": dist.n_person_minutes, "my_minutes": dist.my_minutes,
            "density": dist.density, "my_bars": dist.my_bars},
        "legend": W.GROUP_LEGEND, "footnote": W.FOOT_REL_AXIS if key == "rmssd" else None}


# ── 지표 하나 ─────────────────────────────────────────────────────
@dataclass
class _Metric:
    section: dict
    before: Optional[float] = None
    after: Optional[float] = None
    delta: Optional[float] = None
    direction: Optional[str] = None
    pct: Optional[float] = None
    sentence: Optional[str] = None
    quiet: Optional[float] = None


def _linear_metric(key: str, mine: Minutes, others: list[PersonMinutes], n: int, quiet_idx: Optional[int],
                   short: bool) -> _Metric:
    if core.valid_after_settle(mine, n) == 0 or (not short and core.valid_after_settle(mine, n) < MIN_VALID_MINUTES):
        return _Metric(_missing(key, "poor_signal"))
    d = W.DECIMALS[key]
    group_views = _group_views(key, others, None)
    mine_view = {i: float(v) for i, v in mine.items() if core.is_num(v)}
    band = core.group_band(group_views, n)
    dist = core.distribution(mine_view, group_views, n) if band.any_shown else None
    show_group = band.any_shown and dist is not None
    band_out = band if show_group else None
    axis = core.axis_range([mine_view[i] for i in mine_view if SETTLE_MINUTES <= i < n], band_out)
    series = _series_dict(list(range(1, n + 1)), _series_values(mine, n), None, "linear", axis, W.UNIT[key], band_out)
    group_fields = {"group": _group_block(key, dist) if show_group and dist else None,
                    "group_hidden_reason": None if show_group else "min_n"}
    foot = W.FOOT_GROUP if show_group else W.FOOT_NO_GROUP
    reading = W.READING_STD if show_group else W.READING_NO_GROUP
    legend = W.SERIES_LEGEND if show_group else W.SERIES_LEGEND_NO_GROUP

    if short:
        vals = [float(v) for i, v in mine_view.items() if SETTLE_MINUTES <= i < n]
        mean = round(sum(vals) / len(vals), d)
        sentence = f"{W.TITLE[key]}{'가' if W.CHAPTER[key] == 'body' else '는'} 안착 이후 평균 {W.fmt(key, mean)}" \
                   f"{'' if W.UNIT[key] == '지표' else ' ' + W.UNIT[key]}였어요."
        body = {"eyebrow": _eyebrow(key), "conclusion": sentence, "bridge": None, "comparison_text": None,
                "first": None, "last": None, "quiet": None, "change": None, "overall_mean": mean, "decimals": d,
                "series": series, "series_legend": legend, "interpret": W.EXPLAIN[key], "reading": reading,
                "companion": None, "footnote": foot, **group_fields}
        return _Metric(_section(key, body), sentence=sentence)

    fa, fb = core.first_window_idx()
    la, lb = core.last_window_idx(n)
    first, last = core.window_median(mine, fa, fb), core.window_median(mine, la, lb)
    if first is None or last is None:
        return _Metric(_missing(key, "poor_signal"))
    before, after = round(first, d), round(last, d)
    delta = round(after - before, d)
    direction = W.direction_abs(key, delta)
    sentence = W.change_sentence(key, "abs", direction, delta=delta)
    quiet = _r(core.window_median(mine, quiet_idx, quiet_idx + WINDOW_MINUTES - 1), d) if quiet_idx is not None else None
    body = {"eyebrow": _eyebrow(key), "conclusion": sentence, "bridge": W.bridge(_label(fa, fb), _label(la, lb)),
            "comparison_text": W.comparison_text(key, "abs", before, after, None), "first": before, "last": after,
            "quiet": quiet,
            "change": {"kind": "abs", "direction": direction, "label": W.TITLE[key], "unit": W.UNIT[key],
                       "decimals": d, "before": before, "after": after, "delta": delta, "pct": None},
            "overall_mean": None, "decimals": None, "series": series, "series_legend": legend,
            "interpret": W.EXPLAIN[key], "reading": reading, "companion": None, "footnote": foot, **group_fields}
    return _Metric(_section(key, body), before, after, delta, direction, None, sentence, quiet)


def _rmssd_metric(mine: Minutes, others: list[PersonMinutes], n: int, quiet_idx: Optional[int], short: bool) -> _Metric:
    key = "rmssd"
    if core.valid_after_settle(mine, n) == 0 or (not short and core.valid_after_settle(mine, n) < MIN_VALID_MINUTES):
        return _Metric(_missing(key, "poor_signal"))
    base = core.base_value(mine)
    if base is None:  # 기준값 결측·0 이하 → 상대 변화를 만들 수 없다
        return _Metric(_missing(key, "poor_signal"))
    rel = core.to_relative(mine, base)
    group_views = _group_views(key, others, base)
    band = core.group_band(group_views, n, ndigits=3)
    dist = core.distribution(rel, group_views, n) if band.any_shown else None
    show_group = band.any_shown and dist is not None
    band_out = band if show_group else None
    axis = core.axis_range([rel[i] for i in rel if SETTLE_MINUTES <= i < n], band_out)
    series = _series_dict(list(range(1, n + 1)), _series_values(rel, n), None, "pct_vs_first5", axis, "%", band_out)
    group_fields = {"group": _group_block(key, dist) if show_group and dist else None,
                    "group_hidden_reason": None if show_group else "min_n"}
    reading = W.READING_STD if show_group else W.READING_NO_GROUP
    legend = W.SERIES_LEGEND if show_group else W.SERIES_LEGEND_NO_GROUP

    if short:
        sentence = "심장 리듬의 여유는 짧은 측정이라 처음과 마지막을 비교하지 않았어요."
        body = {"eyebrow": _eyebrow(key), "conclusion": sentence, "bridge": None, "comparison_text": None,
                "first": None, "last": None, "quiet": None, "change": None, "overall_mean": None,
                "decimals": None, "series": series, "series_legend": legend, "interpret": W.EXPLAIN[key],
                "reading": reading, "companion": None, "footnote": W.FOOT_RMSSD, **group_fields}
        return _Metric(_section(key, body), sentence=sentence)

    fa, fb = core.first_window_idx()
    la, lb = core.last_window_idx(n)
    last = core.window_median(rel, la, lb)
    if last is None:
        return _Metric(_missing(key, "poor_signal"))
    pct = round(last, 2)
    direction = W.direction_pct(pct)
    sentence = W.change_sentence(key, "pct", direction, pct=pct)
    quiet = _r(core.window_median(rel, quiet_idx, quiet_idx + WINDOW_MINUTES - 1), 2) if quiet_idx is not None else None
    body = {"eyebrow": _eyebrow(key), "conclusion": sentence, "bridge": W.bridge(_label(fa, fb), _label(la, lb)),
            "comparison_text": W.comparison_text(key, "pct", None, None, pct), "first": 0.0, "last": pct,
            "quiet": quiet,
            "change": {"kind": "pct", "direction": direction, "label": W.TITLE[key], "unit": "%", "decimals": 1,
                       "before": None, "after": None, "delta": None, "pct": pct},
            "overall_mean": None, "decimals": None, "series": series, "series_legend": legend,
            "interpret": W.EXPLAIN[key], "reading": reading, "companion": None, "footnote": W.FOOT_RMSSD,
            **group_fields}
    return _Metric(_section(key, body), 0.0, pct, None, direction, pct, sentence, quiet)


def _lf_hf_metric(mine: Minutes, n: int, short: bool, hr_sentence: Optional[str],
                  relax_sentence: Optional[str]) -> _Metric:
    key = "lf_hf"
    if core.valid_after_settle(mine, n) == 0 or (not short and core.valid_after_settle(mine, n) < MIN_VALID_MINUTES):
        return _Metric(_missing(key, "poor_signal"))
    logs = core.log1p_series(mine)
    norm = core.norm_series(logs, n)
    if norm is None:
        return _Metric(_missing(key, "poor_signal"))
    series = _series_dict(list(range(1, n + 1)), None, norm, "log1p", None, W.UNIT[key], None)
    common = {"eyebrow": _eyebrow(key), "series": series, "series_legend": W.SERIES_LEGEND_LF,
              "interpret": W.EXPLAIN[key], "reading": W.READING_LF, "group": None, "group_hidden_reason": None,
              "footnote": W.FOOT_LF}
    comp = {"title": "다른 신호와 함께 읽어요", "body": W.companion_body(hr_sentence, relax_sentence)}
    if short:
        sentence = "긴장과 휴식의 균형은 짧은 측정이라 흐름만 보여 드려요."
        body = {**common, "conclusion": sentence, "bridge": None, "comparison_text": None, "first": None,
                "last": None, "quiet": None, "change": None, "overall_mean": None, "decimals": None,
                "companion": comp}
        return _Metric(_section(key, body), sentence=sentence)
    fa, fb = core.first_window_idx()
    la, lb = core.last_window_idx(n)
    b, a = core.window_median(logs, fa, fb), core.window_median(logs, la, lb)
    if b is None or a is None:
        return _Metric(_missing(key, "poor_signal"))
    direction = W.direction_flow(b, a)
    sentence = W.change_sentence(key, "flow", direction)
    body = {**common, "conclusion": sentence, "bridge": W.bridge(_label(fa, fb), _label(la, lb)),
            "comparison_text": W.comparison_text(key, "flow", None, None, None), "first": None, "last": None,
            "quiet": None,
            "change": {"kind": "flow", "direction": direction, "label": W.TITLE[key], "unit": "방향", "decimals": 2,
                       "before": round(b, 3), "after": round(a, 3), "delta": None, "pct": None},
            "overall_mean": None, "decimals": None, "companion": comp}
    return _Metric(_section(key, body), sentence=sentence)


def _aperiodic_metric(ap: Optional[ApInput], n: int, short: bool) -> dict:
    key = "aperiodic"
    if short:
        return _missing(key, "insufficient_window")
    if ap is None or ap.first is None or ap.last is None:
        reason = ap.reason if ap is not None and ap.reason in ("no_raw", "insufficient_window", "poor_fit") else "no_raw"
        return _missing(key, reason)
    d = 2
    before, after = round(ap.first, d), round(ap.last, d)
    delta = round(after - before, d)
    direction = W.direction_abs(key, delta) if key in W.DECIMALS else "stable"
    sentence = W.change_sentence(key, "abs", direction, delta=delta)
    tiles = {i: v for i, v in ap.tiles.items() if SETTLE_MINUTES <= i < n}
    axis = core.axis_range(list(tiles.values()), None)
    fa, fb = core.first_window_idx()
    la, lb = core.last_window_idx(n)
    body = {"eyebrow": _eyebrow(key), "conclusion": sentence, "bridge": W.bridge(_label(fa, fb), _label(la, lb)),
            "comparison_text": f"처음 5분 → 마지막 5분 · {before:.{d}f} → {after:.{d}f}", "first": before,
            "last": after, "quiet": None,
            "change": {"kind": "abs", "direction": direction, "label": W.TITLE[key], "unit": "지표", "decimals": d,
                       "before": before, "after": after, "delta": delta, "pct": None},
            "overall_mean": None, "decimals": None,
            "series": _series_dict(list(range(1, n + 1)), _series_values(tiles, n), None, "linear", axis, "지표", None),
            "series_legend": W.SERIES_LEGEND_NO_GROUP, "interpret": W.EXPLAIN[key], "reading": W.READING_NO_GROUP,
            "group": None, "group_hidden_reason": None, "companion": None,
            "footnote": "원시 뇌파에서 다시 계산하고 신호 기준을 통과한 5분 단위 값만 보여요. 그룹 비교는 만들지 않아요."}
    return _section(key, body)


# ── 조립 ──────────────────────────────────────────────────────────
def assemble_member_report_v2(inp: ReportInputs) -> dict:
    """분 시계열 → `member_report.v2` 계약 dict(검증·금지어 검사 통과). 실패하면 예외."""
    person = inp.person
    n = core.measured_length(person) if inp.worn else 0
    worn = inp.worn and n > 0
    after_settle = max((core.valid_after_settle(person.get(k, {}), n) for k in KEYS), default=0) if worn else 0
    worn = worn and after_settle > 0
    short = worn and after_settle < MIN_VALID_MINUTES
    group_people = sum(1 for o in inp.others if any(core.valid_after_settle(ms, n) for ms in o.values())) if worn else 0

    fw, lw = (core.first_window_idx(), core.last_window_idx(n)) if worn and not short else (None, None)
    first_label = _label(*fw) if fw else None
    last_label = _label(*lw) if lw else None

    metrics: dict[str, dict] = {}
    quiet_pick: Optional[core.QuietPick] = None
    ms: dict[str, _Metric] = {}
    if not worn:
        metrics = {k: _missing(k, "band_not_worn") for k in ALL_KEYS}
    else:
        if not short:
            quiet_pick = core.pick_quiet_window(person.get("motion", {}), person.get("heart_rate", {}), n)
        qi = quiet_pick.start if quiet_pick else None
        for key in LINEAR:
            ms[key] = _linear_metric(key, person.get(key, {}), inp.others, n, qi, short)
        ms["rmssd"] = _rmssd_metric(person.get("rmssd", {}), inp.others, n, qi, short)
        ms["lf_hf"] = _lf_hf_metric(person.get("lf_hf", {}), n, short,
                                    ms["heart_rate"].sentence if ms["heart_rate"].direction else None,
                                    ms["relaxation"].sentence if ms["relaxation"].direction else None)
        metrics = {k: ms[k].section for k in KEYS}
        metrics["aperiodic"] = _aperiodic_metric(inp.ap, n, short)

    def ok(k: str) -> bool:
        return metrics.get(k, {}).get("state") == "ok"

    def sent(k: str) -> Optional[str]:
        return ms[k].sentence if k in ms and ms[k].direction else None

    # 가장 편안했던 5분
    quiet5: Optional[dict] = None
    qtitle: Optional[str] = None
    if quiet_pick is not None and worn and not short:
        qs, qe = quiet_pick.start, quiet_pick.start + WINDOW_MINUTES - 1
        when = core.when_label(quiet_pick.start, n)
        qtitle = W.quiet_title(when, qs + 1, qe + 1)
        hr_first = ms["heart_rate"].before if ok("heart_rate") else None
        hr_q = round(quiet_pick.hr_median, 2)
        dh = round(quiet_pick.hr_median - hr_first, 2) if hr_first is not None else None
        items = [W.quiet_item_hr(hr_q, dh)]
        deltas = {"heart_rate": dh, "rmssd_pct": None, "sdnn_pct": None}
        for key in ("rmssd", "sdnn"):
            minutes = person.get(key, {})
            base = core.base_value(minutes)
            pct = None
            if base is not None:
                v = core.window_median(core.to_relative(minutes, base), qs, qe)
                pct = None if v is None else round(v, 2)
            if pct is not None:
                deltas["rmssd_pct" if key == "rmssd" else "sdnn_pct"] = pct
                items.append(W.quiet_item_pct(key, pct))
        quiet5 = {"start_min": qs + 1, "end_min": qe + 1, "when_label": when, "eyebrow": "03 / 가장 편안했던 5분",
                  "title": qtitle, "note": W.QUIET_NOTE, "hr_median": hr_q, "deltas": deltas, "items": items,
                  "reading_title": W.FEEL_TITLE, "reading_body": W.FEEL_BODY}

    # 히어로
    pairs: list[dict] = []
    if worn and not short:
        for key in ("heart_rate", "relaxation", "motion", "focus"):
            m = ms.get(key)
            if m is None or m.direction is None or m.before is None:
                continue
            name, unit = W.pair_meta(key)
            d = W.DECIMALS[key]
            pairs.append({"key": key, "name": name, "unit": unit, "before": f"{m.before:.{d}f}",
                          "after": f"{m.after:.{d}f}", "change_text": W.pair_change_text(m.delta or 0.0, m.direction, d),
                          "direction": m.direction, "tone": W.pair_tone(key, m.direction)})
    caution = " ".join(s for s in (sent("emotional_balance"), sent("rmssd")) if s) or None
    hero = {
        "kicker": f"{inp.program} · 나의 변화",
        "headline": W.hero_headline(ms["heart_rate"].direction if "heart_rate" in ms else None,
                                    ms["relaxation"].direction if "relaxation" in ms else None, worn, short),
        "lead": W.hero_lead(worn, short),
        "pair_caption_before": f"처음 · {first_label}" if pairs else None,
        "pair_caption_after": f"마지막 · {last_label}" if pairs else None,
        "pairs": pairs, "caution": caution if pairs else None, "other_directions": None,
        "quiet_highlight": {"text": qtitle, "note": W.QUIET_NOTE} if qtitle else None,
        "note": (W.SETTLE_NOTE if worn and not short else (W.SETTLE_NOTE.split(" 수업 전후")[0] + " " + W.SHORT_NOTE)
                 if short else None),
    }

    # 종합 의견
    cross = (core.calm_cross_minutes(person.get("heart_rate", {}), person.get("relaxation", {}), n)
             if worn and not short else 0)
    rel_q = ms["relaxation"].quiet if "relaxation" in ms else None
    obs = (W.observations(sent("heart_rate"), sent("relaxation"), sent("emotional_balance"), sent("rmssd"), cross,
                          qtitle, round(quiet_pick.hr_median, 1) if quiet_pick else None, rel_q)
           if worn and not short else [])
    chart_keys = [k for k in ("heart_rate", "relaxation") if ok(k)]
    opinion = {
        "narrative": {"eyebrow": "01 / 종합 의견", "title": "오늘의 관찰 3가지" if obs else "오늘의 기록",
                      "body": ("오늘 수업에서 눈에 띈 몸과 마음의 흐름을 세 가지로 모았어요." if obs else
                               ("밴드 기록이 없어 수업 참여 기록만 담았어요." if not worn else
                                "측정 시간이 짧아 안착 이후 평균과 흐름만 담았어요.")), "source": "rule"},
        "observations": obs, "interpret_title": "기록과 느낌을 나란히",
        "interpret_body": ("숫자는 수업 중 몸과 마음이 보인 흐름이에요. 더 편안했다고 느낀 순간과 맞았는지, 또는 달랐는지 "
                           "자신의 말로 남겨 주세요."),
        "chart_keys": chart_keys, "legend_note": W.SERIES_LEGEND.split(" · 회색")[0] if chart_keys else "",
        "footnote": None}

    # 여정
    journey: Optional[dict] = None
    if worn:
        timeline: list[dict] = []
        if not short and ok("heart_rate"):
            hrm = ms["heart_rate"]
            timeline += [{"label": f"처음 5분 · {first_label}", "value": f"{hrm.before:.1f}회/분"},
                         {"label": f"마지막 5분 · {last_label}", "value": f"{hrm.after:.1f}회/분"}]
        if quiet_pick is not None:
            timeline.append({"label": "가장 편안했던 5분",
                             "value": f"{quiet_pick.start + 1}~{quiet_pick.start + WINDOW_MINUTES}분 · 움직임으로 찾은 후보"})
        jkeys = [k for k in ("motion", "heart_rate", "relaxation") if ok(k)]
        journey = {
            "eyebrow": "02 / 수업 여정",
            "title": "처음의 나에서,\n수업을 마친 나까지" if not short else "짧은 시간의 몸과 마음을 담았어요",
            "timeline": timeline, "chart_keys": jkeys,
            "legend_note": ("━ 나 · ┄ 그룹 평균 / 띠: 그룹 평균 ±1 표준편차 · 회색: 밴드 안착 2분 · 유효 인원 10명 이상인 분만 "
                            "띠를 표시해요."),
            "interpret_title": qtitle or "가장 편안했던 5분은 고르지 못했어요",
            "interpret_body": W.QUIET_NOTE if qtitle else "움직임과 심장 기록이 함께 있는 연속 5분이 있을 때 찾아 드려요."}

    # 메타·표지
    meta_basis = ("수업 참여 기록" if not worn else
                  f"측정 {n}분 · 측정 시간이 짧아 전후 비교 없음" if short else
                  f"처음 5분({first_label}) → 마지막 5분({last_label})")
    group_n = group_people if worn and group_people else None
    d_issue = datetime.strptime(inp.issued_on, "%Y-%m-%d")
    meta = {
        "member_code": inp.member_code, "program_label": inp.program_label,
        "chapter_label": f"章 1 · {inp.program_label} · {inp.session_date[5:]}", "session_date": inp.session_date,
        "start_clock": inp.start_clock,
        "device_text": "LINK BAND 2.0 · 뇌파 · 이마 맥파" if worn else "LINK BAND 미착용", "basis_text": meta_basis,
        "reference_group_text": f"같은 수업 {group_n}명 · 회원님 제외" if group_n else None,
        "issued_on": inp.issued_on, "volume_label": "VOLUME 01", "band_status": "worn" if worn else "not_worn",
        "settle_minutes": SETTLE_MINUTES, "first_minute": 1, "last_minute": n, "valid_minutes": after_settle,
        "first_window": {"start": fw[0] + 1, "end": fw[1] + 1} if fw else None,
        "last_window": {"start": lw[0] + 1, "end": lw[1] + 1} if lw else None,
        "short_measure": bool(short), "group_n": group_n}
    rows = [("프로그램", inp.program_label), ("측정일", inp.session_date), ("측정 장비", meta["device_text"]),
            ("비교 기준", meta_basis)]
    if group_n:
        rows.append(("함께한 기록", f"{group_n + 1}명 · 그룹 계산은 회원님 제외"))
    cover = {"kicker": f"PERSONAL RHYTHM REPORT / {d_issue:%Y.%m}", "title": "마음·몸\n리듬 리포트",
             "tagline": "처음의 나와,\n수업을 마친 나를 만나요.", "rows": rows, "brand": "MIND BREEZE · Looxid Labs",
             "footer": "한 번의 수업에서 관찰한 몸과 마음의 기록이에요.", "issued_note": f"발행일 {d_issue:%Y.%m.%d}"}
    toc = {"heading": "내가 머문 시간들", "chapter_title": inp.program_label, "chapter_subtitle": "오늘의 한 장을 펼쳐 봅니다.",
           "next_chapter_note": "", "guide": "CONTENTS"}
    next_steps = {"eyebrow": "05 / 다음 걸음", "title": "오늘의 변화를,\n다음 만남으로 이어가요",
                  "body": ("이번 기록은 한 번의 수업에서 관찰한 변화예요. 같은 조건에서 다시 살펴보면 나만의 흐름을 조금 더 "
                           "알아갈 수 있어요."),
                  "items": W.next_step_items(sent("heart_rate"), sent("relaxation"), sent("emotional_balance"))}
    memo = {"eyebrow": "A NOTE TO MYSELF", "title": "오늘의 나에게 남기는 말",
            "prompt": "수업에서 기억에 남는 순간을, 나의 말로 적어 보세요.",
            "labels": ["몸에 남은 감각", "마음에 머문 장면", "다음 수업까지 이어가고 싶은 것"]}
    method = {"eyebrow": "06 / 측정·분석 안내", "title": "숫자의 의미는,\n측정 조건과 함께 읽어요",
              "body": W.method_body(first_label, last_label), "reading_title": "기록을 읽을 때",
              "paragraphs": W.method_paragraphs(group_n, short or not worn), "footnote": W.METHOD_FOOTNOTE,
              "references_title": "참고문헌", "references": [{"text": t} for t in W.METHOD_REFS],
              "references_checked": "문헌 확인: 2026.11.13", "contact_title": "문의",
              "contact_body": "리포트에 관한 질문은 프로그램 담당자에게 전달해 주세요. 문의: 담당 클래스 코치"}
    back = {"kicker": "TO BE CONTINUED", "title": "다음 시간에도,\n나의 속도로.",
            "subtitle": "다음 장은 다음 수업 뒤에 이어집니다.", "brand": "MIND BREEZE · Looxid Labs",
            "note": f"발행일 {d_issue:%Y.%m.%d}", "contact": "문의: 담당 클래스 코치"}

    report = {"schema_version": "member_report.v2", "meta": meta, "cover": cover, "toc": toc, "hero": hero,
              "opinion": opinion, "journey": journey, "quiet5": quiet5, "metrics": metrics, "next_steps": next_steps,
              "memo": memo, "method": method, "back": back, "forbidden_words_checked": True}
    model = MemberReportV2.model_validate(report)
    out = model.model_dump(mode="json")
    W.clean_check(out)
    return out


# ── DB 연결 ───────────────────────────────────────────────────────
def _ap_input(db, sid, pid, base_ms: float, shift: int, n: int, raw_reader) -> ApInput:
    """원시 EEG 로 처음/마지막 5분과 5분 타일 1/f 를 만든다(v1 의 산출 함수 재사용). 실패해도 예외를 올리지 않는다."""
    from app.services import member_report_builder as v1

    fa, fb = core.first_window_idx()
    la, lb = core.last_window_idx(n)
    segs = [Segment(key="prep", label="처음 5분", start_min=fa + shift, end_min=fb + shift),
            Segment(key="second_half", label="마지막 5분", start_min=la + shift, end_min=lb + shift)]
    res = v1.compute_aperiodic_parts(db, sid, pid, base_ms, segs, shift, shift + n - 1, raw_reader)
    pre, late = res.by_segment.get("prep"), res.by_segment.get("second_half")
    tiles = {i - shift: v for i, v in res.tiles.items() if i - shift >= 0}
    for r in (pre, late):
        if r is None or r.state != "ok" or r.exponent is None:
            return ApInput(None, None, tiles, (r.missing_reason if r is not None else None) or "no_raw")
    return ApInput(float(pre.exponent), float(late.exponent), tiles)  # type: ignore[union-attr]


def build_member_report_v2(db, session_id: uuid.UUID | str, participant_id: uuid.UUID | str, raw_reader=None) -> dict:
    """회원 한 명의 v2 리포트(`MemberReportV2` 계약 dict). 저장은 호출자(report_task)가 한다."""
    from app.models.class_program import Class
    from app.services import member_report_builder as v1

    sid = session_id if isinstance(session_id, uuid.UUID) else uuid.UUID(str(session_id))
    pid = participant_id if isinstance(participant_id, uuid.UUID) else uuid.UUID(str(participant_id))
    roster = v1._load_roster(db, sid, pid)
    session = roster.session
    by_pid = v1._load_windows(db, sid, [pid, *[r.id for r in roster.others]])

    if session.started_at is not None:
        base_sec = math.floor(v1._utc(session.started_at).timestamp())
    else:
        all_ms = [m for rows in by_pid.values() for r in rows if (m := v1._ms_of(r)) is not None]
        base_sec = math.floor(min(all_ms) / 1000) if all_ms else 0

    normalizer = v1.make_mind_normalizer(db)
    mine_rows = by_pid.get(pid, [])
    person_abs = v1._to_person_minutes(mine_rows, base_sec, normalizer)
    # EEG 유효 창이 하나도 없으면(포화·평탄) 미착용으로 본다 — v1 과 같은 착용 판정.
    worn = any(r.quality != "invalid" for r in mine_rows)
    shift = first_valid_index(person_abs)
    worn = worn and shift is not None
    shift = shift or 0
    person = rebase(person_abs, shift)
    others = [rebase(v1._to_person_minutes(by_pid.get(r.id, []), base_sec, normalizer), shift) for r in roster.others]

    program = session.title or "명상 수업"
    if getattr(session, "class_id", None):
        cls_row = db.get(Class, session.class_id)
        if cls_row is not None and cls_row.title:
            program = cls_row.title
    seq = getattr(session, "seq", None)
    ref = session.started_at or session.scheduled_at
    local = v1._utc(ref).astimezone(v1.KST) if ref is not None else datetime.now(v1.KST)
    ap = None
    n = core.measured_length(person)
    if worn and n - 0 >= MIN_VALID_MINUTES + SETTLE_MINUTES:
        ap = _ap_input(db, sid, pid, base_sec * 1000.0, shift, n, raw_reader)
    inp = ReportInputs(
        program=program, program_label=f"{program} {seq}회차" if seq else program,
        member_code=f"B{seq or 1}-{roster.me_ordinal}", session_date=f"{local:%Y-%m-%d}", start_clock=f"{local:%H:%M}",
        issued_on=f"{datetime.now(v1.KST):%Y-%m-%d}", person=person, others=others, worn=worn, ap=ap)
    logger.info("[member_report_v2] session=%s 시작 보정=%s분 길이=%s분 그룹=%s명", sid, shift, n, len(others))
    return assemble_member_report_v2(inp)


__all__ = ["ApInput", "ReportInputs", "assemble_member_report_v2", "build_member_report_v2", "rebase"]
_ = MIN_GROUP_N  # 계약 상수 재노출 확인용
