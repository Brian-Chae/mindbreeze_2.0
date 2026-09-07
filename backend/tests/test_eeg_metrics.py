"""SDD-022 — 하루밴드 EEG 지표 산출(eeg_metrics) 단위 테스트.

검증 범위(verify.md §1)
  - 7지표 산출
  - null 입력 → null 반환 (0 치환 금지)
  - weighted_total: null 지표 가중치 재정규화
  - evaluate_session_quality: insufficient/invalid/degraded/valid 4상태
  - 정규화 상수 JSON 로드 + version 추적
"""

import math

import pytest

from app.services import eeg_metrics as em

# 7지표 키 — 종합 가중치 키와 동일
SEVEN_METRIC_KEYS = tuple(em.DEFAULT_SCORE_WEIGHTS.keys())


def _valid_series(n: int = 50):
    """valid 판정을 받는(reliability 1.0, usable/run n) 정상대 시계열."""
    return dict(
        # 약간의 변동을 줘 표본표준편차가 0 이 아니게 한다(변동성 지표 산출)
        focus_index=[1.0 if i % 2 == 0 else 1.2 for i in range(n)],
        cognitive_load=[2.0 if i % 2 == 0 else 2.2 for i in range(n)],
        relaxation_index=[0.30 for _ in range(n)],
        stress_index=[2.0 for _ in range(n)],
        emotional_stability=[3.0 for _ in range(n)],
        total_neural_activity=[400.0 for _ in range(n)],
        faa=[0.1 for _ in range(n)],
        hemispheric_balance=[0.0 for _ in range(n)],
    )


# ── 1. 정규화 상수 로드 + version 추적 ──────────────────────────
def test_constants_load_version():
    c = em.get_constants()
    assert c.version == 2
    assert c.provisional is True
    # 7지표 산출에 필요한 인덱스가 로드됐는지
    assert c.index("focusIndex").get("p25") is not None
    assert c.sd_max("focusIndex") and c.sd_max("cognitiveLoad")


# ── 2. valid 세션 → 7지표 전부 산출 ────────────────────────────
def test_seven_metrics_computed_on_valid_session():
    m = em.compute_session_metrics(**_valid_series(50))
    assert m.session_status == "valid"
    assert m.session_reason == "OK"
    assert m.eeg_reliability == 1.0
    for key in SEVEN_METRIC_KEYS:
        v = getattr(m, key)
        assert v is not None, f"{key} 는 valid 세션에서 산출돼야 한다"
        assert 0.0 <= v <= 100.0
    # 종합점수 + 메타
    assert m.meditation_total_score is not None
    assert m.constants_version == 2  # version 추적
    assert m.drowsiness_flag is False  # 정상대 → 졸음 아님(0/None 아님)


# ── 3. null 입력 → null 반환 (0 치환 금지) ─────────────────────
def test_null_input_preserved_not_zeroed():
    series = _valid_series(50)
    # total_neural_activity 전 구간 None → 해당 지표만 None
    series["total_neural_activity"] = [None for _ in range(50)]
    m = em.compute_session_metrics(**series)

    assert m.total_neural_activity_mean is None
    assert m.total_neural_activity_score is None  # ★ 0 이 아니라 None
    assert m.total_neural_activity_score != 0
    # 나머지 지표는 정상 산출
    assert m.stress_score is not None
    assert m.relaxation_score is not None
    # 종합점수는 null 지표를 제외하고 여전히 산출된다
    assert m.meditation_total_score is not None


def test_round_preserves_none():
    # 유틸 레벨에서도 None 보존
    assert em._round(None) is None
    assert em._round(float("nan")) is None
    assert em._round(1.23456, 2) == 1.23
    assert em.mean([]) is None
    assert em.stdev([1.0]) is None  # 표본 2개 미만 → None (0 아님)


# ── 4. weighted_total: null 지표 가중치 재정규화 ───────────────
def test_weighted_total_renormalizes_over_present_metrics():
    scores = {"stress_score": 60.0, "relaxation_score": 90.0}
    # (0.15*60 + 0.06*90) / (0.15 + 0.06)
    expected = (0.15 * 60.0 + 0.06 * 90.0) / (0.15 + 0.06)
    got = em.weighted_total(scores)
    assert got is not None
    assert math.isclose(got, expected, rel_tol=1e-9)


def test_weighted_total_all_none_is_none():
    assert em.weighted_total({k: None for k in SEVEN_METRIC_KEYS}) is None
    assert em.weighted_total({}) is None


# ── 5. evaluate_session_quality 4상태 ──────────────────────────
def test_quality_gate_insufficient():
    status, reason, reliability, usable = em.evaluate_session_quality(
        windows_total=10, windows_valid=10, windows_degraded=0, longest_usable_run=10)
    assert (status, reason) == ("insufficient", "TOO_SHORT")
    assert usable == 10


def test_quality_gate_invalid():
    # usable≥40 이지만 reliability < 0.30
    status, reason, reliability, usable = em.evaluate_session_quality(
        windows_total=200, windows_valid=0, windows_degraded=50, longest_usable_run=50)
    assert (status, reason) == ("invalid", "LOW_QUALITY")
    assert usable == 50
    assert reliability < em.RELIABILITY_INVALID


def test_quality_gate_degraded():
    # 0.30 ≤ reliability < 0.70
    status, reason, reliability, usable = em.evaluate_session_quality(
        windows_total=100, windows_valid=50, windows_degraded=0, longest_usable_run=50)
    assert status == "degraded"
    assert reason == "OK"
    assert em.RELIABILITY_INVALID <= reliability < em.RELIABILITY_DEGRADED


def test_quality_gate_valid():
    status, reason, reliability, usable = em.evaluate_session_quality(
        windows_total=50, windows_valid=50, windows_degraded=0, longest_usable_run=50)
    assert (status, reason) == ("valid", "OK")
    assert reliability >= em.RELIABILITY_DEGRADED


# ── 6. insufficient/invalid 세션 → 점수 None, raw 집계는 보존 ──
def test_insufficient_session_scores_none_but_raw_preserved():
    m = em.compute_session_metrics(**_valid_series(10))  # 10<40 → insufficient
    assert m.session_status == "insufficient"
    for key in SEVEN_METRIC_KEYS:
        assert getattr(m, key) is None  # 점수는 전부 None
    assert m.meditation_total_score is None
    # raw 집계는 게이트와 무관하게 저장된다(재분석 자산)
    assert m.focus_index_mean is not None
    assert m.total_neural_activity_mean is not None


# ── 7. 매핑 함수 개별 계약 (경계/null) ─────────────────────────
def test_mapping_functions_null_and_bounds():
    assert em.score_trapezoid(None, 1, 2, 3, 4) is None
    assert em.score_trapezoid(0, 1, 2, 3, 4) == 0.0
    assert em.score_trapezoid(2.5, 1, 2, 3, 4) == 100.0
    assert em.score_linear(None, 0, 1) is None
    assert em.score_inverse_linear(None, 0, 1) is None
    assert em.score_deviation(0.0, 0.5) == 100.0
    assert em.score_deviation(None, 0.5) is None
    assert em.score_deviation(1.0, 0) is None  # ref falsy → None
    # 이완: 과이완은 60점까지만 감점 (0 아님)
    assert em.score_relaxation(0.99, 0.1, 0.26, 0.43) is not None
