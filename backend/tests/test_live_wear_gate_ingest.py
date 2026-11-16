"""착용 판정(not_worn/no_pulse)과 무관하게 live:metric 창을 거부하지 않고 저장 항목으로 변환한다.

- PPG 파생 지표 전부 null+invalid(reason=not_worn|no_pulse)여도 wire 파서가 수락.
- EEG 지표가 valid 면 무효 창이 아니고, 저장 항목(_feature_item)이 만들어진다(창은 항상 저장).
"""
from datetime import datetime, timezone

import pytest

from app.schemas.session_live_ingest import parse_metric_window
from app.services.live_ingest_service import _feature_item, eeg_window_invalid

NOW = datetime(2026, 11, 16, tzinfo=timezone.utc)
PPG_UNITS = {"bpm": "beats_per_min", "sdnn": "ms", "rmssd": "ms", "lf_power": "power_raw",
             "hf_power": "power_raw", "lf_hf_ratio": "index_raw", "respiration": "breaths_per_min"}


def _mv(value, unit, validity="valid", reason=None):
    return {"value": value, "unit": unit, "validity": validity, "reason": reason,
            "last_valid_sequence": None, "last_valid_observed_at_ms": None}


def _raw(reason):
    metrics = {k: _mv(None, u, "invalid", reason) for k, u in PPG_UNITS.items()}
    metrics["focus_raw"] = _mv(1.2, "index_raw")
    metrics["relaxation_raw"] = _mv(0.8, "index_raw")
    return {
        "session_id": "11111111-1111-4111-8111-111111111111", "participant_id": "22222222-2222-4222-8222-222222222222",
        "stream_id": "33333333-3333-4333-8333-333333333333", "stream_generation": "1", "sequence": "5",
        "window_start_us": "0", "window_end_us": "1000000", "observed_at_ms": 1,
        "clock_anchor_id": "44444444-4444-4444-8444-444444444444", "clock_uncertainty_ms": 1,
        "device_profile_version": "d1", "algorithm_version": "a1", "model_version": "m1", "feature_hash": "a" * 64,
        "contact": {"fp1": "contact", "fp2": "contact"}, "sqi": 0.9, "metrics": metrics,
    }


@pytest.mark.parametrize("reason", ["not_worn", "no_pulse"])
def test_PPG_지표_전부_null_invalid_사유가_착용_관련이어도_창을_수락하고_저장한다(reason):
    w = parse_metric_window(_raw(reason))
    assert all(w.metrics[k]["value"] is None and w.metrics[k]["reason"] == reason for k in PPG_UNITS)
    assert eeg_window_invalid(w) is False  # EEG 가 valid 면 무효 창 아님 — 착용과 무관하게 계속 처리
    item = _feature_item(w, NOW, True)
    assert item is not None
