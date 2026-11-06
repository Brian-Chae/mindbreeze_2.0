"""H3 참값 / H4 지표 / H5 분할 누수 / H6 홀드아웃 잠금 단위 시험 (verify.md V7)."""
import numpy as np
import pytest

from ppg_eval import guard, splits
from ppg_eval.common import Record
from ppg_eval.metrics import cluster_bootstrap, prf, resp_stats, stratum_of
from ppg_eval.truth import beat_match, truth_for_record, truth_hrv_at, window_rate


# ---------------- H3: 참값 산출 ----------------
def test_window_rate_regular_15bpm():
    ev = np.arange(0.0, 200.0, 4.0)  # 4초 주기 = 15 회/분
    r, why = window_rate(ev, 100.0, 60.0)
    assert why == "ok" and r == pytest.approx(15.0, abs=1e-12)


def test_window_rate_boundary_undefined_when_gap_at_edges():
    ev = np.array([40.0, 44.0, 48.0, 52.0, 56.0])  # 창 (0,60]: 시작쪽 40초 비어 있음 → 정의 불가
    r, why = window_rate(ev, 60.0, 60.0)
    assert r is None and why == "truth_undefined"


def test_window_rate_needs_three_events():
    r, why = window_rate(np.array([10.0, 20.0]), 60.0, 60.0)
    assert r is None


def test_window_rate_half_open_window():
    ev = np.arange(0.0, 120.0, 6.0)  # 10/분
    r, _ = window_rate(ev, 60.0, 60.0)  # (0,60]: 0 제외, 60 포함
    assert r == pytest.approx(10.0)


def test_bidmc_two_annotators_agree_disagree_and_mean():
    a1 = np.arange(0.0, 200.0, 4.0)  # 15
    a2 = np.arange(0.0, 200.0, 60.0 / 17.0)  # 17
    rec = Record(ds="bidmc", rid="x", fs=125.0, ppg=np.zeros(1), resp_events={"ann1": a1, "ann2": a2})
    tv, why = truth_for_record(rec, 60.0, 100.0)
    assert why == "ok" and tv == pytest.approx(16.0, abs=0.2)
    a2b = np.arange(0.0, 200.0, 60.0 / 25.0)  # 25 → 차 10 > 3
    rec.resp_events["ann2"] = a2b
    tv, why = truth_for_record(rec, 60.0, 100.0)
    assert tv is None and why == "annotator_disagree"


def test_truth_hrv_matches_hand_calc():
    rr = np.array([800.0, 1000.0] * 40)  # 80개, 합 72초
    end = np.cumsum(rr) / 1000.0
    sdnn, rmssd = truth_hrv_at(rr, end, float(end[-1]))
    assert sdnn == pytest.approx(100.0, abs=1e-9)  # 모집단 SD
    assert rmssd == pytest.approx(200.0, abs=1e-9)  # 차 ±200
    assert truth_hrv_at(rr[:5], end[:5], float(end[4])) == (None, None)


# ---------------- H4: 지표 ----------------
def test_resp_stats_hand_vector():
    truth = np.array([10.0, 12.0, 14.0, 16.0])
    core = np.array([11.0, np.nan, 12.0, 18.0])  # 오차 +1, +(-2), +2 ; null 1
    s = resp_stats(truth, core)
    assert s["n_win"] == 4 and s["n_valid"] == 3
    assert s["coverage"] == pytest.approx(0.75, abs=1e-12)
    assert s["mae"] == pytest.approx((1 + 2 + 2) / 3, abs=1e-12)
    assert s["bias"] == pytest.approx((1 - 2 + 2) / 3, abs=1e-12)
    assert s["mae_pen"] == pytest.approx((1 + 12 + 2 + 2) / 4, abs=1e-12)  # null = 12 고정
    assert s["median_ae"] == pytest.approx(2.0)
    assert s["cp2"] == pytest.approx(1.0)  # |e|<=2 전부
    e = np.array([1.0, -2.0, 2.0])
    assert s["loa_hi"] == pytest.approx(e.mean() + 1.96 * e.std(ddof=1), abs=1e-12)


