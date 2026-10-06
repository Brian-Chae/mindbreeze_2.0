"""개선 8: 그룹 익명 집계 상태 지표(적응형 페이싱).

1:N 수업에서 상담사가 개인 카드를 일일이 훑어야만 그룹 상태를 알 수 있던 문제를 해결한다.
밴드 착용자들의 이완도·집중도를 **익명 집계**(평균 + 안정 비율)해 단일 게이지의 근거를 만들고,
집계 상태에 따라 안내 페이스(slow_down/hold/deepen)를 제안한다.

설계 원칙
  1. **개인 정보 비노출** — payload 에 참가자 식별자·개인 점수·순위를 담지 않는다.
     집계 평균과 비율만 내보내며 상담사(호스트) 룸에만 발행된다.
  2. **개인 baseline 캘리브레이션** — 참가자의 첫 CALIBRATION_SEC(120) 윈도우(≈2분)를
     개인 기준선으로 삼고 그 이후를 baseline 대비 상대값으로 환산한다. 개인차(타고난 이완/집중
     수준)를 그대로 평균하면 그룹 상태가 왜곡되고, 낮은 사람이 "문제 있는 사람"처럼 보인다.
  3. **null 보존** — 산출 불가는 None 이며 0 으로 치환하지 않는다.
  4. **표본 부족 시 점수를 만들지 않는다** — sample_status="insufficient".
     소수 표본의 평균을 그룹 대표값처럼 보여주면 상담사 판단을 오도한다(익명성도 약해진다).
  5. 지표 매핑은 `eeg_metrics` 의 순수 함수(mean/clamp01/score_stability)를 재사용한다.
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional, Sequence

from sqlalchemy.orm import Session as DBSession

from app.services import eeg_query
from app.services.eeg_metrics import clamp01, get_constants, mean, score_stability, stdev

logger = logging.getLogger(__name__)

# ── 캘리브레이션·집계 창 (초 = 1초 윈도우 개수) ──────────────────────────────
# 세션 초반 2분을 개인 기준선으로 쓴다. 참가자별 첫 120 윈도우 기준이므로
# 늦게 입장한 회원도 "본인의 첫 2분"으로 캘리브레이션된다.
CALIBRATION_SEC = 120
# 현재 상태 = 캘리브레이션 이후 최근 RECENT_SEC(60) 윈도우 평균
RECENT_SEC = 60
# 안정성(sd) 계산 창 — 변동성은 현재값과 같은 최근 구간(RECENT_SEC)에서 본다
STABILITY_WINDOW_SEC = 180
# 캘리브레이션 완료로 인정하는 최소 사후 윈도우 수
MIN_POST_WINDOWS = 1
# 안정 여부를 판정하려면 최소 이만큼의 사후 윈도우가 필요하다(2개면 sd 가 과대)
STABILITY_MIN_WINDOWS = 5

# ── 익명성·대표성 게이트 ─────────────────────────────────────────────────
# 착용자가 이 수보다 적으면 그룹 대표값으로 쓰지 않는다(개인 식별 위험 + 대표성 부족)
MIN_WEARERS = 3
# 캘리브레이션까지 끝난 인원이 이보다 적으면 마찬가지
MIN_CALIBRATED = 2

# ── baseline 대비 상대값 정규화 ──────────────────────────────────────────
# 상대값 = 50 + 50·clamp(Δ/ref, -1, 1) → 50 이 기준선, 100 이 최대 이완/집중.
# ref 는 코호트 분포(normalization_constants.json)에서 온 실질 변동 폭이다.
#   relaxationIndex  p10~p95 = 0.098~0.429 (median 0.245) → Δ 0.08 이면 뚜렷한 변화
#   focusIndex       sd_p50 = 0.812 → Δ 0.8 이면 뚜렷한 변화
RELAXATION_DELTA_REF = 0.08
FOCUS_DELTA_REF = 0.8

# 안정 참가자 판정 — 변동성 점수(100·(1 − sd/sd_max))가 이 값 이상이면 "안정"
STABLE_SCORE_THRESHOLD = 50.0

# ── 적응형 페이싱 임계값 ─────────────────────────────────────────────────
PACE_SLOW_RELAXATION = 40.0   # 그룹 이완도가 기준선보다 뚜렷이 낮다 → 속도를 늦춘다
PACE_DEEPEN_RELAXATION = 62.0  # 충분히 이완되고 안정적이다 → 한 단계 깊게
PACE_DEEPEN_STABILITY = 0.6

PACE_INSUFFICIENT = "insufficient"
PACE_SLOW_DOWN = "slow_down"
PACE_HOLD = "hold"
PACE_DEEPEN = "deepen"

# 상담사용 안내 문구 — 점수 경쟁이 아니라 페이스 조절 정보만 담는다(차분한 어조).
PACE_HINTS: dict[str, str] = {
    PACE_INSUFFICIENT: "밴드 착용 인원이 적어 그룹 상태를 판단하지 않습니다 — 개인 카드를 참고하세요.",
    PACE_SLOW_DOWN: "그룹 이완이 기준선 아래입니다 — 안내 속도를 조금 늦춰 보세요.",
    PACE_HOLD: "그룹이 기준선을 유지하고 있습니다 — 지금 흐름을 이어가세요.",
    PACE_DEEPEN: "그룹이 안정적으로 이완했습니다 — 안내를 한 단계 깊게 가도 좋습니다.",
}

# 참가자 1인당 조회 예산 — (초반 baseline) + (최근 현재값/안정성) 만 필요하다.
_QUERY_BUDGET = CALIBRATION_SEC + RECENT_SEC + STABILITY_WINDOW_SEC


# ─────────────────────────────────────────────────────────────────────────
# 기본 유틸 (eeg_metrics 와 동일한 null 안전 원칙)
# ─────────────────────────────────────────────────────────────────────────


def _finite(v) -> Optional[float]:
    """None / NaN / Inf 를 전부 None 으로 정규화한다(0 치환 금지)."""
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _round(v: Optional[float], digits: int = 1) -> Optional[float]:
    f = _finite(v)
    return None if f is None else round(f, digits)


def _chrono_key(window) -> tuple:
    """created_at 기준 정렬 키 — naive/aware 혼용에서도 비교 가능하게 정규화한다.

    SDD-026 과 같은 이유(pause/resume 로 window_index 가 재시작)로 시간순 판정은
    window_index 가 아니라 created_at 을 쓴다. 동률이면 window_index 로 안정 정렬한다.
    """
    ts = getattr(window, "created_at", None)
    if ts is None:
        return (0.0, getattr(window, "window_index", 0) or 0)
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return (ts.timestamp(), getattr(window, "window_index", 0) or 0)


def relative_score(delta: Optional[float], ref: float) -> Optional[float]:
    """baseline 대비 상대값(Δ) → 0-100 점수. 50 = 개인 기준선과 동일.

    이완/집중이 모두 "높을수록 좋음"이 되도록 부호를 그대로 쓴다(기준선보다 이완되면 상승).
    """
    d = _finite(delta)
    if d is None or not ref or ref <= 0:
        return None
    # ±ref 를 100/0 으로, 0 을 50 으로 보내는 선형 매핑(클램프).
    ratio = clamp01((d / ref + 1.0) / 2.0) * 2.0 - 1.0
    return round(50.0 + 50.0 * ratio, 1)


def split_calibration(windows: Sequence) -> tuple[list, list]:
    """시간순 윈도우를 (baseline, 사후 최근 구간) 으로 나눈다.

    baseline = 첫 CALIBRATION_SEC 개(개인 기준선), 사후 = 그 이후의 최근 STABILITY_WINDOW_SEC 개.
    """
    ordered = list(windows)
    baseline = ordered[:CALIBRATION_SEC]
    after = ordered[CALIBRATION_SEC:]
    return baseline, (after[-STABILITY_WINDOW_SEC:] if len(after) > STABILITY_WINDOW_SEC else after)


def _relaxation_sd_max(constants) -> Optional[float]:
    """이완도 변동성 기준값 — 코호트 p10~p95 구간을 ±2σ 로 보는 보수적 근사.

    `normalization_constants.json` 에 relaxationIndex 의 sd_max 가 없으므로
    (p95 − p10)/4 를 sd_max 로 쓴다. 근거를 코드에 명시해 상수 버전 교체 시 재보정 가능하게 한다.
    """
    ri = constants.index("relaxationIndex") or {}
    p10, p95 = _finite(ri.get("p10")), _finite(ri.get("p95"))
    if p10 is None or p95 is None or p95 <= p10:
        return None
    return (p95 - p10) / 4.0


@dataclass(frozen=True)
class ParticipantRelative:
    """한 참가자의 baseline 대비 상대값 — **집계 내부 전용**(payload 에 넣지 않는다)."""

    relaxation_delta: Optional[float]
    focus_delta: Optional[float]
    relaxation_score: Optional[float]
    focus_score: Optional[float]
    # 변동성 점수(STABLE_SCORE_THRESHOLD 이상이면 안정). 산출 불가면 None
    relaxation_stable: Optional[bool]
    focus_stable: Optional[bool]


def participant_relative(
    windows: Sequence, *, constants=None
) -> Optional[ParticipantRelative]:
    """참가자 1인의 캘리브레이션 + baseline 대비 상대값. 캘리브레이션 미완료면 None."""
    c = constants or get_constants()
    baseline, after = split_calibration(windows)
    if len(baseline) < CALIBRATION_SEC or len(after) < MIN_POST_WINDOWS:
        return None

    recent = after[-RECENT_SEC:]
    rel_base = mean([w.relaxation_index for w in baseline])
    rel_now = mean([w.relaxation_index for w in recent])
    foc_base = mean([w.focus_index for w in baseline])
    foc_now = mean([w.focus_index for w in recent])

    rel_delta = None if rel_base is None or rel_now is None else rel_now - rel_base
    foc_delta = None if foc_base is None or foc_now is None else foc_now - foc_base

    # 안정성은 "지금 자리 잡았는가"만 본다 — 전체 사후 구간을 쓰면 기준선에서 새 수준으로
    # 옮겨간 것(이완이 깊어진 것 = 목표)까지 '불안정'으로 벌하게 된다. 현재값과 같은 창을 쓴다.
    can_rate = len(recent) >= STABILITY_MIN_WINDOWS
    rel_stability = (
        score_stability(stdev([w.relaxation_index for w in recent]), _relaxation_sd_max(c))
        if can_rate
        else None
    )
    foc_stability = (
        score_stability(stdev([w.focus_index for w in recent]), c.sd_max("focusIndex"))
        if can_rate
        else None
    )

    def _stable(score: Optional[float]) -> Optional[bool]:
        return None if score is None else score >= STABLE_SCORE_THRESHOLD

    return ParticipantRelative(
        relaxation_delta=_round(rel_delta, 4),
        focus_delta=_round(foc_delta, 4),
        relaxation_score=relative_score(rel_delta, RELAXATION_DELTA_REF),
        focus_score=relative_score(foc_delta, FOCUS_DELTA_REF),
        relaxation_stable=_stable(rel_stability),
        focus_stable=_stable(foc_stability),
    )


def _metric_summary(
    scores: Sequence[Optional[float]], flags: Sequence[Optional[bool]]
) -> dict:
    """지표 1종의 익명 집계 — 평균(0-100) + 안정 비율(0-1). 산출 불가는 None."""
    values = [f for f in (_finite(s) for s in scores) if f is not None]
    rated = [f for f in flags if f is not None]
    return {
        "mean": _round(mean(values), 1),
        "stability_ratio": _round(
            (sum(1 for f in rated if f) / len(rated)) if rated else None, 2
        ),
    }


def describe_pace(
    relaxation_mean: Optional[float],
    stability_ratio: Optional[float],
    sample_ok: bool,
) -> tuple[str, str]:
    """집계 상태 → 적응형 페이싱 제안 (pace, hint).

    - 표본 부족: 판단하지 않는다(insufficient) — 근거 없는 제안을 하지 않는다.
    - 이완도가 기준선 아래: 속도를 늦춘다(slow_down).
    - 이완도가 충분하고 안정적: 한 단계 깊게(deepen).
    - 그 외: 유지(hold).
    """
    if not sample_ok:
        return PACE_INSUFFICIENT, PACE_HINTS[PACE_INSUFFICIENT]
    if relaxation_mean is not None and relaxation_mean < PACE_SLOW_RELAXATION:
        return PACE_SLOW_DOWN, PACE_HINTS[PACE_SLOW_DOWN]
    if (
        relaxation_mean is not None
        and relaxation_mean >= PACE_DEEPEN_RELAXATION
        and (stability_ratio or 0.0) >= PACE_DEEPEN_STABILITY
    ):
        return PACE_DEEPEN, PACE_HINTS[PACE_DEEPEN]
    return PACE_HOLD, PACE_HINTS[PACE_HOLD]


def summarize_group(relatives: Sequence[ParticipantRelative], *, wearer_count: int) -> dict:
    """익명 집계 결과 payload (순수 함수 — DB 모름).

    개인 값은 어떤 형태로도 포함하지 않는다: 착용자 수·캘리브레이션 완료 수·집계 평균·안정 비율만.
    """
    calibrated = len(relatives)
    sample_ok = wearer_count >= MIN_WEARERS and calibrated >= MIN_CALIBRATED

    if not sample_ok:
        # 표본 부족 — 평균을 만들지 않는다(0 치환·부분 평균 금지). 페이스 제안도 하지 않는다.
        pace, hint = describe_pace(None, None, False)
        return {
            "wearer_count": wearer_count,
            "calibrated_count": calibrated,
            "min_wearers": MIN_WEARERS,
            "calibration_sec": CALIBRATION_SEC,
            "baseline_relative": True,
            "sample_status": "insufficient",
            "relaxation": {"mean": None, "stability_ratio": None},
            "focus": {"mean": None, "stability_ratio": None},
            "pace": pace,
            "pace_hint": hint,
        }

    relaxation = _metric_summary(
        [r.relaxation_score for r in relatives], [r.relaxation_stable for r in relatives]
    )
    focus = _metric_summary(
        [r.focus_score for r in relatives], [r.focus_stable for r in relatives]
    )
    pace, hint = describe_pace(relaxation["mean"], relaxation["stability_ratio"], True)

    return {
        "wearer_count": wearer_count,
        "calibrated_count": calibrated,
        "min_wearers": MIN_WEARERS,
        "calibration_sec": CALIBRATION_SEC,
        "baseline_relative": True,
        "sample_status": "ok",
        "relaxation": relaxation,
        "focus": focus,
        "pace": pace,
        "pace_hint": hint,
    }


# ─────────────────────────────────────────────────────────────────────────
# DB 연동 — 세션 집계
# ─────────────────────────────────────────────────────────────────────────


def _participant_windows(session_id, participant_id, db: DBSession) -> list:
    """단일 참가자의 (baseline + 최근) 윈도우 — 일괄 조회 헬퍼의 단일 참가자 래퍼."""
    return _participants_windows(session_id, [participant_id], db).get(participant_id, [])


def _participants_windows(session_id, participant_ids, db: DBSession) -> dict:
    """참가자 목록의 (baseline + 최근) 윈도우를 **쿼리 2회**로 일괄 조회한다 (EEG-QRY-02).

    기존에는 참가자마다 feature_windows_chronological 을 2회씩 호출해 참가자 수에 비례하는
    N+1 쿼리가 발생했다. 창 함수 기반 일괄 조회로 쿼리 수를 참가자 수와 무관하게 고정한다.

    반환: {participant_id: [시간순 윈도우...]} — 캘리브레이션(baseline)과 최근 구간을 병합.
    """
    if not participant_ids:
        return {}
    earliest = eeg_query.feature_windows_chronological_for_participants(
        db, session_id, participant_ids, limit=CALIBRATION_SEC
    )
    latest = eeg_query.feature_windows_chronological_for_participants(
        db, session_id, participant_ids, limit=_QUERY_BUDGET, newest_first=True
    )
    merged: dict = {}
    for source in (earliest, latest):
        for pid, windows in source.items():
            bucket = merged.setdefault(pid, {})
            for w in windows:
                bucket[w.id] = w
    return {pid: sorted(bucket.values(), key=_chrono_key) for pid, bucket in merged.items()}


def compute_group_aggregate(session_id, db: DBSession, *, at: datetime | None = None) -> dict:
    """세션의 밴드 착용자를 익명 집계해 상담사용 상태 payload 를 만든다.

    착용자 판정은 "해당 참가자의 EEG 윈도우가 1건 이상 존재"다(동의 게이트는 업로드 단계에서
    이미 적용되므로 윈도우 보유 = 동의한 착용자). 호스트 본인 행은 그룹 상태에서 제외한다.
    """
    from app.models.session import Session

    sid = _to_session_uuid(session_id)
    if sid is None:
        return {
            "session_id": str(session_id),
            "at": (at or datetime.now(timezone.utc)).isoformat(),
            **summarize_group([], wearer_count=0),
        }

    session = db.query(Session).filter(Session.id == sid).first()
    stamp = (at or datetime.now(timezone.utc)).isoformat()
    if session is None:
        return {"session_id": str(session_id), "at": stamp, **summarize_group([], wearer_count=0)}

    participants = [
        p
        for p in (session.participants or [])
        if not p.is_waitlisted and (session.host_id is None or p.user_id != session.host_id)
    ]

    relatives: list[ParticipantRelative] = []
    wearer_count = 0
    # EEG-QRY-02: 참가자별 N+1 대신 전 참가자 윈도우를 일괄 조회(쿼리 2회)한다.
    windows_by_participant = _participants_windows(sid, [p.id for p in participants], db)
    for p in participants:
        windows = windows_by_participant.get(p.id, [])
        if not windows:
            continue
        wearer_count += 1
        relative = participant_relative(windows)
        if relative is not None:
            relatives.append(relative)

    return {
        "session_id": str(sid),
        "at": stamp,
        **summarize_group(relatives, wearer_count=wearer_count),
    }


# ─────────────────────────────────────────────────────────────────────────
# SDD-124: 절대 그룹 평균(회원 노출용)
# ─────────────────────────────────────────────────────────────────────────

# 절대 평균 집계 지표 → EEGFeatureWindow 원시 필드.
# 마음 지표는 raw(0~1), 몸 지표는 절대값 — 회원 화면과 동일 스케일(HRV 는 회원 기준 sdnn).
_ABSOLUTE_METRIC_FIELDS: tuple[tuple[str, str], ...] = (
    ("focus_index", "focus_index"),
    ("relaxation_index", "relaxation_index"),
    ("emotional_stability", "emotional_stability"),
    ("heart_rate", "heart_rate"),
    ("respiratory_rate", "respiratory_rate"),
    ("sdnn", "sdnn"),
)


def _wearer_recent_mean(windows: Sequence, field: str) -> Optional[float]:
    """참가자 1인의 최근 윈도우에서 특정 지표의 평균(null 보존)."""
    values: list[float] = []
    for w in windows:
        v = getattr(w, field, None)
        if isinstance(v, (int, float)):
            values.append(float(v))
    return mean(values)


def _group_average_payload(
    session_id, stamp: str, wearer_means: dict[str, list], *, wearer_count: int
) -> dict:
    """익명 절대 평균 payload — 표본 부족(MIN_WEARERS 미만)이면 mean 전부 null.

    개인 식별자·개인 점수·순위는 어떤 형태로도 담지 않는다(기존 익명 집계 원칙 유지).
    """
    sufficient_metrics = 0
    metrics: dict[str, dict] = {}
    for _, field in _ABSOLUTE_METRIC_FIELDS:
        values = wearer_means.get(field, [])
        # 지표별 실제 표본 — 미보고(null) 착용자를 제외한 뒤 최소 착용자 수를 넘을 때만 평균을 낸다.
        # 착용자 총수만 보고 평균하면, 기여자가 1명뿐인 지표의 개인값이 그대로 그룹 평균이 되어
        # 익명성이 깨진다(mean 은 None 을 제거하므로).
        non_null = [v for v in values if v is not None]
        enough = len(non_null) >= MIN_WEARERS
        if enough:
            sufficient_metrics += 1
        metrics[field] = {"mean": _round(mean(non_null), 2) if enough else None}
    # EEG-AGG-01: sample_status 를 per-metric 게이트와 일관되게 만든다. 착용자 총수만 보면
    # 모든 지표가 실제로는 표본 부족인데도 "ok" 로 표시되어, 회원 화면이 근거 없는 '그룹 평균'을
    # 보여주는 것처럼 오인하게 한다. 평균을 산출한 지표가 하나라도 있어야(표본 충족) "ok" 다.
    return {
        "session_id": str(session_id),
        "at": stamp,
        "wearer_count": wearer_count,
        "min_wearers": MIN_WEARERS,
        "sample_status": "ok" if sufficient_metrics > 0 else "insufficient",
        "metrics": metrics,
    }


def compute_group_average(session_id, db: DBSession, *, at: datetime | None = None) -> dict:
    """밴드 착용자들의 최근 구간 **절대** 그룹 평균(6지표) — 회원 노출용.

    기존 `class:aggregate`(baseline 상대값, 상담사 전용)와 별개로, 회원이 "그룹 평균 대비
    내 위치"를 보기 위한 익명 절대 평균이다. 착용자별 최근 RECENT_SEC 윈도우의 지표 평균을
    구한 뒤 착용자 간 평균을 낸다. 착용자가 MIN_WEARERS 미만이면 평균을 만들지 않는다
    (소수 표본의 평균 = 개인값 역산 방지).
    """
    from app.models.session import Session

    sid = _to_session_uuid(session_id)
    stamp = (at or datetime.now(timezone.utc)).isoformat()
    if sid is None:
        return _group_average_payload(session_id, stamp, {}, wearer_count=0)

    session = db.query(Session).filter(Session.id == sid).first()
    if session is None:
        return _group_average_payload(session_id, stamp, {}, wearer_count=0)

    participants = [
        p
        for p in (session.participants or [])
        if not p.is_waitlisted and (session.host_id is None or p.user_id != session.host_id)
    ]

    wearer_means: dict[str, list] = {field: [] for _, field in _ABSOLUTE_METRIC_FIELDS}
    wearer_count = 0
    # EEG-QRY-02: 참가자별 N+1 대신 전 참가자 윈도우를 일괄 조회(쿼리 2회)한다.
    windows_by_participant = _participants_windows(sid, [p.id for p in participants], db)
    for p in participants:
        windows = windows_by_participant.get(p.id, [])
        if not windows:
            continue
        wearer_count += 1
        recent = windows[-RECENT_SEC:]
        for _, field in _ABSOLUTE_METRIC_FIELDS:
            wearer_means[field].append(_wearer_recent_mean(recent, field))

    return _group_average_payload(sid, stamp, wearer_means, wearer_count=wearer_count)


def _to_session_uuid(value):
    """세션 식별자를 UUID 로 정규화한다. 해석 불가면 None(호출측이 빈 집계로 응답)."""
    from uuid import UUID

    if isinstance(value, UUID):
        return value
    try:
        return UUID(str(value))
    except (TypeError, ValueError, AttributeError):
        return None