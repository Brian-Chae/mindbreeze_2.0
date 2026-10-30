"""SDD-246 T05/T09 — live:metric · live:device wire 검증 (순수 함수, DB·Redis 없음).

정본은 `contracts/session-live-v2/schema/{metric,wire,common,state}.schema.json`. 서버가 받는 입력을 같은 규칙으로 좁게 검증한다:
unknown 필드 거절, u64 는 십진 문자열, 종합점수 필드 없음, invalid/warming_up/gap 값은 null(0 대체 금지).
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Any, Mapping

from app.schemas.session_live_v2 import WireError, is_uuid, parse_u64

_VERSION_LABEL = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_REASON = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
MS_MAX = 9007199254740991
SEQUENCE_MAX = 2_147_483_647  # eeg_feature_windows.window_index(Integer)에 들어간다

CONTACT_STATES = frozenset({"contact", "leadoff", "unknown"})
BAND_STATES = frozenset({"not_worn", "connecting", "connected", "reconnecting", "lost", "unknown"})
VALIDITY = frozenset({"valid", "warming_up", "invalid", "gap"})
# metric 이름 → 단위 (contracts MetricSet)
METRIC_UNITS: dict[str, str] = {
    "focus_raw": "index_raw", "focus_display": "score_0_100", "relaxation_raw": "index_raw",
    "relaxation_display": "score_0_100", "emotion_raw": "index_raw", "emotion_display": "score_0_100",
    "bpm": "beats_per_min", "respiration": "breaths_per_min", "sdnn": "ms",
    "tna_raw": "index_raw",  # 선택(구 클라 미전송) — 리포트 두뇌 휴식 점수 입력
    # 선택(구 클라 미전송) — v1 feature 와 같은 정의·단위. 없으면 해당 컬럼은 NULL(하위호환).
    "delta_power": "power_raw", "theta_power": "power_raw", "alpha_power": "power_raw", "beta_power": "power_raw",
    "gamma_power": "power_raw", "total_power": "power_raw", "stress_index": "index_raw", "cognitive_load": "index_raw",
    "faa": "index_raw", "hemispheric_balance": "index_raw", "rmssd": "ms", "lf_power": "power_raw",
    "hf_power": "power_raw", "lf_hf_ratio": "index_raw", "motion": "ratio_0_1",
}
_METRIC_KEYS = frozenset({"value", "unit", "validity", "reason", "last_valid_sequence", "last_valid_observed_at_ms"})
_ENVELOPE_KEYS = frozenset({
    "session_id", "participant_id", "stream_id", "stream_generation", "sequence", "window_start_us", "window_end_us",
    "observed_at_ms", "clock_anchor_id", "clock_uncertainty_ms", "device_profile_version", "algorithm_version",
    "model_version", "feature_hash", "contact", "sqi", "metrics",
})
_DEVICE_KEYS = frozenset({"protocol_version", "schema_version", "session_id", "stream_id", "device_seq", "band_state",
                          "contact", "sqi", "battery_pct", "state_reason"})
_BATCH_KEYS = frozenset({"protocol_version", "schema_version", "windows"})
MAX_WINDOWS = 60


def _need(cond: bool, code: str, field: str | None = None) -> None:
    if not cond:
        raise WireError(code, field)


def _is_int(v: Any) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def _is_num(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _contact(raw: Any, field: str) -> dict[str, str]:
    _need(isinstance(raw, Mapping) and set(raw) == {"fp1", "fp2"} and all(raw[k] in CONTACT_STATES for k in raw), "invalid_message", field)
    return {"fp1": raw["fp1"], "fp2": raw["fp2"]}


def _sqi(raw: Any, field: str) -> float | None:
    _need(raw is None or (_is_num(raw) and 0 <= raw <= 1), "invalid_message", field)
    return None if raw is None else float(raw)


def _versions(raw: Mapping[str, Any]) -> None:
    _need(_is_int(raw.get("protocol_version")) and raw.get("protocol_version") == 2, "unsupported_protocol", "protocol_version")
    _need(_is_int(raw.get("schema_version")) and raw.get("schema_version") == 1, "unsupported_schema", "schema_version")


@dataclass(frozen=True)
class MetricWindow:
    session_id: str
    participant_id: str
    stream_id: str
    stream_generation: int
    sequence: int
    window_start_us: int
    window_end_us: int
    clock_anchor_id: str
    clock_uncertainty_ms: float
    algorithm_version: str
    feature_hash: str
    contact: dict[str, str]
    sqi: float | None
    metrics: dict[str, dict[str, Any]]


def _metric_value(name: str, raw: Any) -> dict[str, Any]:
    _need(isinstance(raw, Mapping) and set(raw) == _METRIC_KEYS, "invalid_message", f"metrics.{name}")
    _need(raw["unit"] == METRIC_UNITS[name], "invalid_message", f"metrics.{name}.unit")
    validity = raw["validity"]
    _need(validity in VALIDITY, "invalid_message", f"metrics.{name}.validity")
    value = raw["value"]
    if validity == "valid":
        _need(_is_num(value), "invalid_message", f"metrics.{name}.value")
        if name.endswith("_display"):
            _need(0 <= value <= 100, "invalid_message", f"metrics.{name}.value")
    else:
        _need(value is None, "invalid_message", f"metrics.{name}.value")  # invalid 를 0 으로 대체 금지
    reason = raw["reason"]
    _need(reason is None or (isinstance(reason, str) and bool(_REASON.match(reason))), "invalid_message", f"metrics.{name}.reason")
    lvs = raw["last_valid_sequence"]
    if lvs is not None:
        parse_u64(lvs, f"metrics.{name}.last_valid_sequence")
    lvo = raw["last_valid_observed_at_ms"]
    _need(lvo is None or (_is_int(lvo) and 0 <= lvo <= MS_MAX), "invalid_message", f"metrics.{name}.last_valid_observed_at_ms")
    return {"value": value, "unit": raw["unit"], "validity": validity, "reason": reason,
            "last_valid_sequence": lvs, "last_valid_observed_at_ms": lvo}


def parse_metric_window(raw: Any) -> MetricWindow:
    _need(isinstance(raw, Mapping), "invalid_message")
    extra = set(raw) - _ENVELOPE_KEYS
    _need(not extra, "invalid_message", sorted(extra)[0] if extra else None)  # 종합점수 같은 unknown 필드 거절
    missing = _ENVELOPE_KEYS - set(raw)
    _need(not missing, "invalid_message", sorted(missing)[0] if missing else None)
    for f in ("session_id", "participant_id", "stream_id", "clock_anchor_id"):
        _need(is_uuid(raw[f]), "invalid_message", f)
    gen = parse_u64(raw["stream_generation"], "stream_generation")
    seq = parse_u64(raw["sequence"], "sequence")
    _need(seq <= SEQUENCE_MAX, "sequence_out_of_range", "sequence")
    start, end = parse_u64(raw["window_start_us"], "window_start_us"), parse_u64(raw["window_end_us"], "window_end_us")
    _need(end > start, "invalid_window", "window_end_us")
    _need(_is_int(raw["observed_at_ms"]) and 0 <= raw["observed_at_ms"] <= MS_MAX, "invalid_message", "observed_at_ms")  # 값은 신뢰하지 않는다
    unc = raw["clock_uncertainty_ms"]
    _need(_is_num(unc) and 0 <= unc <= 300000, "invalid_message", "clock_uncertainty_ms")
    for f in ("device_profile_version", "algorithm_version", "model_version"):
        _need(isinstance(raw[f], str) and bool(_VERSION_LABEL.match(raw[f])), "invalid_message", f)
    _need(isinstance(raw["feature_hash"], str) and bool(_SHA256.match(raw["feature_hash"])), "invalid_message", "feature_hash")
    metrics_raw = raw["metrics"]
    _need(isinstance(metrics_raw, Mapping) and set(metrics_raw) <= set(METRIC_UNITS), "invalid_message", "metrics")
    return MetricWindow(
        session_id=raw["session_id"], participant_id=raw["participant_id"], stream_id=raw["stream_id"], stream_generation=gen,
        sequence=seq, window_start_us=start, window_end_us=end, clock_anchor_id=raw["clock_anchor_id"], clock_uncertainty_ms=float(unc),
        algorithm_version=raw["algorithm_version"], feature_hash=raw["feature_hash"], contact=_contact(raw["contact"], "contact"),
        sqi=_sqi(raw["sqi"], "sqi"), metrics={k: _metric_value(k, v) for k, v in metrics_raw.items()},
    )


def parse_metric_batch(raw: Any) -> list[MetricWindow]:
    _need(isinstance(raw, Mapping), "invalid_message")
    extra = set(raw) - _BATCH_KEYS
    _need(not extra, "invalid_message", sorted(extra)[0] if extra else None)
    _versions(raw)
    wins = raw.get("windows")
    _need(isinstance(wins, list) and 1 <= len(wins) <= MAX_WINDOWS, "invalid_message", "windows")
    return [parse_metric_window(w) for w in wins]


@dataclass(frozen=True)
class DeviceReport:
    session_id: str
    stream_id: str
    device_seq: int
    band_state: str
    contact: dict[str, str]
    sqi: float | None
    battery_pct: int | None
    state_reason: str | None


def parse_device(raw: Any) -> DeviceReport:
    _need(isinstance(raw, Mapping), "invalid_message")
    extra = set(raw) - _DEVICE_KEYS
    _need(not extra, "invalid_message", sorted(extra)[0] if extra else None)
    missing = _DEVICE_KEYS - set(raw)
    _need(not missing, "invalid_message", sorted(missing)[0] if missing else None)
    _versions(raw)
    for f in ("session_id", "stream_id"):
        _need(is_uuid(raw[f]), "invalid_message", f)
    seq = parse_u64(raw["device_seq"], "device_seq")
    _need(raw["band_state"] in BAND_STATES, "invalid_message", "band_state")
    bat = raw["battery_pct"]
    _need(bat is None or (_is_int(bat) and 0 <= bat <= 100), "invalid_message", "battery_pct")
    reason = raw["state_reason"]
    _need(reason is None or (isinstance(reason, str) and bool(_REASON.match(reason))), "invalid_message", "state_reason")
    return DeviceReport(session_id=raw["session_id"], stream_id=raw["stream_id"], device_seq=seq, band_state=raw["band_state"],
                        contact=_contact(raw["contact"], "contact"), sqi=_sqi(raw["sqi"], "sqi"), battery_pct=bat, state_reason=reason)
