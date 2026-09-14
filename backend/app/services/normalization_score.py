"""SDD-041: eegSigmoidScore.ts의 변환·반올림까지 동일한 순수 정규화 함수."""
import math
from collections.abc import Mapping

CALIBRATION_METRIC_KEYS = (
    'focusIndex', 'relaxationIndex', 'stressIndex', 'totalNeuralActivity',
    'faa', 'cognitiveLoad', 'emotionalStability', 'autonomicStability',
    'sdnn', 'avgHeartRate', 'breathingStability',
)
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
    z = transform_raw(key, raw)
    if z is None:
        return None
    t = z / s if key == 'faa' else (z - m) / s
    if not math.isfinite(t):
        return None
    ratio = math.exp(-math.log(2) * t * t) if key == 'faa' else sigmoid(int(direction) * SIGMOID_C * t)
    return to_percent_score(ratio)
