"""fix-relax-tna-ingest: v2 live 경로 TNA 저장 + 클래스 통계 이완도 = 두뇌 휴식."""
from datetime import datetime, timezone

import pytest

from app.models.normalization_model import NormalizationModel
from app.schemas.session_live_ingest import MetricWindow, parse_metric_window
from app.services import class_report_stats_service as stats
from app.services import eeg_metrics
from app.services.live_ingest_service import _feature_item
from app.services.normalization_score import brain_rest_score
from tests.sdd237_helpers import add_windows, build_class_world

PARAMS = {"totalNeuralActivity": {"m": 2.3252, "s": 2.3342}}


def _mv(value, unit="index_raw", validity="valid"):
    return {"value": value, "unit": unit, "validity": validity, "reason": None,
            "last_valid_sequence": None, "last_valid_observed_at_ms": None}


def _window(metrics):
    return MetricWindow(
        session_id="s", participant_id="p", stream_id="st", stream_generation=1, sequence=3,
        window_start_us=0, window_end_us=1_000_000, clock_anchor_id="a", clock_uncertainty_ms=1.0,
        algorithm_version="v", feature_hash="h", contact={"fp1": "contact", "fp2": "contact"}, sqi=0.9, metrics=metrics)


NOW = datetime(2026, 10, 27, tzinfo=timezone.utc)


def test_tna_raw_valid_는_total_neural_activity_로_저장된다():
    item = _feature_item(_window({"tna_raw": _mv(3.5), "relaxation_raw": _mv(0.3)}), NOW, True)
    assert item.total_neural_activity == 3.5
    assert item.relaxation_index == 0.3


def test_tna_raw_없거나_invalid_면_None_이다_0아님():
    assert _feature_item(_window({"relaxation_raw": _mv(0.3)}), NOW, True).total_neural_activity is None
    w = _window({"tna_raw": {**_mv(None), "validity": "invalid", "reason": "leadoff"}})
    assert _feature_item(w, NOW, True).total_neural_activity is None


def test_파서는_tna_raw_를_수락하고_단위_불일치는_거부한다():
    from app.schemas.session_live_ingest import METRIC_UNITS, WireError, _metric_value
    assert METRIC_UNITS["tna_raw"] == "index_raw"
    assert _metric_value("tna_raw", _mv(2.0))["value"] == 2.0
    with pytest.raises(WireError):
        _metric_value("tna_raw", _mv(2.0, unit="score_0_100"))


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


def test_클래스통계_이완도는_두뇌휴식_TNA_이고_TNA없으면_None(client, db):
    w = build_class_world(db, members=3)
    p = w["participants"]
    add_windows(db, w["session"], p[0], 300, tna=1.0)
    add_windows(db, w["session"], p[1], 300, tna=4.0)
    add_windows(db, w["session"], p[2], 300, no_tna=True)  # TNA 없는 구 세션 → 이완도 미측정(0 아님)
    res = stats.compute_class_stats(db, w["session"])
    relax = res["metrics"]["relaxation"]
    expected = (brain_rest_score(1.0, PARAMS) + brain_rest_score(4.0, PARAMS)) / 2
    assert relax["measured"] == 2
    assert relax["mean"] == pytest.approx(expected, abs=1e-4)
    # α/(α+β) 정규화(relax=1.0 입력) 값이 아니다
    assert relax["mean"] != pytest.approx(eeg_metrics.normalize_relaxation(1.0), abs=1e-3)
    by = {r["participant_id"]: r for r in res["participants"]}
    assert "relaxation" not in by[str(p[2].id)]["metrics"] or by[str(p[2].id)]["metrics"]["relaxation"]["mean"] is None