def test_null_dropping_cannot_improve_mae_pen():
    truth = np.array([10.0] * 10)
    good = np.array([10.5] * 10)
    mostly_null = np.array([10.0] + [np.nan] * 9)  # MAE 0 이지만 coverage 10%
    a, b = resp_stats(truth, good), resp_stats(truth, mostly_null)
    assert b["mae"] < a["mae"] and b["coverage"] == pytest.approx(0.1)
    assert b["mae_pen"] > a["mae_pen"]  # 꼼수 차단


def test_strata_boundaries_are_half_open_lower_inclusive():
    assert [stratum_of(v) for v in (5.99, 6.0, 11.99, 12.0, 19.99, 20.0)] == ["lt6", "6_12", "6_12", "12_20", "12_20", "gt20"]


def test_prf_and_beat_match_one_to_one():
    truth = np.array([1.0, 2.0, 3.0])
    core = np.array([1.02, 1.04, 2.95])  # 1.04 는 이미 쓰인 truth 1.0 에 중복 → 매칭 안 됨
    tp, pairs = beat_match(truth, core, 0.1)
    assert tp == 2 and pairs == [(0, 0), (2, 2)]
    p, r, f = prf(2, 3, 3)
    assert (p, r) == (pytest.approx(2 / 3), pytest.approx(2 / 3)) and f == pytest.approx(2 / 3)


def test_cluster_bootstrap_is_seeded_and_cluster_level():
    rng = np.random.default_rng(0)
    recs = []
    for k in range(12):
        t = rng.uniform(8, 22, 30)
        recs.append((t, t + rng.normal(0, 1 + k % 3, 30)))
    a, b = cluster_bootstrap(recs, B=200), cluster_bootstrap(recs, B=200)
    assert a == b  # 시드 고정
    lo, hi = a["mae"]
    assert lo < hi


# ---------------- H5: 분할 누수 ----------------
def test_splits_regenerate_and_no_leak():
    s = splits.build_splits()
    assert s == splits.load_splits()  # splits.json 이 규칙의 산출물과 동일
    assert splits.check_leakage(s) == []
    dev, hold = set(s["dev"]["marsh"]), set(s["holdout"]["marsh"])
    assert not (dev & hold) and (dev | hold) == set(splits.marsh_ids())
    assert len(dev) == 15 and len(hold) == 14
    assert "capnobase" not in s["dev"]


def test_split_detects_injected_leak():
    s = splits.build_splits()
    s["dev"]["marsh"] = s["dev"]["marsh"] + [s["holdout"]["marsh"][0]]
    assert splits.check_leakage(s) != []


# ---------------- H6: 홀드아웃 잠금 ----------------
def test_holdout_locked_for_every_loader(tmp_path, monkeypatch):
    monkeypatch.setattr(guard, "ACCESS_LOG", str(tmp_path / "log.jsonl"))
    from ppg_eval.adapters import loaders

    s = splits.load_splits()
    with pytest.raises(guard.HoldoutLocked):
        loaders.load_record("marsh", s["holdout"]["marsh"][0])
    with pytest.raises(guard.HoldoutLocked):
        guard.require_open("capnobase", "0009")
    with pytest.raises(guard.HoldoutLocked):
        guard.require_open("marsh", s["holdout"]["marsh"][1], unlock="anything")  # 토큰이 있어도 이번 SDD 에선 비활성
    with pytest.raises(PermissionError):
        loaders.load_record("capnobase", "0009")
    lines = (tmp_path / "log.jsonl").read_text().strip().splitlines()
    assert len(lines) >= 3 and all("holdout_access" in l for l in lines)


def test_cli_run_holdout_refuses(tmp_path, monkeypatch):
    from ppg_eval import cli

    monkeypatch.setattr(guard, "ACCESS_LOG", str(tmp_path / "cli-log.jsonl"))

    assert cli.main(["run-holdout", "--confirm-single-run"]) == 2
