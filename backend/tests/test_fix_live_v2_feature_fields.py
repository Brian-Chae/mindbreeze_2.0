"""fix-live-v2-feature-fields: 실시간 v2 metrics 15종 확장 저장 + 구 10종 메시지 하위호환."""
from datetime import datetime, timezone

import pytest

from app.schemas.session_live_ingest import METRIC_UNITS, WireError, _metric_value, parse_metric_batch
from app.services.live_ingest_service import _feature_item
from tests.test_fix_relax_tna_ingest import _mv, _window

NOW = datetime(2026, 10, 29, tzinfo=timezone.utc)

OLD_10 = {"focus_raw", "focus_display", "relaxation_raw", "relaxation_display", "emotion_raw", "emotion_display",
          "bpm", "respiration", "sdnn", "tna_raw"}
NEW_15 = {"delta_power", "theta_power", "alpha_power", "beta_power", "gamma_power", "total_power", "stress_index",
          "cognitive_load", "faa", "hemispheric_balance", "rmssd", "lf_power", "hf_power", "lf_hf_ratio", "motion"}


def _full_metrics():
    m = {k: _mv(0.5, unit=METRIC_UNITS[k]) for k in OLD_10 | NEW_15}
    for i, k in enumerate(sorted(NEW_15)):
        m[k] = _mv(0.5 if k == "motion" else 10.0 + i, unit=METRIC_UNITS[k])
    m["focus_raw"], m["relaxation_raw"] = _mv(0.7), _mv(0.4)
    return m


def test_wire_키는_구10종과_신15종_합집합이다():
    assert set(METRIC_UNITS) == OLD_10 | NEW_15


def test_15종_모두_feature_컬럼으로_저장된다():
    m = _full_metrics()
    item = _feature_item(_window(m), NOW, True)
    for k in NEW_15:
        assert getattr(item, k) == m[k]["value"], k
    # v1 관례: 명상=이완지수, 주의=집중지수
    assert item.meditation_level == 0.4 and item.attention_level == 0.7
    assert item.focus_index == 0.7 and item.relaxation_index == 0.4


def test_구_10종_메시지는_그대로_수락되고_신규_컬럼은_NULL():
    m = {k: _mv(1.0, unit=METRIC_UNITS[k]) for k in OLD_10}
    item = _feature_item(_window(m), NOW, True)
    for k in NEW_15:
        assert getattr(item, k) is None, k
    assert item.total_neural_activity == 1.0 and item.heart_rate == 1.0  # 구 10종 값은 그대로 저장


def test_파서는_구10종_전체_메시지를_수락한다():
    env = _env({k: _mv(1.0, unit=METRIC_UNITS[k]) for k in OLD_10})
    assert set(parse_metric_batch({"protocol_version": 2, "schema_version": 1, "windows": [env]})[0].metrics) == OLD_10


def test_파서는_신15종_포함_메시지를_수락한다():
    env = _env({k: _mv(1.0, unit=METRIC_UNITS[k]) for k in OLD_10 | NEW_15})
    assert set(parse_metric_batch({"protocol_version": 2, "schema_version": 1, "windows": [env]})[0].metrics) == OLD_10 | NEW_15


def test_신규_지표_invalid_warming_up은_NULL_0아님():
    m = {"faa": {**_mv(None, unit="index_raw"), "validity": "invalid", "reason": "faa_unavailable"},
         "rmssd": {**_mv(None, unit="ms"), "validity": "warming_up", "reason": "insufficient_rr_window"}}
    item = _feature_item(_window(m), NOW, True)
    assert item.faa is None and item.rmssd is None


def test_알수없는_키와_단위불일치는_여전히_거절():
    with pytest.raises(WireError):
        parse_metric_batch({"protocol_version": 2, "schema_version": 1, "windows": [_env({"overall_score": _mv(1.0)})]})
    with pytest.raises(WireError):
        _metric_value("motion", _mv(0.3, unit="index_raw"))
    with pytest.raises(WireError):
        _metric_value("delta_power", _mv(3.0, unit="score_0_100"))


def _env(metrics):
    u = "0aaaaaaa-0000-4000-8000-000000000001"
    return {"session_id": u, "participant_id": u, "stream_id": u, "stream_generation": "1", "sequence": "3",
            "window_start_us": "0", "window_end_us": "1000000", "observed_at_ms": 1760000000000, "clock_anchor_id": u,
            "clock_uncertainty_ms": 1.0, "device_profile_version": "d1", "algorithm_version": "a1", "model_version": "m1",
            "feature_hash": "a" * 64, "contact": {"fp1": "contact", "fp2": "contact"}, "sqi": 0.9, "metrics": metrics}
