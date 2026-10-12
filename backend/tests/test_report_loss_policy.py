"""SDD-122 — 리포트 데이터 유실 표시 기반 단위 테스트.

검증 대상(순수 함수):
- _derive_data_credibility: lost/coverage<0.5 → very_low, not_measured → None, 기존 파생 무회귀.
- _coverage_ratio: 세션 경계 유무에 따른 유효 측정 비율.
- _loss_reason: band_disconnect(0윈도우)/low_quality(valid 없음)/None(정상).
"""

import pytest

from app.tasks.report_task import (
    _coverage_ratio,
    _derive_data_credibility,
    _loss_reason,
)


class _W:
    def __init__(self, quality: str):
        self.quality = quality


def _wins(*qualities: str) -> list:
    return [_W(q) for q in qualities]


# ── _derive_data_credibility ──────────────────────────────────────────
def test_credibility_not_measured_is_none():
    assert _derive_data_credibility({"status": "not_measured"}) is None


def test_credibility_lost_is_very_low():
    assert _derive_data_credibility({"status": "lost"}) == "very_low"


def test_credibility_valid_is_high():
    assert _derive_data_credibility({"status": "valid"}) == "high"


def test_credibility_degraded_is_medium():
    assert _derive_data_credibility({"status": "degraded"}) == "medium"


def test_credibility_invalid_is_low():
    assert _derive_data_credibility({"status": "invalid"}) == "low"


def test_credibility_coverage_below_half_is_very_low():
    # B2 — 유효 측정 절반 미만 → 신뢰도 매우 낮음
    assert _derive_data_credibility({"status": "valid", "coverage_ratio": 0.47}) == "very_low"


def test_credibility_coverage_above_half_keeps_high():
    assert _derive_data_credibility({"status": "valid", "coverage_ratio": 0.8}) == "high"


def test_credibility_non_dict_is_none():
    assert _derive_data_credibility(None) is None  # type: ignore[arg-type]
    assert _derive_data_credibility("x") is None  # type: ignore[arg-type]


# ── _coverage_ratio ───────────────────────────────────────────────────
from datetime import datetime, timedelta, timezone

_T0 = datetime(2026, 10, 4, 10, 0, 0, tzinfo=timezone.utc)


def _span(seconds: int):
    return _T0, _T0 + timedelta(seconds=seconds)


def test_coverage_ratio_with_boundaries():
    # 20 usable 윈도우 / 40초 세션 → 0.5
    wins = _wins(*(["valid"] * 20))
    s, e = _span(40)
    assert _coverage_ratio(wins, s, e) == 0.5


def test_coverage_ratio_caps_at_one():
    wins = _wins(*(["valid"] * 100))
    s, e = _span(10)
    assert _coverage_ratio(wins, s, e) == 1.0


def test_coverage_ratio_no_boundaries_is_none():
    wins = _wins("valid", "degraded")
    assert _coverage_ratio(wins, None, None) is None


def test_coverage_ratio_ignores_invalid():
    # invalid는 usable에 포함 안 됨
    wins = _wins("valid", "valid", "invalid", "invalid")
    s, e = _span(4)
    assert _coverage_ratio(wins, s, e) == 0.5


# ── _loss_reason ──────────────────────────────────────────────────────
def test_loss_reason_empty_is_band_disconnect():
    assert _loss_reason([]) == "band_disconnect"


def test_loss_reason_no_valid_is_low_quality():
    assert _loss_reason(_wins("degraded", "invalid")) == "low_quality"


def test_loss_reason_has_valid_is_none():
    assert _loss_reason(_wins("valid", "degraded")) is None
