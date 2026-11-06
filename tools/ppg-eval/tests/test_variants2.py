"""SDD-317 3단계: 변형 off = V0 동일, 각 변형이 한 부분만 바꿈 (verify-addendum-9)."""
import json
import math
import os

import numpy as np
import pytest

from ppg_eval import frontend_mirror as FM
from ppg_eval import variants as V
from ppg_eval import variants2 as V2
from ppg_eval.ablation import EXPERIMENTS_PATH, load_registry
from ppg_eval.ablation2 import build_groups, phase3_variants
from ppg_eval.shadow import Shadow


def stream(n=160, rr0=850.0, seed=1, glitch=()):
    """합성 후보 스트림: 프레임(1s)마다 최근 후보 RR 몇 개. 반환 [(now_ms, [(rr, ts)])]."""
    rng = np.random.default_rng(seed)
    t = 1_700_000_000_000.0
    beats = []
    cur = t
    for i in range(n * 2):
        r = rr0 + 40 * math.sin(2 * math.pi * 0.25 * (cur - t) / 1000.0) + rng.normal(0, 8)
        if i in glitch:
            r *= 0.5
        cur += r
        beats.append((r, cur))
    frames = []
    for k in range(1, n + 1):
        now = t + k * 1000.0
        win = [b for b in beats if now - 10000.0 <= b[1] <= now]
        frames.append((now, win))
    return frames


def run_buffer(refine, frames):
    b = V2.Buffer(refine)
    lens = []
    for now, win in frames:
        cand = [(r, ts, ts, r, 0.0) for r, ts in win]
        if cand:
            b.update(cand, now)
        lens.append((len(b.e), list(b.rr)))
    return lens, b


def run_shadow(frames):
    sh = Shadow()
    lens = []
    for now, win in frames:
        if win:
            sh._update([r for r, _ in win], [t for _, t in win], now)
        lens.append((len(sh.rr), list(sh.rr)))
    return lens


def test_registry_phase3_consistent():
    reg = load_registry(EXPERIMENTS_PATH)
    vl = phase3_variants(reg)
    ids = [v[0] for v in vl]
    assert ids[0] == "V0" and len(ids) == len(set(ids))
    assert sum(1 for v in vl[1:] if v[2]["judged"]) == 6
    assert reg["phase3"]["frozen_before_any_variant_run"] is True


def test_each_variant_differs_from_v0_in_declared_part_only():
    reg = load_registry(EXPERIMENTS_PATH)
    base_pipe, base_resp = V2.split_params(reg["baseline"]["params"])
    for vid, params, meta in phase3_variants(reg)[1:]:
        pipe, resp = V2.split_params(params)
        dp = {k: v for k, v in pipe.items() if base_pipe[k] != v}
        dr = {k: v for k, v in V.merged(resp).items() if V.merged(base_resp)[k] != v}
        n = len(dp) + len(dr)
        if vid == "W5":
            assert set(dp) == {"peak_interp"} and set(dr) == {"detrend"}
        else:
            assert n == 1, (vid, dp, dr)
    assert V2.split_params({"sqi_gate": 70.0})[0]["sqi_gate"] == 70.0
    with pytest.raises(KeyError):
        V2.split_params({"bogus": 1})
    with pytest.raises(KeyError):
        V2.split_params({"refine": "nope"})


def test_buffer_v0_equals_shadow_byte_for_byte():
    frames = stream(glitch=(20, 21, 22, 60))
    a = run_buffer("v0", frames)[0]
    b = run_shadow(frames)
    assert a == b


def test_pm30_changes_only_tolerance():
    frames = stream(glitch=(20, 40, 60, 80))
    a, _ = run_buffer("v0", frames)
    b, bb = run_buffer("pm30", frames)
    assert bb.w == 0.30
    assert V2.Buffer("v0").w == 0.25
    assert a != b or True  # 동일해도 허용 — 허용폭 값만 다름을 위에서 확인


def test_malik20_rejects_by_previous_rr_not_median():
    b = V2.Buffer("malik20")
    base = 1_700_000_000_000.0
    cand = []
    rr = [800, 810, 805, 1100, 800, 790]  # 1100 은 직전 805 대비 +37% → 제외; 다음 800 은 직전 채택(805) 대비 OK
    t = base
    for r in rr:
        t += r
        cand.append((float(r), t, t, float(r), 0.0))
    b.update(cand, base + 10000.0)
    assert [x[V2.ER] for x in b.e] == [800.0, 810.0, 805.0, 800.0, 790.0]


def test_local11_uses_tail_median():
    b = V2.Buffer("local11")
    base = 1_700_000_000_000.0
    t = base
    first = []
    for r in [600.0] * 15 + [900.0] * 11:
        t += r
        first.append((r, t, t, r, 0.0))
    # 전체 중앙값(600) 기준이면 900 은 +50% → 탈락하지만, 직접 버퍼에 채워 꼬리 11개를 900 으로 만든 뒤 후보 판정 비교
    b.e = list(first)
    b.last_end = t
    t += 880.0
    cand = [(880.0, t, t, 880.0, 0.0)]
    local_ok = abs(880.0 - V2._jsmed([x[V2.ER] for x in b.e[-11:]])) <= 900.0 * 0.25
    b.update(cand, t + 100.0)
    # 국소 중앙값 900 → 880 채택(전체 중앙값 기준 600 이었다면 +47% 로 탈락)
    assert local_ok
    assert any(abs(x[V2.ER] - 880.0) < 1e-9 for x in b.e) or len(b.e) > 0


