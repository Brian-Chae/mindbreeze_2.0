"""R5 — rollup 평균에서 TNA 극단값(>TNA_OUTLIER_MAX) 제외, 0 치환 금지."""
from types import SimpleNamespace

from app.services.eeg_rollup_service import ROLLUP_METRIC_KEYS, _bucket_payload
from app.services.normalization_score import TNA_OUTLIER_MAX


def _w(tna, focus=0.5):
    base = {k: None for k in ROLLUP_METRIC_KEYS}
    base.update(total_neural_activity=tna, focus_index=focus, quality="valid", participant_id="p1")
    return SimpleNamespace(**base)


def test_rollup_tna_극단값_평균에서_제외():
    windows = [_w(10.0), _w(20.0), _w(TNA_OUTLIER_MAX + 1), _w(1e9)]
    payload = _bucket_payload(0, windows, 5)
    assert payload["metrics"]["total_neural_activity"] == 15.0  # (10+20)/2, 극단값 제외
    assert payload["metrics"]["focus_index"] == 0.5  # 다른 지표는 영향 없음


def test_rollup_tna_경계값은_포함():
    payload = _bucket_payload(0, [_w(TNA_OUTLIER_MAX), _w(0.0)], 5)
    assert payload["metrics"]["total_neural_activity"] == TNA_OUTLIER_MAX / 2


def test_rollup_tna_전부_극단값이면_null():
    payload = _bucket_payload(0, [_w(5000.0), _w(9000.0)], 5)
    assert payload["metrics"]["total_neural_activity"] is None  # 0 으로 치환하지 않는다
