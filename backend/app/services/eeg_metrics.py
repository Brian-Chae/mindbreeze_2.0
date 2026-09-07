"""SDD-022 하루밴드 EEG 지표 산출 — 순수 계산 로직 포팅.

하루밴드 리포트 엔진(`specs/040-meditation-metrics-redesign/design-part-a-eeg.md`)의
metrics.py 를 MB 2.0 backend 로 순수 Python 이식한다. numpy 불필요 — statistics 만 사용.

설계 근거
  §A2.3~§A2.9  7개 지표 정의와 매핑
  §A4.4        세션 품질 게이트
  §A3.3 Step5  정규화 상수는 JSON 파일에서 로드 (코드에 하드코딩하지 않는다)

핵심 원칙
  1. **null 보존** — 산출 불가는 `None`이며 0으로 치환하지 않는다.
     falsy 버그 재발 방지 (§A4.5).
  2. 모든 점수는 0-100, **높을수록 좋음**으로 통일한다.
  3. DB 를 모르는 순수 함수로 유지해 테스트 가능하게 한다.
"""

from __future__ import annotations

import json
import logging
import math
import os
import statistics
from typing import Optional, Sequence

logger = logging.getLogger(__name__)

# ★ 모듈과 같은 디렉토리에 둔다. `backend/app/data/` 는 .gitignore 의 `data/` 규칙에
#   걸려 커밋되지 않으므로 런타임에 파일이 없어 기동 실패한다(실제로 확인함).
_CONSTANTS_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "normalization_constants.json",
)

# ── 종합 점수 가중치 (§A2.9). 설정값으로 외부화 — 코드 상수로 두지 않는다는
#    설계 원칙에 따라 모듈 상수로 분리하고 향후 설정 주입이 가능하게 한다. ──
DEFAULT_SCORE_WEIGHTS: dict[str, float] = {
    "focus_index_stability_score": 0.25,
    "total_neural_activity_score": 0.20,
    "cognitive_load_stability_score": 0.20,
    "stress_score": 0.15,
    "hemispheric_balance_score": 0.07,
    "emotional_stability_score": 0.07,
    "relaxation_score": 0.06,
}

# ── 세션 품질 게이트 (§A4.4) ──
MIN_USABLE_WINDOWS = 40
MIN_STABILITY_RUN = 20
RELIABILITY_INVALID = 0.30
RELIABILITY_DEGRADED = 0.70
STABILITY_MIN_RELIABILITY = 0.50


class NormalizationConstants:
    """`normalization_constants.json` 로더.

    §A3.3 Step5: "런타임은 이 JSON을 로드한다. 파일 교체만으로 재보정이 가능하고,
    어떤 상수로 산출된 점수인지 constants_version 으로 추적된다."
    """

    def __init__(self, payload: dict):
        self._raw = payload
        self.version: int = payload.get("version", 0)
        self.pipeline_version: Optional[str] = payload.get("pipeline_version")
        self.provisional: bool = bool(payload.get("provisional", True))
        self.indices: dict = payload.get("indices") or {}
        self.stability: dict = payload.get("stability") or {}

    @classmethod
    def load(cls, path: str = _CONSTANTS_PATH) -> "NormalizationConstants":
        with open(path, encoding="utf-8") as f:
            return cls(json.load(f))

    def index(self, name: str) -> dict:
        return self.indices.get(name) or {}

    def sd_max(self, name: str) -> Optional[float]:
        v = (self.stability.get(name) or {}).get("sd_max")
        return float(v) if v else None


_CONSTANTS: Optional[NormalizationConstants] = None


def get_constants() -> NormalizationConstants:
    """상수 싱글턴. 파일이 없거나 깨졌으면 예외를 올린다 —
    잘못된 상수로 조용히 점수를 내는 것보다 실패가 낫다."""
    global _CONSTANTS
    if _CONSTANTS is None:
        _CONSTANTS = NormalizationConstants.load()
    return _CONSTANTS


