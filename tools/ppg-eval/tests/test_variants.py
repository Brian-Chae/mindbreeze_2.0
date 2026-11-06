"""SDD-317 2단계: 변형이 의도한 부분만 바꾸는지, 변형 off 면 V0 와 동일한지 (verify-addendum-8)."""
import json
import math
import os

import numpy as np
import pytest

from ppg_eval import variants as V
from ppg_eval.ablation import EXPERIMENTS_PATH, paired_bootstrap, rec_vec, totals_stats, variant_list, load_registry
from ppg_eval.common import NULL_PENALTY


def synth(n=100, rr0=900.0, amp=45.0, f=0.25, seed=0):
    rng = np.random.default_rng(seed)
    t = 0.0
    rr, ts = [], []
    for _ in range(n):
        r = rr0 + amp * math.sin(2 * math.pi * f * t / 1000.0) + rng.normal(0, 5)
        t += r
        rr.append(r)
        ts.append(1000.0 + t)
    return rr, ts


def test_registry_params_all_known_and_v0_is_base():
    reg = load_registry()
    vl = variant_list(reg)
    assert vl[0][0] == "V0"
    assert V.merged(vl[0][1]) == V.BASE_PARAMS
    ids = [v[0] for v in vl]
    assert len(ids) == len(set(ids))
    judged = [v for v in vl[1:] if v[2]["judged"]]
    assert len(judged) == 6


def test_each_variant_changes_exactly_one_parameter():
    for vid, params, _m in variant_list(load_registry())[1:]:
        diff = {k: v for k, v in V.merged(params).items() if V.BASE_PARAMS[k] != v}
        assert len(diff) == 1, (vid, diff)


def test_unknown_param_rejected():
    with pytest.raises(KeyError):
        V.merged({"bogus": 1})


def test_core_end_nan_reproduced_in_v0_and_removed_by_hold():
    rr, ts = synth()
    xo, yo, _ = V.time_axis(rr, ts, "cumulative")
    keep = V.resample(xo, yo, "keep")
    hold = V.resample(xo, yo, "hold")
    trunc = V.resample(xo, yo, "truncate")
    assert np.isnan(keep).any()  # 코어: 마지막 구간 NaN
    assert not np.isnan(hold).any()
    assert not np.isnan(trunc).any()
    assert len(hold) == len(keep) and len(trunc) < len(keep)
    # NaN 이 아닌 점은 전부 동일(변형은 끝단만 바꾼다)
    fin = np.isfinite(keep)
    assert np.array_equal(keep[fin], hold[fin])
    # NaN 은 마지막 RR 시작(t[n-1]) 이후 점에만 있다
    xn = np.arange(len(keep)) / 4.0
    assert xn[np.isnan(keep)].min() > xo[len(yo) - 1] - 1e-9


def test_hold_equals_last_value():
    rr, ts = synth()
    xo, yo, _ = V.time_axis(rr, ts, "cumulative")
    hold = V.resample(xo, yo, "hold")
    xn = np.arange(len(hold)) / 4.0
    tail = hold[(xn > xo[len(yo) - 1]) & (xn < xo[-1])]
    assert len(tail) and np.allclose(tail, yo[-1])


def test_welch_nan_segment_counts_as_zero_in_denominator():
    # n=128 → 창 64, 보폭 32, 구간 시작 0/32/64 (3개). 마지막 5점 NaN 은 시작 64 구간에만 걸린다.
    rng = np.random.default_rng(3)
    x = rng.normal(size=128)
    y = x.copy()
    y[-5:] = np.nan
    _f, psd_nan = V.welch(y)
    # n=96 → 창 64, 구간 시작 0/32 (2개) = 앞의 두 구간의 평균. 코어는 NaN 구간을 0 으로 두고 분모 3 에 포함한다.
    _f, psd_two = V.welch(x[:96])
    assert np.allclose(psd_nan, psd_two * 2.0 / 3.0, rtol=1e-9, atol=1e-15)
    _f, psd_full = V.welch(x)
    assert psd_nan.sum() < psd_full.sum()


def test_real_time_axis_equals_cumulative_when_no_removal():
    rr, ts = synth(80)
    xo_c, _, fb_c = V.time_axis(rr, ts, "cumulative")
    xo_r, _, fb_r = V.time_axis(rr, ts, "real")
    assert not fb_c and not fb_r
    # 정제 제거가 없고 ts 가 rr 의 누적이면 두 축은 같다(오차 1e-9)
    assert np.allclose(xo_c, xo_r, atol=1e-9)


def test_real_time_axis_keeps_gap_where_beats_were_removed():
    rr, ts = synth(80)
    rr2 = rr[:40] + rr[44:]  # 박동 4개 제거
    ts2 = ts[:40] + ts[44:]
    xo_c, _, _ = V.time_axis(rr2, ts2, "cumulative")
    xo_r, _, _ = V.time_axis(rr2, ts2, "real")
    assert xo_r[-1] > xo_c[-1] + 2.0  # 실제 시간이 더 길다(압축 제거)


def test_real_time_axis_falls_back_when_not_monotone():
    rr = [900.0, 900.0, 900.0, 900.0]
    ts = [1000.0, 1900.0, 1850.0, 3700.0]  # 비단조
    xo, yo, fb = V.time_axis(rr, ts, "real")
    assert fb is True
    assert np.allclose(xo, np.concatenate([[0], np.cumsum(np.asarray(rr) / 1000.0)]))


