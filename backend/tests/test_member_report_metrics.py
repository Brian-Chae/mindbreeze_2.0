"""SDD-327 T1 — 회원 리포트 지표 집계 테스트(합성 윈도 + 시안 샘플 픽스처 재현)."""

import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import pytest

from app.schemas.member_report import MetricSeries
from app.services.member_report_metrics import (
    DEFAULT_SEGMENTS,
    build_effect_pairs,
    build_series,
    change_text,
    compute_change,
    person_minutes_from_windows,
    pick_stable_window,
    segment_values,
)

FIXTURE = Path(__file__).parent / "fixtures" / "member_report" / "member-report-sample.json"


@dataclass
class W:
    rel_sec: int
    quality: str = "valid"
    heart_rate: Optional[float] = None
    motion: Optional[float] = None
    rmssd: Optional[float] = None
    sdnn: Optional[float] = None
    lf_hf_ratio: Optional[float] = None
    focus_index: Optional[float] = None
    relaxation_index: Optional[float] = None
    emotional_stability: Optional[float] = None


def _fill(first: int, last: int, fn) -> dict[int, float]:
    return {m: fn(m) for m in range(first, last + 1)}


# ── 분 집계 ───────────────────────────────────────────────────────
def test_분_평균과_유효비율_50퍼센트_가드():
    ws = [W(rel_sec=s, heart_rate=60.0 + (s % 2) * 2) for s in range(60)]  # 0분: 평균 61
    ws += [W(rel_sec=60 + s, quality="invalid", heart_rate=99.0) for s in range(40)]  # 1분: 유효 20/60 → 제외
    ws += [W(rel_sec=60 + 40 + s, heart_rate=70.0) for s in range(20)]
    out = person_minutes_from_windows(ws)
    assert out["heart_rate"][0] == pytest.approx(61.0)
    assert 1 not in out["heart_rate"]  # 0으로 채우지 않고 통째로 빠진다


def test_결측값은_0으로_채우지_않는다():
    ws = [W(rel_sec=s, heart_rate=None, motion=0.1) for s in range(60)]
    out = person_minutes_from_windows(ws)
    assert out["heart_rate"] == {}
    assert out["motion"][0] == pytest.approx(0.1)


def test_마음지표_정규화_훅_적용과_None_결측():
    ws = [W(rel_sec=s, focus_index=2.0) for s in range(60)]
    out = person_minutes_from_windows(ws, mind_normalizer=lambda k, v: v * 10 if k == "focus" else None)
    assert out["focus"][0] == pytest.approx(20.0)
    out2 = person_minutes_from_windows(ws, mind_normalizer=lambda k, v: None)
    assert out2["focus"] == {}


def test_빈_입력():
    out = person_minutes_from_windows([])
    assert all(v == {} for v in out.values())


# ── 구간 중앙값·전후 변화 ─────────────────────────────────────────
def test_전후_변화량_중앙값_방향():
    hr = _fill(2, 63, lambda m: 75.0 if m <= 12 else (79.0 if m <= 31 else (60.0 if m <= 47 else 58.0)))
    ch = compute_change("heart_rate", hr)
    assert ch is not None
    assert (ch.before, ch.after, ch.delta, ch.direction) == (75.0, 58.0, -17.0, "down")
    assert ch.decimals == 1 and ch.unit == "회/분"


@pytest.mark.parametrize("after,expected", [(72.9, "stable"), (72.0, "down"), (78.0, "up"), (75.0, "stable")])
def test_심박_방향_임계_3bpm_경계(after, expected):
    hr = _fill(2, 63, lambda m: 75.0 if m <= 12 else after if m >= 48 else 70.0)
    ch = compute_change("heart_rate", hr)
    assert ch is not None and ch.direction == expected


