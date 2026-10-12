"""눈 감기/뜨기 전체 표본을 이용한 median + MAD 분포 집계."""

from collections.abc import Iterable
from math import isfinite, log
from statistics import median
from typing import get_args

from ..models.normalization_baseline import NormalizationBaseline
from ..schemas.normalization_model import DistributionParams, MetricKey

MIN_BASELINES = 5
LN_EPS = 1e-9
DIRECTION_DOWN = frozenset({"stressIndex", "cognitiveLoad", "faa", "avgHeartRate"})
# RMSSD/SDNN(ms)·심박(bpm)은 0도 물리적으로 무효 —
# ln(0+eps) 가 분포를 오염시키지 않게 제외한다.
POSITIVE_ONLY = frozenset({"autonomicStability", "sdnn", "avgHeartRate"})


def compute_distribution(
    baselines: Iterable[NormalizationBaseline],
) -> dict[str, dict[str, float | int]]:
    """유효 표본 부족 또는 척도 0인 지표는 생략해 코호트 fallback을 허용한다."""
    samples: dict[str, list[float]] = {key: [] for key in get_args(MetricKey)}
    for baseline in baselines:
        for metrics in (baseline.closed, baseline.open):
            for key, values in samples.items():
                raw = metrics.get(key)
                # 과거 데이터나 직접 DB 입력도 JSON 응답의 유한성을 깨뜨리지 않는다.
                if isinstance(raw, bool) or not isinstance(raw, (int, float)):
                    continue
                try:
                    if not isfinite(raw) or (key != "faa" and raw < 0):
                        continue
                    if key in POSITIVE_ONLY and raw <= 0:
                        continue
                    if key == "faa":
                        z = abs(raw)
                    elif key == "breathingStability":
                        z = raw  # 이미 0~100 정규화 점수이므로 ln 미변환
                    else:
                        z = log(raw + LN_EPS)
                except (OverflowError, ValueError):
                    continue
                if isfinite(z):
                    values.append(z)

    params: dict[str, dict[str, float | int]] = {}
    for key, values in samples.items():
        if len(values) < 2:
            continue
        m = median(values)
        s = 1.4826 * median(abs(z - m) for z in values)
        if not isfinite(m) or not isfinite(s) or s <= 0:
            continue
        params[key] = DistributionParams(
            m=m, s=s, direction=-1 if key in DIRECTION_DOWN else 1
        ).model_dump()
    return params