# ─────────────────────────────────────────────────────────────
# 기본 유틸 — 전부 None 안전
# ─────────────────────────────────────────────────────────────
def clamp01(x: float) -> float:
    return max(0.0, min(1.0, x))


def _finite(v) -> Optional[float]:
    """None / NaN / Inf 를 전부 None 으로 정규화한다."""
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _round(v: Optional[float], digits: int = 1) -> Optional[float]:
    """★ None 을 0 으로 바꾸지 않는다 (§A4.5)."""
    f = _finite(v)
    return None if f is None else round(f, digits)


def mean(values: Sequence[float]) -> Optional[float]:
    vals = [f for f in (_finite(v) for v in values) if f is not None]
    return statistics.fmean(vals) if vals else None


def median(values: Sequence[float]) -> Optional[float]:
    vals = [f for f in (_finite(v) for v in values) if f is not None]
    return statistics.median(vals) if vals else None


def stdev(values: Sequence[float]) -> Optional[float]:
    """표본표준편차 (ddof=1). 표본 2개 미만이면 None — 0 이 아니다."""
    vals = [f for f in (_finite(v) for v in values) if f is not None]
    return statistics.stdev(vals) if len(vals) >= 2 else None


# ─────────────────────────────────────────────────────────────
# 매핑 함수 (§A2.3~§A2.8)
# ─────────────────────────────────────────────────────────────
def score_trapezoid(x, a, b, c, d) -> Optional[float]:
    """정상대 중심 사다리꼴 (§A2.3).

        0                     x ≤ a  또는  x ≥ d
        100·(x−a)/(b−a)       a < x < b
        100                   b ≤ x ≤ c
        100·(d−x)/(d−c)       c < x < d
    """
    x = _finite(x)
    if x is None or None in (a, b, c, d):
        return None
    if not (a < b <= c < d):
        logger.warning("score_trapezoid: 잘못된 구간 a=%s b=%s c=%s d=%s", a, b, c, d)
        return None
    if x <= a or x >= d:
        return 0.0
    if x < b:
        return 100.0 * (x - a) / (b - a)
    if x <= c:
        return 100.0
    return 100.0 * (d - x) / (d - c)


def score_linear(x, lo, hi) -> Optional[float]:
    """높을수록 좋음 — 선형 (§A2.6)."""
    x = _finite(x)
    if x is None or lo is None or hi is None or hi <= lo:
        return None
    return 100.0 * clamp01((x - lo) / (hi - lo))


def score_inverse_linear(x, lo, hi) -> Optional[float]:
    """낮을수록 좋음 — 역선형 (§A2.4)."""
    x = _finite(x)
    if x is None or lo is None or hi is None or hi <= lo:
        return None
    return 100.0 * clamp01((hi - x) / (hi - lo))


def score_deviation(x, ref) -> Optional[float]:
    """0 에 가까울수록 좋음 — `100·(1 − |x|/ref)` (§A2.5).

    focus-mate 의 `balance_score = 1 − |HB|/0.06` 과 동일 계열이며,
    §A2.8 의 변동성 매핑도 같은 형태다."""
    x = _finite(x)
    if x is None or not ref:
        return None
    return 100.0 * clamp01(1.0 - abs(x) / ref)


def score_relaxation(x, p10, p60, p95) -> Optional[float]:
    """이완 지수 — 비대칭 사다리꼴 (§A2.7).

    정상대 상단이 이상적이며, 과이완(졸음 구간)은 **60점까지만** 감점한다.
    이완 자체를 벌하면 명상 앱 지표로서 자기모순이기 때문이다."""
    x = _finite(x)
    if x is None or None in (p10, p60, p95):
        return None
    d = 1.0
    if p95 >= d:
        return None
    if x <= p10:
        return 0.0
    if x < p60:
        return 100.0 * (x - p10) / (p60 - p10)
    if x <= p95:
        return 100.0
    return 100.0 - 40.0 * (x - p95) / (d - p95)


