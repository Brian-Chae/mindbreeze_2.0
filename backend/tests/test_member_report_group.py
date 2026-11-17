"""SDD-327 T2 — 그룹 분포 집계 + 최소 인원 가드 테스트(합성 데이터)."""

import json
import random

import pytest

from app.schemas.member_report import MIN_BAND_N, MIN_GROUP_N, GroupBlock, MetricSeries
from app.services.member_report_group import (
    GRID_POINTS,
    compute_band,
    compute_group,
    stable_group_stats,
    valid_people,
)
from app.services.member_report_metrics import DEFAULT_SEGMENTS, StableWindow

FIRST, LAST = 2, 63


def _person(seed: int, base: float = 70.0, minutes=range(FIRST, LAST + 1)):
    rnd = random.Random(seed)
    return {m: base + rnd.gauss(0, 5) for m in minutes}


def _crowd(n: int, **kw):
    return {f"p{i}": _person(i, **kw) for i in range(n)}


def test_유효_인원_9명이면_그룹_None_10명이면_산출():
    mine = _person(999)
    assert compute_group("heart_rate", mine, _crowd(MIN_GROUP_N - 2), FIRST, LAST) is None  # 나 포함 9
    res = compute_group("heart_rate", mine, _crowd(MIN_GROUP_N - 1), FIRST, LAST)  # 나 포함 10
    assert res is not None and res.n_valid == MIN_GROUP_N
    assert res.distribution.n_people == MIN_GROUP_N


def test_유효_10분_미만_참여자는_인원에서_제외():
    mine = _person(999)
    crowd = _crowd(MIN_GROUP_N - 2)
    crowd["short1"] = _person(1, minutes=range(2, 11))  # 9분
    crowd["short2"] = {}
    assert compute_group("heart_rate", mine, crowd, FIRST, LAST) is None
    assert set(valid_people(crowd, FIRST, LAST)) == {f"p{i}" for i in range(MIN_GROUP_N - 2)}


def test_내가_유효하지_않으면_None():
    assert compute_group("heart_rate", _person(1, minutes=range(2, 8)), _crowd(20), FIRST, LAST) is None


def test_lf_hf는_항상_그룹_없음():
    assert compute_group("lf_hf", _person(1), _crowd(20), FIRST, LAST) is None


def test_분포_정규화_0에서_1_길이_격자():
    res = compute_group("heart_rate", _person(999), _crowd(25), FIRST, LAST)
    assert res is not None
    d = res.distribution
    assert len(d.density) == GRID_POINTS and len(d.axis_ticks) == 5
    assert all(0.0 <= v <= 1.0 for v in d.density) and all(0.0 <= v <= 1.0 for v in d.my_bars)
    assert d.my_minutes == LAST - FIRST + 1
    assert d.n_person_minutes == 26 * (LAST - FIRST + 1)
    assert d.sd_group > 0 and d.axis_ticks == sorted(d.axis_ticks)
    assert d.axis_ticks[0] >= 0.0


def test_평균_산출_정확():
    mine = {m: 60.0 for m in range(FIRST, LAST + 1)}
    others = {f"p{i}": {m: 80.0 for m in range(FIRST, LAST + 1)} for i in range(9)}
    res = compute_group("heart_rate", mine, others, FIRST, LAST)
    assert res is not None
    assert res.distribution.mean_me == pytest.approx(60.0)
    assert res.distribution.mean_group == pytest.approx((60 + 9 * 80) / 10)


def test_매분_띠_인원_5명_미만이면_그_분_전부_None():
    mine = _person(999)
    crowd = _crowd(12)
    for k in list(crowd)[: len(crowd)]:
        # 10~12분은 4명(나 포함 5명→ 나 제외 3명만 남기고 모두 제거해 총 4명으로)
        pass
    keep = {"p0", "p1", "p2"}
    for k, m in crowd.items():
        if k not in keep:
            for minute in (10, 11, 12):
                m.pop(minute, None)
    mine.pop(11, None)  # 11분: 3명 → None / 10·12분: 4명 → None도 아닌 경계 확인용
    res = compute_group("heart_rate", mine, crowd, FIRST, LAST)
    assert res is not None
    band = res.band
    idx11 = 11 - FIRST
    for arr in (band.p10, band.p25, band.p50, band.p75, band.p90):
        assert arr[idx11] is None
        assert arr[20 - FIRST] is not None
        assert len(arr) == LAST - FIRST + 1


def test_띠_경계_정확히_5명이면_값_4명이면_None():
    five = {f"p{i}": {10: 60.0 + i} for i in range(MIN_BAND_N)}
    four = {f"p{i}": {10: 60.0 + i} for i in range(MIN_BAND_N - 1)}
    assert compute_band(five, 10, 10).p50 == [62.0]
    b4 = compute_band(four, 10, 10)
    assert b4.p10 == b4.p25 == b4.p50 == b4.p75 == b4.p90 == [None]


def test_구간_비교행_그룹값은_인원_10명_미만_구간이면_None():
    mine = _person(999)
    crowd = _crowd(12)
    for k, m in crowd.items():
        if k not in ("p0", "p1", "p2"):  # 후반 구간 측정자 3명 + 나 = 4명뿐
            for minute in range(48, 64):
                m.pop(minute, None)
    res = compute_group("heart_rate", mine, crowd, FIRST, LAST, DEFAULT_SEGMENTS)
    assert res is not None
    by = {r.segment_key: r for r in res.rows}
    assert by["second_half"].group is None and by["second_half"].diff is None
    assert by["second_half"].mine is not None
    assert by["prep"].group is not None and by["prep"].diff == pytest.approx(by["prep"].mine - by["prep"].group, abs=0.11)
    assert by["prep"].compared_minutes == 11


def test_응답에_타_회원_키나_개별_값_없음():
    mine = _person(999)
    res = compute_group("heart_rate", mine, _crowd(20), FIRST, LAST)
    assert res is not None
    blob = json.dumps({"d": res.distribution.model_dump(), "r": [r.model_dump() for r in res.rows],
                       "b": res.band.model_dump()})
    assert "p0" not in blob and "__me__" not in blob


def test_계약_스키마_조립_가능():
    res = compute_group("heart_rate", _person(999), _crowd(20), FIRST, LAST)
    assert res is not None
    xs = list(range(FIRST, LAST + 1))
    MetricSeries(minutes=xs, values=[70.0] * len(xs), axis_unit="회/분", group_band=res.band)
    GroupBlock(title="t", explain="e", distribution=res.distribution, rows=res.rows, table_note="n", legend="l")


def test_안정된_5분_그룹_중앙값과_오염_제외_및_최소_인원():
    def sw(hr, cont=False):
        return StableWindow(48, "[48,53)", hr, 30.0, 40.0, 0.0, cont)

    ok = [sw(60.0 + i) for i in range(MIN_GROUP_N)] + [sw(200.0, cont=True)]
    med, n = stable_group_stats("heart_rate", ok)
    assert n == MIN_GROUP_N and med == 64.5  # 오염 1명은 제외
    assert stable_group_stats("heart_rate", ok[: MIN_GROUP_N - 1]) == (None, None)
    assert stable_group_stats("rmssd", [None, None]) == (None, None)
