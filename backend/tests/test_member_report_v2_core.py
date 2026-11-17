"""SDD-328 B1·B6 — v2 집계 코어 단위 테스트(독립 검산 포함). 검산은 순수 파이썬 statistics 로 따로 계산한다."""

import math
import random
import statistics as st

import pytest

from app.services import member_report_v2_core as core


def _rows(n, f):
    return {i: f(i) for i in range(n)}


def test_처음_마지막_5분_중앙값_인덱스():
    m = _rows(20, lambda i: float(i))
    a, b = core.first_window_idx()
    assert (a, b) == (2, 6)
    assert core.window_median(m, a, b) == 4.0  # 2..6 중앙값
    la, lb = core.last_window_idx(20)
    assert (la, lb) == (15, 19) and core.window_median(m, la, lb) == 17.0


def test_빈_분은_보간하지_않고_중앙값에서_빠진다():
    m = {2: 1.0, 4: 3.0, 6: 5.0}
    assert core.window_median(m, 2, 6) == 3.0
    assert core.window_median({}, 2, 6) is None


def test_상대변화_기준값_0이하_결측은_None():
    assert core.base_value({i: 0.0 for i in range(2, 7)}) is None
    assert core.base_value({i: -3.0 for i in range(2, 7)}) is None
    assert core.base_value({0: 5.0}) is None
    assert core.base_value({i: 10.0 for i in range(2, 7)}) == 10.0


def test_상대변화는_처음5분_기준_퍼센트():
    m = {i: 20.0 for i in range(2, 7)} | {7: 22.0, 8: 18.0}
    rel = core.to_relative(m, 20.0)
    assert rel[7] == pytest.approx(10.0) and rel[8] == pytest.approx(-10.0) and rel[3] == 0.0


def _quiet_inputs():
    motion = {i: 0.1 for i in range(30)}
    hr = {i: 70.0 for i in range(30)}
    return motion, hr


def test_편안한5분_무동률():
    motion, hr = _quiet_inputs()
    for i in range(10, 15):
        motion[i] = 0.02
    p = core.pick_quiet_window(motion, hr, 30)
    assert p is not None and p.start == 10


def test_편안한5분_1차_동률은_심박_중앙값_작은_쪽():
    motion, hr = _quiet_inputs()
    for i in list(range(5, 10)) + list(range(18, 23)):
        motion[i] = 0.02
    for i in range(18, 23):
        hr[i] = 60.0
    p = core.pick_quiet_window(motion, hr, 30)
    assert p is not None and p.start == 18


def test_편안한5분_2차_동률은_이른_시각():
    motion, hr = _quiet_inputs()
    for i in list(range(5, 10)) + list(range(18, 23)):
        motion[i] = 0.02
        hr[i] = 60.0
    p = core.pick_quiet_window(motion, hr, 30)
    assert p is not None and p.start == 5


def test_편안한5분_후보_0개와_첫2분_제외_결측창_제외():
    assert core.pick_quiet_window({}, {}, 30) is None
    motion, hr = _quiet_inputs()
    for i in range(0, 5):
        motion[i] = 0.0  # 인덱스 0~1(안착) 포함 창은 후보가 아니다
    p = core.pick_quiet_window(motion, hr, 30)
    assert p is not None and p.start >= 2
    motion2, hr2 = _quiet_inputs()
    for i in range(10, 15):
        motion2[i] = 0.01
    del hr2[12]  # 심박 결측 → 그 창 제외
    p2 = core.pick_quiet_window(motion2, hr2, 30)
    assert p2 is None or p2.start != 10


def test_시기_문구_경계():
    n = 60
    assert core.when_label(17, n) == "수업 초반에"  # 17 < 18
    assert core.when_label(18, n) == "수업 중간에"  # n*0.3
    assert core.when_label(41, n) == "수업 중간에"
    assert core.when_label(42, n) == "수업이 끝나갈 무렵"  # n*0.7


def test_그룹_평균_모집단SD_n_독립검산_그리고_n10미만은_None():
    random.seed(7)
    n = 12
    others = []
    for p in range(11):
        others.append({i: random.random() * 10 for i in range(n)})
    # 분 9 는 10명만, 분 10 은 9명만 유효
    del others[0][9]
    for p in (0, 1):
        del others[p][10]
    band = core.group_band(others, n, ndigits=9)
    assert band.mean[0] is None and band.mean[1] is None  # 안착 분
    for i in range(2, n):
        vals = [o[i] for o in others if i in o]
        assert band.n[i] == len(vals)
        if len(vals) >= 10:
            assert band.mean[i] == pytest.approx(st.fmean(vals), abs=1e-6)
            assert band.sd[i] == pytest.approx(st.pstdev(vals), abs=1e-6)  # ddof=0
        else:
            assert band.mean[i] is None and band.sd[i] is None
    assert band.n[10] == 9 and band.mean[10] is None and band.mean[9] is not None


def test_분포는_그룹_10명_미만이면_None_그리고_정규화():
    random.seed(3)
    mine = _rows(30, lambda i: 50 + random.random())
    few = [_rows(30, lambda i: 50 + random.random()) for _ in range(9)]
    assert core.distribution(mine, few, 30) is None
    many = few + [_rows(30, lambda i: 50 + random.random())]
    d = core.distribution(many[0], many[1:] + [mine], 30)
    assert d is not None and len(d.density) == core.KDE_GRID and len(d.my_bars) == core.HIST_BINS
    assert max(d.density + d.my_bars) == pytest.approx(1.0, abs=1e-3)
    assert d.n_people == 10
    g = [v for o in many[1:] + [mine] for i, v in o.items() if i >= 2]
    assert d.mean_group == pytest.approx(st.fmean(g), abs=1e-3)
    assert d.sd_group == pytest.approx(st.pstdev(g), abs=1e-3)


def test_LFHF_log1p_정규화는_0_1_범위():
    m = {i: 1.0 + (i % 5) * 0.2 for i in range(30)}
    norm = core.norm_series(core.log1p_series(m), 30)
    assert norm is not None and norm[0] is None and norm[1] is None
    assert all(0.0 <= v <= 1.0 for v in norm if v is not None)


def test_측정_길이는_마지막_유효_분():
    p = {"motion": {0: 1.0, 40: 2.0}, "heart_rate": {5: 70.0}}
    assert core.measured_length(p) == 41
    assert core.measured_length({}) == 0
    assert not math.isnan(core.valid_after_settle({5: 1.0}, 10))