def score_stability(sd, sd_max) -> Optional[float]:
    """변동성 지표 (§A2.8) — `100 · clamp01(1 − sd/SD_max)`.

    기아 보고서로부터 유일하게 역산된 식이 아니라, focus-mate 가 편차형 지표에
    쓰는 매핑과 동일 계열이라는 코드베이스 근거 + Brian 결정에 따른 채택이다.
    """
    sd = _finite(sd)
    if sd is None or not sd_max or sd_max <= 0:
        return None
    return 100.0 * clamp01(1.0 - sd / sd_max)


def weighted_total(scores: dict[str, Optional[float]],
                   weights: Optional[dict[str, float]] = None) -> Optional[float]:
    """종합 점수 (§A2.9) — null 지표는 가중치를 재정규화해 제외한다."""
    w = weights or DEFAULT_SCORE_WEIGHTS
    num = den = 0.0
    for key, weight in w.items():
        v = _finite(scores.get(key))
        if v is not None:
            num += weight * v
            den += weight
    return (num / den) if den > 0 else None


# ─────────────────────────────────────────────────────────────
# 세션 지표 산출 (§A2 + §A4.4)
# ─────────────────────────────────────────────────────────────
class SessionMetrics:
    """compute_session_metrics 의 결과 컨테이너. 전 필드 None 가능."""

    FIELDS = (
        # 세션 상태 / 품질
        "session_status", "session_reason", "eeg_reliability",
        "windows_total", "windows_usable", "longest_usable_run",
        # ① raw indices
        "focus_index_mean", "focus_index_median",
        "relaxation_index_mean", "stress_index_median",
        "cognitive_load_mean", "emotional_stability_median",
        "total_neural_activity_mean", "faa_mean", "hemispheric_balance_mean",
        # ② 변동성
        "focus_index_sd", "cognitive_load_sd",
        # ③ 7개 점수 + 보조 + 종합
        "total_neural_activity_score", "stress_score", "hemispheric_balance_score",
        "emotional_stability_score", "relaxation_score",
        "cognitive_load_stability_score", "focus_index_stability_score",
        "focus_level_score", "meditation_total_score",
        # 메타
        "drowsiness_flag", "constants_version", "provisional",
    )

    def __init__(self, **kw):
        for f in self.FIELDS:
            setattr(self, f, kw.get(f))

    def as_dict(self) -> dict:
        return {f: getattr(self, f) for f in self.FIELDS}


def evaluate_session_quality(windows_total: int, windows_valid: int,
                             windows_degraded: int, longest_usable_run: int):
    """§A4.4 — 세션 3계층 판정.

    반환: (status, reason, eeg_reliability, windows_usable)
    """
    usable = windows_valid + windows_degraded
    reliability = (
        (1.0 * windows_valid + 0.5 * windows_degraded) / windows_total
        if windows_total else 0.0
    )
    if usable < MIN_USABLE_WINDOWS:
        return "insufficient", "TOO_SHORT", reliability, usable
    if reliability < RELIABILITY_INVALID:
        return "invalid", "LOW_QUALITY", reliability, usable
    if reliability < RELIABILITY_DEGRADED:
        return "degraded", "OK", reliability, usable
    return "valid", "OK", reliability, usable


