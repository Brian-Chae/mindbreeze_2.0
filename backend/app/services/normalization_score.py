"""SDD-041: eegSigmoidScore.ts의 변환·반올림까지 동일한 순수 정규화 함수."""
import math
from collections.abc import Mapping

CALIBRATION_METRIC_KEYS = (
    'focusIndex', 'relaxationIndex', 'stressIndex', 'totalNeuralActivity',
    'faa', 'cognitiveLoad', 'emotionalStability', 'autonomicStability',
    'sdnn', 'avgHeartRate', 'breathingStability',
)
# 진단 안전망: TNA(원시) 가 이 값을 넘으면 ADC 포화·직류 계단 등 입력 불량으로 본다 — 리포트/표시 집계에서 제외(0 치환 금지).
TNA_OUTLIER_MAX = 1000.0
SIGMOID_C = math.log(9) / 1.2815515655446004
MAD_TO_SIGMA = 1.4826
POSITIVE_ONLY = frozenset(('autonomicStability', 'sdnn', 'avgHeartRate'))
DIRECTION_DOWN = frozenset(('stressIndex', 'cognitiveLoad', 'faa', 'avgHeartRate'))
DIRECTION_UP = frozenset(('relaxationIndex', 'emotionalStability', 'focusIndex',
                          'autonomicStability', 'sdnn', 'breathingStability'))


def _finite(value: object) -> bool:
    return (isinstance(value, (int, float)) and not isinstance(value, bool)
            and math.isfinite(value))


def transform_raw(key: str, raw: float | None) -> float | None:
    if not _finite(raw):
        return None
    if key == 'faa':
        return abs(raw)
    if key == 'breathingStability':
        return raw
    if raw < 0 or (key in POSITIVE_ONLY and raw <= 0):
        return None
    return math.log(raw + 1e-9)


def score_direction(key: str) -> int:
    return -1 if key in DIRECTION_DOWN else 1


def sigmoid(x: float) -> float:
    if not math.isfinite(x):
        return 0.5
    if x >= 20:
        return 1
    if x <= -20:
        return 0
    return 1 / (1 + math.exp(-x))


def to_percent_score(ratio: float) -> int:
    if not math.isfinite(ratio):
        return 0
    # Python round의 ties-to-even 대신 JavaScript Math.round의 양수 반올림.
    return math.floor(min(99.5, max(0.5, ratio * 100)) + 0.5)


def sigmoid_score(key: str, raw: float | None, params: object) -> int | None:
    if not isinstance(params, Mapping):
        return None
    m, s, direction = params.get('m'), params.get('s'), params.get('direction')
    if not _finite(m) or not _finite(s) or s <= 0:
        return None
    if isinstance(direction, bool) or direction not in (1, -1, '1', '-1'):
        return None
    if key == 'totalNeuralActivity' and _finite(raw) and raw > TNA_OUTLIER_MAX:
        return None
    z = transform_raw(key, raw)
    if z is None:
        return None
    t = z / s if key == 'faa' else (z - m) / s
    if not math.isfinite(t):
        return None
    ratio = math.exp(-math.log(2) * t * t) if key == 'faa' else sigmoid(int(direction) * SIGMOID_C * t)
    return to_percent_score(ratio)


def brain_rest_score(tna: float | None, params: object) -> int | None:
    """이완도 = 하루명상 '두뇌 휴식': totalNeuralActivity params(m,s) + direction -1 강제.

    신경 활동↓ = 휴식↑. params 없으면 None(pending, 0 아님). Rust score::brain_rest·웹과 동일.
    """
    p = params.get('totalNeuralActivity') if isinstance(params, Mapping) else None
    if not isinstance(p, Mapping):
        return None
    return sigmoid_score('totalNeuralActivity', tna, {**p, 'direction': -1})