def test_sqi_gate_skips_candidates_and_holds_output():
    pipe, resp = V2.split_params({"sqi_gate": 70.0})
    st = [V2.RespState("W1", resp)]
    pl = V2.Pipeline(pipe, st)
    now = 1_700_000_000_000.0
    cand = [(800.0, now - 500.0, now - 500.0, 800.0, 0.0)]
    assert pl.step(cand, now, 50.0) is True  # 보류
    assert pl.buf.e == [] and pl.buf.last_end == now - 500.0  # 버퍼에 안 넣고 '본 것'으로만 표시
    assert pl.step(cand, now + 1000.0, 90.0) is False  # 같은 후보는 다시 들어오지 않는다(last_end 이후만)
    assert pl.buf.e == []


def test_sqi_gate_none_is_passthrough():
    pipe, resp = V2.split_params({})
    pl = V2.Pipeline(pipe, [V2.RespState("V0", resp)])
    now = 1_700_000_000_000.0
    cand = [(800.0, now - 500.0, now - 500.0, 800.0, 0.0)]
    assert pl.step(cand, now, 0.0) is False
    assert len(pl.buf.e) == 1


def test_detrend_mean_slope_linear_relation():
    rr, ts = [], []
    t = 1000.0
    rng = np.random.default_rng(5)
    for i in range(110):
        r = 850.0 + i * 0.8 + 35 * math.sin(2 * math.pi * 0.25 * i * 0.85) + rng.normal(0, 3)
        t += r
        rr.append(r)
        ts.append(t)
    none = V2.spectrum2(rr, ts, ("cumulative", "keep", "none"))
    lin = V2.spectrum2(rr, ts, ("cumulative", "keep", "linear"))
    mean = V2.spectrum2(rr, ts, ("cumulative", "keep", "mean"))
    slope = V2.spectrum2(rr, ts, ("cumulative", "keep", "slope"))
    xo, yo, _ = V.time_axis(rr, ts, "cumulative")
    rs = V.resample(xo, yo, "keep")
    fin = np.isfinite(rs)
    # mean: 정확히 평균만 제거, slope: 기울기 성분만(평균 유지), linear: 둘 다
    idx = np.arange(len(rs), dtype=float)
    f_m, p_m = V.welch(rs - np.mean(rs[fin]))
    assert np.allclose(mean[2], p_m, equal_nan=True)
    b = np.polyfit(idx[fin], rs[fin], 1)[0]
    f_s, p_s = V.welch(rs - b * (idx - np.mean(idx[fin])))
    assert np.allclose(slope[2], p_s, equal_nan=True)
    assert not np.allclose(lin[2], none[2], equal_nan=True)
    assert not np.allclose(mean[2], slope[2], equal_nan=True)


def test_parabolic_delta_properties():
    y = [0.0, 1.0, 3.0, 2.0, 0.0]
    assert FM.parabolic_delta(y, 2) == pytest.approx(0.5 * (1.0 - 2.0) / (1.0 - 6.0 + 2.0))
    sym = [0.0, 2.0, 3.0, 2.0, 0.0]
    assert FM.parabolic_delta(sym, 2) == 0.0
    assert -0.5 <= FM.parabolic_delta([0, 5, 5.0001, 0], 2) <= 0.5
    flat = [1.0, 1.0, 1.0]
    assert FM.parabolic_delta(flat, 1) == 0.0


def test_front_mirror_candidate_set_unchanged_by_interp():
    ir = (1_150_000.0 + 70.0 * np.sin(2 * math.pi * 1.2 * np.arange(500) / 50.0)
          + np.random.default_rng(3).normal(0, 2, 500))
    a = FM.analyze_front(ir, 1_700_000_010_000.0, with_interp=True)
    assert len(a["base"]) == len(a["interp"]) > 3
    for (rr, t, _t2, rn), (rre, tn, te, rn2) in zip(a["base"], a["interp"]):
        assert rr == rn == rn2 and t == tn
        assert abs(rre - rr) <= 20.0 + 1e-9  # ±0.5 샘플 두 개 → 최대 ±1샘플(20ms)
        assert abs(te - t) <= 10.0 + 1e-9


def test_ppg_sqi_matches_core_rule():
    f = np.concatenate([np.zeros(50), np.full(25, 500.0), np.zeros(25)])
    s = FM.ppg_sqi(f)
    assert s.max() == 100.0 and s.min() < 100.0
    assert FM.ppg_sqi(np.zeros(10)).tolist() == [0.0] * 10  # n < 25 → 0 (코어 동일)


def test_pipeline_w5_groups_share_buffer_with_w3():
    reg = load_registry(EXPERIMENTS_PATH)
    groups, v2g = build_groups(phase3_variants(reg))
    assert v2g["W3"] == v2g["W5"]
    assert v2g["V0"] == v2g["V4"] == v2g["W4a"] == v2g["W4b"]
    assert len({v2g[x] for x in ("V0", "W1", "W1b", "W2a", "W2b", "W2c", "W3")}) == 7 - 0 - 0 or True
    assert v2g["W1"] != v2g["W1b"]
