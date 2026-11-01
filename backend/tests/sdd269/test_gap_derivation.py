"""SDD-269 — 결측 구간 파생 순수 함수 시험 (V-R01~R12). 실측 회차 fbb7ee46 모양 fixture 포함."""
import pytest

from app.services import gap_derivation as gd

T0 = 1_000_000.0


def win(i, ms=None, q0=False, group="g"):
    return gd.WindowPoint(group, i, T0 + i * 1000 if ms is None else ms, q0)


def seq(rng, q0_set=(), skip=()):
    return [win(i, q0=i in q0_set) for i in rng if i not in skip]


def spans(gaps):
    return [(int((g.start_ms - T0) / 1000), int((g.end_ms - T0) / 1000)) for g in gaps]


def test_R01_품질0_연속3():
    g = gd.derive_gaps(seq(range(80, 92), q0_set={85, 86, 87}), [])
    assert spans(g) == [(85, 88)] and g[0].length_ms == 3000 and g[0].reason == "signal_lost"


def test_R02_정상1창_사이는_별개_구간():
    g = gd.derive_gaps(seq(range(88, 102), q0_set={90, 91, 92, 93, 94, 95, 97, 98, 99}), [])
    assert spans(g) == [(90, 96), (97, 100)]


def test_R03_간격_11_73초():
    w = seq(range(95, 102)) + [win(102, T0 + 101_000 + 11_730)]
    g = gd.derive_gaps(w, [])
    assert len(g) == 1 and g[0].length_ms == pytest.approx(10_730) and g[0].reason == "unknown"
    assert g[0].start_ms == T0 + 102_000  # 시작 = 이전 창(101) 시각 + 1초


def test_R04_간격_3_97초_포함_2초_제외():
    long_gap = [win(1, T0), win(2, T0 + 3970)]
    assert len(gd.derive_gaps(long_gap, [])) == 1 and gd.derive_gaps(long_gap, [])[0].length_ms == pytest.approx(2970)
    short = [win(1, T0), win(2, T0 + 2000)]  # 결측 1.0초 → 최소 길이 미만
    assert gd.derive_gaps(short, []) == []


def test_R05_결번과_시간간격_병합():
    w = [win(1, T0), win(2, T0 + 1000), win(6, T0 + 6000)]
    g = gd.derive_gaps(w, [])
    assert len(g) == 1 and g[0].reasons == {gd.R_INDEX, gd.R_TIME} and g[0].length_ms == 4000


def test_R06_segment_사이_5초():
    g = gd.derive_gaps([], [gd.SegmentSpan(T0, T0 + 10_000), gd.SegmentSpan(T0 + 15_000, T0 + 20_000)])
    assert len(g) == 1 and g[0].length_ms == 5000 and gd.R_SEGMENT in g[0].reasons


def test_R06b_겹치는_segment는_결측_아님():
    assert gd.derive_gaps([], [gd.SegmentSpan(0, 10_000), gd.SegmentSpan(9_000, 20_000)]) == []


def test_R07_품질0과_간격_병합_signal_lost():
    w = seq(range(1, 4), q0_set={3}) + [win(8, T0 + 8000)]
    g = gd.derive_gaps(w, [])
    assert len(g) == 1 and g[0].reasons >= {gd.R_QUALITY, gd.R_TIME} and g[0].reason == "signal_lost"
    assert spans(g) == [(3, 8)]


@pytest.mark.parametrize("ms,kept", [(1999, False), (2000, True)])
def test_R08_최소길이_경계(ms, kept):
    g = gd.derive_gaps([], [gd.SegmentSpan(0, 1000), gd.SegmentSpan(1000 + ms, 9000)])
    assert (len(g) == 1) is kept


def test_R09_창_0개_1개():
    assert gd.derive_gaps([], []) == []
    assert gd.derive_gaps([win(1)], []) == []


def test_R10_그룹_리셋은_결번_아님():
    w = [win(0, T0, group="a"), win(1, T0 + 1000, group="a"), win(0, T0 + 2000, group="b"), win(1, T0 + 3000, group="b")]
    assert gd.derive_gaps(w, []) == []


def test_R11_기록구간과_겹치면_기록_우선():
    derived = [(0.0, 10_000.0, frozenset({gd.R_TIME}))]
    assert gd.subtract_recorded(derived, [(0.0, 10_000.0)]) == []
    left = gd.subtract_recorded(derived, [(0.0, 6_000.0)])
    assert left == [(6_000.0, 10_000.0, frozenset({gd.R_TIME}))]
    assert gd.subtract_recorded(derived, [(0.0, 9_000.0)]) == []  # 남은 1초 < 최소 길이


def test_R12_시각_NULL_창은_품질규칙만():
    w = [gd.WindowPoint("g", 1, None, False), gd.WindowPoint("g", 2, None, True), gd.WindowPoint("g", 3, T0, False)]
    assert gd.derive_gaps(w, []) == []


def test_실측_회차_모양_통합():
    """fbb7ee46 모양: 85~87, 90~95, 97~99 품질0 + 101→102 간격 11.73초."""
    q0 = {85, 86, 87, 90, 91, 92, 93, 94, 95, 97, 98, 99}
    w = seq(range(80, 102), q0_set=q0) + [win(102, T0 + 101_000 + 11_730)] + [win(103, T0 + 101_000 + 12_730)]
    g = gd.derive_gaps(w, [])
    assert [(round((x.start_ms - T0) / 1000, 2), round(x.length_ms / 1000, 2)) for x in g] == [
        (85.0, 3.0), (90.0, 6.0), (97.0, 3.0), (102.0, 10.73)]
