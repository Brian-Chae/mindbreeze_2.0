"""measure-guard C1: 무효 EEG 구간(null+invalid) 수신·품질·집계 방어.

- live:metric 의 EEG 지표 전부 null+invalid 를 거부하지 않고 저장하되 quality 는 invalid (sqi 가 높아도 valid 로 세지 않는다).
- 리포트·클래스 집계는 TNA 극단값(>1000)을 0 이 아니라 제외한다.
"""
from datetime import datetime, timezone

import pytest

from app.schemas.session_live_ingest import MetricWindow, parse_metric_window
from app.services import eeg_metrics
from app.services.live_ingest_service import _feature_item, eeg_window_invalid
from app.services.normalization_score import TNA_OUTLIER_MAX, brain_rest_score

NOW = datetime(2026, 10, 27, tzinfo=timezone.utc)
PARAMS = {"totalNeuralActivity": {"m": 2.3252, "s": 2.3342}}


def _mv(value, unit="index_raw", validity="valid", reason=None):
    return {"value": value, "unit": unit, "validity": validity, "reason": reason,
            "last_valid_sequence": None, "last_valid_observed_at_ms": None}


def _inv(unit="index_raw", reason="saturated"):
    return _mv(None, unit=unit, validity="invalid", reason=reason)


def _window(metrics, sqi=0.95):
    return MetricWindow(
        session_id="s", participant_id="p", stream_id="st", stream_generation=1, sequence=3,
        window_start_us=0, window_end_us=1_000_000, clock_anchor_id="a", clock_uncertainty_ms=1.0,
        algorithm_version="v", feature_hash="h", contact={"fp1": "contact", "fp2": "contact"}, sqi=sqi, metrics=metrics)


def test_EEG_지표가_전부_null_invalid_면_무효_창이다():
    w = _window({"focus_raw": _inv(), "relaxation_raw": _inv(), "emotion_raw": _inv(), "tna_raw": _inv(),
                 "bpm": _mv(70.0, unit="beats_per_min")})
    assert eeg_window_invalid(w) is True


def test_하나라도_valid_EEG_지표가_있거나_EEG_지표가_없으면_무효_창이_아니다():
    assert eeg_window_invalid(_window({"focus_raw": _mv(1.0), "tna_raw": _inv()})) is False
    assert eeg_window_invalid(_window({"bpm": _mv(70.0, unit="beats_per_min")})) is False
    assert eeg_window_invalid(_window({})) is False


def test_warming_up_창은_무효가_아니라_품질_미판정이므로_invalid_로_세지_않는다():
    w = _window({"focus_raw": _mv(None, validity="warming_up"), "tna_raw": _mv(None, validity="warming_up")})
    assert eeg_window_invalid(w) is False


def test_무효_창의_지표는_0이_아니라_None_으로_저장_항목이_된다():
    item = _feature_item(_window({"focus_raw": _inv(), "relaxation_raw": _inv(), "emotion_raw": _inv(), "tna_raw": _inv()}), NOW, True)
    assert item.focus_index is None and item.relaxation_index is None
    assert item.emotional_stability is None and item.total_neural_activity is None


def test_wire_파서는_null_invalid_EEG_창을_수락한다():
    raw = {
        "session_id": "11111111-1111-4111-8111-111111111111", "participant_id": "22222222-2222-4222-8222-222222222222",
        "stream_id": "33333333-3333-4333-8333-333333333333", "stream_generation": "1", "sequence": "5",
        "window_start_us": "0", "window_end_us": "1000000", "observed_at_ms": 1,
        "clock_anchor_id": "44444444-4444-4444-8444-444444444444", "clock_uncertainty_ms": 1,
        "device_profile_version": "d1", "algorithm_version": "a1", "model_version": "m1", "feature_hash": "a" * 64,
        "contact": {"fp1": "contact", "fp2": "contact"}, "sqi": 0.9,
        "metrics": {"focus_raw": _inv(reason="step"), "tna_raw": _inv(reason="outlier"),
                    "relaxation_display": _inv("score_0_100", "leadoff")},
    }
    w = parse_metric_window(raw)
    assert w.metrics["tna_raw"]["value"] is None and w.metrics["tna_raw"]["reason"] == "outlier"
    assert eeg_window_invalid(w) is True


def test_brain_rest_score_는_TNA_극단값을_None_으로_제외한다():
    assert brain_rest_score(TNA_OUTLIER_MAX, PARAMS) is not None
    assert brain_rest_score(TNA_OUTLIER_MAX + 1, PARAMS) is None
    assert brain_rest_score(2.4e7, PARAMS) is None


def test_세션_지표_평균에서_TNA_극단값은_제외된다():
    base = dict(focus_index=[1.0] * 60, cognitive_load=[1.0] * 60, relaxation_index=[0.3] * 60,
                stress_index=[1.0] * 60, emotional_stability=[1.0] * 60, faa=[0.1] * 60,
                hemispheric_balance=[0.1] * 60, windows_total=60, windows_valid=60, windows_degraded=0,
                longest_usable_run=60, normalization_params=PARAMS, normalization_version=7)
    clean = eeg_metrics.compute_session_metrics(total_neural_activity=[3.0] * 60, **base)
    # 극단값 10개가 섞여도 평균이 오염되지 않는다(제외)
    dirty = eeg_metrics.compute_session_metrics(total_neural_activity=[3.0] * 50 + [2.4e7] * 10, **base)
    assert dirty.total_neural_activity_mean == clean.total_neural_activity_mean
    assert dirty.relaxation_score == clean.relaxation_score
    # 전부 극단값이면 0 이 아니라 None
    allbad = eeg_metrics.compute_session_metrics(total_neural_activity=[2.4e7] * 60, **base)
    assert allbad.total_neural_activity_mean is None and allbad.relaxation_score is None


@pytest.fixture
def db(app_client):
    from app.core.database import get_db
    from app.main import app

    session = next(app.dependency_overrides[get_db]())
    try:
        yield session
    finally:
        session.rollback()
        session.close()


def test_무효_창은_quality_invalid_로_저장되어_coverage_에서_빠진다(client, db):
    from app.models.eeg_feature import EEGFeatureWindow
    from app.services import session_service
    from app.schemas.session import EEGFeatureItem
    from app.tasks.report_task import _coverage_ratio
    from tests.sdd237_helpers import build_class_world

    w = build_class_world(db, members=1)
    p = w["participants"][0]
    items = [EEGFeatureItem(second_offset=i, play_group_id="pg", signal_quality=0.95, focus_index=1.0) for i in range(10)]
    overrides = {("pg", i): "invalid" for i in range(5)}
    saved = session_service._persist_feature_items(w["session"].id, p, items, db, quality_overrides=overrides)
    assert len(saved) == 10
    rows = db.query(EEGFeatureWindow).filter(EEGFeatureWindow.participant_id == p.id).order_by(EEGFeatureWindow.window_index).all()
    assert [r.quality for r in rows] == ["invalid"] * 5 + ["valid"] * 5
    # coverage: 유효 5 / 10초
    start = datetime(2026, 10, 27, tzinfo=timezone.utc)
    end = datetime(2026, 10, 27, 0, 0, 10, tzinfo=timezone.utc)
    assert _coverage_ratio(rows, start, end) == 0.5