def test_마음지표_변화율_5퍼센트_경계():
    ok = compute_change("focus", _fill(2, 63, lambda m: 50.0 if m <= 12 else 52.0 if m >= 48 else 51.0))
    assert ok is not None and ok.direction == "stable"  # 4%
    up = compute_change("focus", _fill(2, 63, lambda m: 50.0 if m <= 12 else 53.0 if m >= 48 else 51.0))
    assert up is not None and up.direction == "up"  # 6%


def test_유효_10분_미만이면_변화_None():
    short = _fill(2, 10, lambda m: 70.0)  # 9분
    assert compute_change("heart_rate", short) is None
    assert compute_change("heart_rate", {}) is None


def test_윈도우_1개_또는_후반_결측이면_None():
    assert compute_change("heart_rate", {5: 70.0}) is None
    only_prep = _fill(2, 12, lambda m: 70.0)  # 11분 유효하지만 후반 없음
    assert compute_change("heart_rate", only_prep) is None


def test_my_segments_결측_구간은_None():
    hr = _fill(2, 31, lambda m: 70.0)
    segs = {s.segment_key: s.value for s in segment_values(hr, DEFAULT_SEGMENTS, 1)}
    assert segs["prep"] == 70.0 and segs["first_half"] is None and segs["second_half"] is None


# ── 시계열 ────────────────────────────────────────────────────────
def test_시계열_길이_결측_None_유지():
    hr = {m: 70.0 for m in range(2, 64) if m != 10}
    s = build_series("heart_rate", hr, 2, 63)
    assert isinstance(s, MetricSeries)
    assert len(s.minutes) == 62 and s.values is not None and len(s.values) == 62
    assert s.values[10 - 2] is None
    assert s.norm is None and s.group_band is None
    assert s.axis_min is not None and s.axis_max is not None and s.axis_min < s.axis_max


def test_lf_hf_흐름전용_norm_0에서1_log1p():
    lf = {m: float(m % 5) for m in range(2, 64)}
    s = build_series("lf_hf", lf, 2, 63)
    assert s.values is None and s.norm is not None and s.value_transform == "log1p"
    assert s.group_band is None and s.axis_min is None
    present = [v for v in s.norm if v is not None]
    assert max(present) == pytest.approx(1.0) and min(present) >= 0.0


def test_lf_hf_전부_결측이면_norm_전부_None():
    s = build_series("lf_hf", {}, 2, 5)
    assert s.norm == [None] * 4


# ── 안정된 5분 ────────────────────────────────────────────────────
def test_안정된_5분_움직임_최소_창_선택():
    motion = {m: 0.05 for m in range(2, 64)}
    for m in range(52, 57):
        motion[m] = 0.001
    person = {
        "motion": motion, "heart_rate": {m: 60.0 for m in range(2, 64)},
        "rmssd": {m: float(m) for m in range(2, 64)}, "sdnn": {m: 40.0 for m in range(2, 64)},
    }
    w = pick_stable_window(person)
    assert w is not None
    assert w.start_min == 52 and w.window_label == "[52,57)"
    assert w.rmssd == 54.0 and w.sdnn == 40.0 and w.heart_rate == 60.0
    assert w.contaminated is False


def test_안정된_5분_동률이면_이른_창_움직임_크면_오염():
    person = {"motion": {m: 0.2 for m in range(2, 64)}, "heart_rate": {m: 60.0 for m in range(2, 64)}}
    w = pick_stable_window(person)
    assert w is not None and w.start_min == 33 and w.contaminated is True  # 명상 전반 시작부터 탐색


def test_안정된_5분_데이터_부족이면_None():
    assert pick_stable_window({}) is None
    sparse = {"motion": {40: 0.0, 50: 0.0}, "heart_rate": {40: 60.0, 50: 60.0}}
    assert pick_stable_window(sparse) is None


# ── 히어로 4쌍 ────────────────────────────────────────────────────
def test_변화_문구():
    assert change_text(-17.0, "down", 1) == "↓ 17.0 감소"
    assert change_text(14.3, "up", 1) == "↑ 14.3 상승"
    assert change_text(-0.02, "down", 3) == "↓ 0.020 감소"