def test_band_params_change_only_the_pick():
    rr, ts = synth(120, f=0.12)  # 7.2회/분: 0.15 이상 대역 밖
    key = V.spectrum_key(V.merged({}))
    st, freqs, psd, _ = V.spectrum(rr, ts, key)
    assert st == "ok"
    p0 = V.merged({})
    p2 = V.merged({"band_lo": 0.10})
    d0, _ = V.pick_peak(freqs, psd, p0, None)
    d2, _ = V.pick_peak(freqs, psd, p2, None)
    assert V.spectrum_key(p0) == V.spectrum_key(p2)  # 스펙트럼 공유
    assert d0 is not None and d0 >= 0.15
    assert d2 is not None and abs(d2 - 0.12) < 0.04
    p5 = V.merged({"band_hi": 0.5})
    assert V.pick_peak(freqs, psd, p5, None)[0] == d0 or V.pick_peak(freqs, psd, p5, None)[0] >= 0.15


def test_variant_off_is_identical_to_baseline():
    rr, ts = synth(120)
    a, b = V.VariantState("V0", {}), V.VariantState("Vx", dict(V.BASE_PARAMS))
    for k in range(70, len(rr)):
        cache: dict = {}
        a.calc(rr[: k + 1], ts[: k + 1], cache)
        b.calc(rr[: k + 1], ts[: k + 1], cache)
        assert a.resp == b.resp


def test_gate_and_median_of_five():
    rr, ts = synth(120)
    v = V.VariantState("V0", {})
    out = []
    for k in range(75, 120):
        v.calc(rr[: k + 1], ts[: k + 1], {})
        out.append(v.resp)
    assert out[0] is not None
    assert len(v.hist) <= 5
    assert all(r is None or 6.0 <= r <= 40.0 for r in out)
    # 60초 미만 입력은 게이트 실패
    short = V.VariantState("V0", {})
    short.calc(rr[:30], ts[:30], {})
    assert short.resp is None


def test_continuity_prefers_near_previous_peak_only_when_strong_enough():
    freqs = np.arange(0, 33) * 4.0 / 64
    psd = np.zeros_like(freqs)
    psd[8] = 10.0  # 0.5Hz 밖 -> band 제외용 아님; 대역 안에서 직접 구성
    freqs = np.linspace(0.0, 2.0, 201)
    psd = np.zeros(201)
    psd[30] = 10.0  # 0.30Hz 전체 최대
    psd[20] = 6.0  # 0.20Hz (직전 근처)
    p = V.merged({"peak": "continuity"})
    assert V.pick_peak(freqs, psd, p, 0.20)[0] == pytest.approx(0.20)
    psd[20] = 4.0  # 0.5×10 미만 → 전체 최대 유지
    assert V.pick_peak(freqs, psd, p, 0.20)[0] == pytest.approx(0.30)
    assert V.pick_peak(freqs, psd, p, None)[0] == pytest.approx(0.30)
    assert V.pick_peak(freqs, psd, V.merged({}), 0.20)[0] == pytest.approx(0.30)  # 연속성 off


def test_paired_bootstrap_identical_inputs_give_zero_diff_and_seeded():
    rng = np.random.default_rng(1)
    recs = []
    for _ in range(12):
        t = rng.uniform(10, 20, 30)
        c = t + rng.normal(0, 2, 30)
        c[rng.random(30) < 0.1] = np.nan
        recs.append(rec_vec(t, c))
    v = np.array(recs)
    r1 = paired_bootstrap(v, v, B=300)
    r2 = paired_bootstrap(v, v, B=300)
    assert r1 == r2
    assert r1["diff"]["mae"] == (0.0, 0.0)
    assert r1["diff"]["mae_pen"] == (0.0, 0.0)


def test_totals_stats_match_resp_stats():
    from ppg_eval.metrics import resp_stats

    t = np.array([10.0, 12.0, 14.0, 16.0])
    c = np.array([11.0, np.nan, 13.0, 20.0])
    s = totals_stats(rec_vec(t, c))
    r = resp_stats(t, c)
    assert s["mae"] == pytest.approx(r["mae"])
    assert s["coverage"] == pytest.approx(r["coverage"])
    assert s["mae_pen"] == pytest.approx(r["mae_pen"])
    assert s["bias"] == pytest.approx(r["bias"])
    assert NULL_PENALTY == 12.0


def test_paired_diff_detects_worse_variant():
    rng = np.random.default_rng(2)
    base, var = [], []
    for _ in range(15):
        t = rng.uniform(10, 20, 40)
        base.append(rec_vec(t, t + rng.normal(0, 1, 40)))
        var.append(rec_vec(t, t + rng.normal(0, 4, 40)))
    r = paired_bootstrap(np.array(var), np.array(base), B=400)
    assert r["diff"]["mae"][0] > 0


def test_experiments_json_is_prereg_frozen_flag():
    with open(EXPERIMENTS_PATH, encoding="utf-8") as f:
        reg = json.load(f)
    assert reg["frozen_before_any_variant_run"] is True
    assert reg["scope"]["holdout_access"] == "forbidden"