def compute_session_metrics(
    *,
    focus_index: Sequence[float],
    cognitive_load: Sequence[float],
    relaxation_index: Sequence[float],
    stress_index: Sequence[float],
    emotional_stability: Sequence[float],
    total_neural_activity: Sequence[float],
    faa: Sequence[float] = (),
    hemispheric_balance: Sequence[float] = (),
    windows_total: Optional[int] = None,
    windows_valid: Optional[int] = None,
    windows_degraded: int = 0,
    longest_usable_run: Optional[int] = None,
    constants: Optional[NormalizationConstants] = None,
) -> SessionMetrics:
    """윈도우 시계열 → 7개 지표 점수.

    §A4.4 게이트에 걸리면 점수는 전부 None 이고 raw 집계만 남는다.
    ★ 어떤 경우에도 None 을 0 으로 치환하지 않는다.
    """
    c = constants or get_constants()

    n = windows_total if windows_total is not None else len(focus_index)
    valid = windows_valid if windows_valid is not None else n
    run = longest_usable_run if longest_usable_run is not None else (valid + windows_degraded)
    status, reason, reliability, usable = evaluate_session_quality(
        n, valid, windows_degraded, run)

    out = dict(
        session_status=status, session_reason=reason,
        eeg_reliability=_round(reliability, 3),
        windows_total=n, windows_usable=usable, longest_usable_run=run,
        constants_version=c.version, provisional=c.provisional,
        # ① raw indices — 게이트와 무관하게 항상 저장한다(재분석 자산)
        focus_index_mean=_round(mean(focus_index), 4),
        focus_index_median=_round(median(focus_index), 4),
        relaxation_index_mean=_round(mean(relaxation_index), 4),
        stress_index_median=_round(median(stress_index), 4),
        cognitive_load_mean=_round(mean(cognitive_load), 4),
        emotional_stability_median=_round(median(emotional_stability), 4),
        total_neural_activity_mean=_round(mean(total_neural_activity), 4),
        faa_mean=_round(mean(faa), 4),
        hemispheric_balance_mean=_round(mean(hemispheric_balance), 4),
        # ② 변동성
        focus_index_sd=_round(stdev(focus_index), 4),
        cognitive_load_sd=_round(stdev(cognitive_load), 4),
    )

    if status in ("insufficient", "invalid"):
        # 점수는 전부 None. raw 집계는 위에서 이미 채웠다.
        return SessionMetrics(**out)

    tna = c.index("totalNeuralActivity")
    si = c.index("stressIndex")
    es = c.index("emotionalStability")
    ri = c.index("relaxationIndex")
    fi = c.index("focusIndex")
    faa_ref = (c.index("faa") or {}).get("abs_p90")

    out["total_neural_activity_score"] = _round(score_trapezoid(
        out["total_neural_activity_mean"],
        tna.get("p5"), tna.get("p25"), tna.get("p75"), tna.get("p95")))
    out["stress_score"] = _round(score_inverse_linear(
        out["stress_index_median"], si.get("p5"), si.get("p95")))
    out["hemispheric_balance_score"] = _round(score_deviation(
        out["faa_mean"], faa_ref))
    out["emotional_stability_score"] = _round(score_linear(
        out["emotional_stability_median"], es.get("p5"), es.get("p95")))
    out["relaxation_score"] = _round(score_relaxation(
        out["relaxation_index_mean"], ri.get("p10"), ri.get("p60"), ri.get("p95")))
    out["focus_level_score"] = _round(score_trapezoid(
        out["focus_index_mean"],
        fi.get("p5"), fi.get("p25"), fi.get("p75"), fi.get("p95")))

    # 변동성 지표 — §A4.4 추가 게이트
    stability_ok = (usable >= MIN_USABLE_WINDOWS
                    and run >= MIN_STABILITY_RUN
                    and reliability >= STABILITY_MIN_RELIABILITY)
    if stability_ok:
        out["cognitive_load_stability_score"] = _round(score_stability(
            out["cognitive_load_sd"], c.sd_max("cognitiveLoad")))
        out["focus_index_stability_score"] = _round(score_stability(
            out["focus_index_sd"], c.sd_max("focusIndex")))
    # 미충족이면 stability 점수만 None — 나머지 지표는 유지한다

    # 졸음 플래그 (§A2.7) — 감점이 아니라 해석용
    rel_m, cog_m, tna_m = (out["relaxation_index_mean"],
                           out["cognitive_load_mean"],
                           out["total_neural_activity_mean"])
    if None not in (rel_m, cog_m, tna_m) and None not in (
            ri.get("p95"), fi.get("p75"), tna.get("p25")):
        cog_p75 = (c.index("cognitiveLoad") or {}).get("p75")
        out["drowsiness_flag"] = bool(
            rel_m > ri["p95"] and tna_m < tna["p25"]
            and (cog_p75 is None or cog_m > cog_p75))

    out["meditation_total_score"] = _round(weighted_total(out))
    return SessionMetrics(**out)