def test_히어로_쌍_결측_지표는_빠진다():
    ch = {"heart_rate": compute_change("heart_rate", _fill(2, 63, lambda m: 75.0 if m <= 12 else 58.0)),
          "relaxation": None, "motion": None, "focus": None}
    pairs = build_effect_pairs(ch)
    assert [p.key for p in pairs] == ["heart_rate"]
    assert pairs[0].tone == "calm" and pairs[0].before == "75.0" and pairs[0].after == "58.0"
    assert build_effect_pairs({}) == []


# ── 시안 샘플 재현 ────────────────────────────────────────────────
def _fx():
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


@pytest.mark.parametrize("key", ["motion", "heart_rate", "rmssd", "focus", "relaxation", "emotional_balance"])
def test_시안_샘플_구간중앙값과_전후값_재현(key):
    d = _fx()
    body = d["metrics"][key]["body"]
    s = body["series"]
    minutes = {m: v for m, v in zip(s["minutes"], s["values"]) if v is not None}
    first, last = d["meta"]["first_minute"], d["meta"]["last_minute"]
    segs = tuple(type(DEFAULT_SEGMENTS[0])(**x) for x in d["meta"]["segments"])
    dec = body["change"]["decimals"]

    mine = {x.segment_key: x.value for x in segment_values(minutes, segs, dec)}
    expect = {x["segment_key"]: x["value"] for x in body["my_segments"]}
    for k, v in expect.items():
        assert mine[k] == pytest.approx(v, abs=10 ** -dec), (key, k)

    ch = compute_change(key, minutes, segs, first, last)
    assert ch is not None
    assert ch.before == pytest.approx(body["change"]["before"], abs=10 ** -dec)
    assert ch.after == pytest.approx(body["change"]["after"], abs=10 ** -dec)
    assert ch.direction == body["change"]["direction"]


def test_시안_샘플_히어로_4쌍_재현():
    d = _fx()
    first, last = d["meta"]["first_minute"], d["meta"]["last_minute"]
    segs = tuple(type(DEFAULT_SEGMENTS[0])(**x) for x in d["meta"]["segments"])
    changes = {}
    for key in ("heart_rate", "relaxation", "motion", "focus"):
        s = d["metrics"][key]["body"]["series"]
        minutes = {m: v for m, v in zip(s["minutes"], s["values"]) if v is not None}
        changes[key] = compute_change(key, minutes, segs, first, last)
    got = build_effect_pairs(changes)
    assert [g.key for g in got] == [e["key"] for e in d["hero"]["pairs"]]
    for g, e in zip(got, d["hero"]["pairs"]):
        # 샘플 시계열은 소수 4자리로 저장돼 중앙값이 반올림 경계(예 78.745)에 걸리면 표시값이 마지막 자리에서
        # 1 단위 어긋날 수 있다 → 키·방향·톤은 정확히, 수치는 표시 자릿수 ±1 단위로 대조한다.
        tol = 10 ** -len(e["before"].split(".")[-1]) * 1.01
        assert (g.direction, g.tone) == (e["direction"], e["tone"])
        assert float(g.before) == pytest.approx(float(e["before"]), abs=tol)
        assert float(g.after) == pytest.approx(float(e["after"]), abs=tol)
    exact = [g for g in got if g.key in ("heart_rate", "motion")]
    for g in exact:  # 심박·움직임은 경계에 걸리지 않아 문구까지 완전 일치
        e = next(x for x in d["hero"]["pairs"] if x["key"] == g.key)
        assert (g.before, g.after, g.change_text) == (e["before"], e["after"], e["change_text"])


def test_시안_샘플_lf_hf_norm은_값_범위_0에서_1():
    s = _fx()["metrics"]["lf_hf"]["body"]["series"]
    assert all(v is None or 0.0 <= v <= 1.0 for v in s["norm"])
    assert not math.isnan(sum(v for v in s["norm"] if v is not None))
