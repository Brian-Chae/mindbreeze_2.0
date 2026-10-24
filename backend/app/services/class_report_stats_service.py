"""SDD-237 명상 클래스 6지표 통계 — 상담사용 클래스 리포트(`content.class_report`)의 숫자 정본.

산식(plan.md §2.1, 요약·리포트가 같은 블록을 읽어 숫자 불일치가 없다):
- 정규화(마음 3지표) → 개인 평균 → 참여자 **동등 가중** 평균. 평균 후 정규화가 아니다.
- 지표별 개인 유효 초(고유 초, 세션 길이로 cap) ≥ MIN_VALID_SEC 이어야 '측정', 전·후반 각 ≥ MIN_HALF_SEC 이면 '비교 가능'.
- 클래스 평균·범위·변화량·시계열은 측정 2명 이상일 때만. 결측은 0으로 채우지 않고 None.
- 전후 분할·방향 임계는 report_narrative 의 공용 헬퍼를 재사용한다(복사 금지).

compute_stats 는 DB 를 모르는 순수 함수라 합성 입력으로 검증하고, compute_class_stats 가 DB 에서 입력을 모은다.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Literal

from app.services.report_narrative import (
    METRICS,
    build_metrics_summary,
    direction_for_change,
    segment_halves,
)

SCHEMA_VERSION = 1
MIN_VALID_SEC = 60
MIN_HALF_SEC = 30
MIN_CLASS_N = 2          # 클래스 평균·범위·변화량·시계열을 보여주는 최소 측정 인원
MIN_AGREEMENT_N = 3      # 방향 분포(익명 건수)를 보여주는 최소 비교 인원
BUCKET_MIN = 5
SHORT_BUCKET_MIN = 2
SHORT_SESSION_MIN = 30
MIND_OK_STATUSES = ("valid", "degraded")

# 클래스 리포트 지표 키 → (그룹, report_narrative 지표 키). 표시 순서는 몸→마음.
_SPEC: dict[str, tuple[str, str]] = {
    "respiration": ("body", "respiratory_rate"),
    "bpm": ("body", "heart_rate"),
    "hrv": ("body", "hrv"),
    "focus": ("mind", "focus"),
    "relaxation": ("mind", "relaxation"),
    "emotional": ("mind", "emotional_stability"),
}
METRIC_KEYS = tuple(_SPEC)
METRIC_UNITS = {"respiration": "회/분", "bpm": "bpm", "hrv": "ms",
                "focus": "%", "relaxation": "%", "emotional": "%"}

Direction = Literal["up", "down", "stable"]


def _attr_and_threshold(key: str) -> tuple[str, float | None]:
    group, nkey = _SPEC[key]
    return METRICS[group][nkey]


def direction_for(metric_key: str, early: float | None, late: float | None) -> Direction | None:
    """전반→후반 방향. 호흡 1회/분·심박 3bpm·HRV 5ms·마음 3지표 변화율 5% 미만이면 stable."""
    return direction_for_change(early, late, _attr_and_threshold(metric_key)[1])


@dataclass(frozen=True)
class StatWindow:
    """통계용 윈도우 1개. 마음 3지표 값은 이미 정규화(0~100)된 값이고 몸 3지표는 원 단위다."""

    participant_id: str
    window_index: int
    play_group_id: str | None
    quality: str
    rel_sec: int                       # 수업 시작 기준 경과 초(고유 초 계산·버킷 기준)
    respiratory_rate: float | None = None
    heart_rate: float | None = None
    sdnn: float | None = None
    focus_index: float | None = None
    relaxation_index: float | None = None
    emotional_stability: float | None = None


@dataclass(frozen=True)
class ParticipantInput:
    participant_id: str
    windows: list[StatWindow] = field(default_factory=list)
    eeg_status: str = "valid"          # 참여자 EEG 품질 게이트 결과(valid/degraded/invalid/insufficient)
    norm_version: str | None = None    # 마음 지표에 쓴 정규화 모델 버전
    intent: str = "no"                 # 윈도우가 없을 때 밴드 연결 시도 여부(yes=유실, no=미착용)


@dataclass
class _Person:
    mean: float
    valid_sec: int
    early: float | None
    late: float | None
    comparable: bool
    direction: Direction | None
    samples: list[tuple[int, float]]   # (rel_sec, value) — 시계열 버킷용


def _r6(value: float | None) -> float | None:
    return None if value is None else round(value, 6)


def _avg(values: list[float]) -> float | None:
    return math.fsum(values) / len(values) if values else None


def _finite(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _usable(p: ParticipantInput, w: StatWindow, group: str) -> bool:
    """마음 지표는 세션 상태와 윈도우 품질이 모두 valid/degraded 일 때만, 몸 지표는 EEG 품질과 독립."""
    if group == "body":
        return True
    return p.eeg_status in MIND_OK_STATUSES and w.quality in MIND_OK_STATUSES


def _person_metrics(p: ParticipantInput, session_sec: int, blocked_mind: bool) -> dict[str, _Person]:
    """참여자 한 명의 지표별 요약. 측정 기준(MIN_VALID_SEC)에 못 미친 지표는 포함하지 않는다."""
    summary = build_metrics_summary(p.windows, p.eeg_status)
    halves = segment_halves(p.windows)
    out: dict[str, _Person] = {}
    for key, (group, nkey) in _SPEC.items():
        if group == "mind" and blocked_mind:
            continue
        attr, _threshold = _attr_and_threshold(key)

        def sample_of(w: StatWindow):
            v = getattr(w, attr)
            return v if _finite(v) and _usable(p, w, group) else None

        samples = [(w.rel_sec, v) for w in p.windows if (v := sample_of(w)) is not None]
        valid_sec = min(len({s for s, _ in samples}), session_sec) if session_sec > 0 else 0
        if valid_sec < MIN_VALID_SEC:
            continue
        early_sec = len({w.rel_sec for eh, _ in halves for w in eh if sample_of(w) is not None})
        late_sec = len({w.rel_sec for _, lh in halves for w in lh if sample_of(w) is not None})
        cell = summary[group][nkey]
        early, late = cell["early"], cell["late"]
        comparable = (early is not None and late is not None
                      and early_sec >= MIN_HALF_SEC and late_sec >= MIN_HALF_SEC)
        out[key] = _Person(
            mean=math.fsum(v for _, v in samples) / len(samples),
            valid_sec=valid_sec,
            early=early if comparable else None,
            late=late if comparable else None,
            comparable=comparable,
            direction=direction_for(key, early, late) if comparable else None,
            samples=samples,
        )
    return out


def _bucket_minutes(session_sec: int) -> int:
    return SHORT_BUCKET_MIN if session_sec < SHORT_SESSION_MIN * 60 else BUCKET_MIN


def _series(measured: list[_Person], session_sec: int, bucket_min: int) -> list[dict]:
    """버킷별 개인 평균 → 측정 n≥2 인 버킷만 클래스 값(동등 가중). 나머지는 v=None(선을 잇지 않는다)."""
    size = bucket_min * 60
    count = max(1, math.ceil(session_sec / size)) if session_sec > 0 else 0
    points: list[dict] = []
    for k in range(count):
        lo, hi = k * size, (k + 1) * size
        means = []
        for person in measured:
            vals = [v for s, v in person.samples if lo <= s < hi]
            if vals:
                means.append(math.fsum(vals) / len(vals))
        v = _avg(means) if len(means) >= MIN_CLASS_N else None
        points.append({"t_min": k * bucket_min, "v": _r6(v), "n": len(means)})
    return points


def _empty_metric(key: str, state: str, reason: str | None, measured: int = 0, compared: int = 0) -> dict:
    return {
        "unit": METRIC_UNITS[key], "state": state, "measured": measured, "compared": compared,
        "mean": None, "min": None, "max": None, "early": None, "late": None, "delta": None,
        "direction": None, "valid_min": None, "valid_ratio": None, "agreement": None,
        "missing_reason": reason, "series": [],
    }


def _class_metric(key: str, people: list[_Person], session_sec: int, bucket_min: int) -> dict:
    compared = [p for p in people if p.comparable]
    metric = _empty_metric(key, "ok", None, measured=len(people), compared=len(compared))
    means = [p.mean for p in people]
    metric.update(
        mean=_r6(_avg(means)), min=_r6(min(means)), max=_r6(max(means)),
        valid_min=_r6(_avg([p.valid_sec / 60 for p in people])),
        valid_ratio=_r6(_avg([p.valid_sec / session_sec for p in people])) if session_sec > 0 else None,
        series=_series(people, session_sec, bucket_min),
    )
    if len(compared) >= MIN_CLASS_N:
        early = _avg([p.early for p in compared])
        late = _avg([p.late for p in compared])
        metric.update(early=_r6(early), late=_r6(late), delta=_r6(late - early),
                      direction=direction_for(key, early, late))
        if len(compared) >= MIN_AGREEMENT_N:
            dirs = [p.direction for p in compared]
            metric["agreement"] = {d: dirs.count(d) for d in ("up", "stable", "down")}
    else:
        metric["missing_reason"] = "compare_insufficient"
    return metric


def compute_stats(
    participants: list[ParticipantInput], *, attended: int, session_sec: int, duration_min: int,
) -> dict:
    """클래스 블록의 통계부(status/flags/scope/metrics/participants/normalization_version)를 계산한다."""
    bucket_min = _bucket_minutes(session_sec)

    # 정규화 버전이 섞이면 마음 지표는 평균하지 않는다(서로 다른 척도를 한 평균에 넣지 않음).
    versions = {p.norm_version for p in participants if p.windows}
    blocked_mind = len(versions) > 1
    norm_version = next(iter(versions)) if len(versions) == 1 else None

    per_person = {p.participant_id: _person_metrics(p, session_sec, blocked_mind) for p in participants}
    measurers = {pid for pid, metrics in per_person.items() if metrics}
    n_meas = len(measurers)
    lost_ids = {p.participant_id for p in participants
                if not p.windows and p.intent == "yes"}

    def person_state(p: ParticipantInput) -> str:
        if per_person[p.participant_id]:
            return "measured"
        if p.windows:
            return "poor_signal"
        return "lost" if p.intent == "yes" else "unworn"

    no_measurer_reason = ("connection_lost", "lost") if lost_ids else ("not_worn", "unworn")
    metrics: dict[str, dict] = {}
    weak_signal = False
    for key in METRIC_KEYS:
        group = _SPEC[key][0]
        measured_people = [m[key] for m in per_person.values() if key in m]
        n = len(measured_people)
        if attended == 0 or not participants:
            metrics[key] = _empty_metric(key, "missing", "no_participants")
        elif group == "mind" and blocked_mind:
            metrics[key] = _empty_metric(key, "missing", "normalization_mismatch")
            weak_signal = weak_signal or n_meas >= MIN_CLASS_N
        elif n >= MIN_CLASS_N:
            metrics[key] = _class_metric(key, measured_people, session_sec, bucket_min)
        elif n_meas >= MIN_CLASS_N:
            metrics[key] = _empty_metric(key, "poor_signal", "signal_insufficient", measured=n)
            weak_signal = True
        elif n == 1:
            metrics[key] = _empty_metric(key, "single", "single_measured", measured=1)
        elif n_meas == 1:
            metrics[key] = _empty_metric(key, "missing", "no_signal")
        else:
            state, short = no_measurer_reason[1], no_measurer_reason[0]
            metrics[key] = _empty_metric(key, state, short)

    # 상태 코드 우선순위(§2.1): zero > unworn > lost > single > poor_signal > partial > measured.
    #   partial 은 '측정자가 대상의 절반 이하'일 때만 대표 상태가 된다. 과반이 측정했으면 measured 이고
    #   일부 미착용은 flags 로만 알린다(요약 S2 '참석 6 · 측정 4 · 대상 5' 와 정합).
    included = len(participants)
    if attended == 0:
        status = "zero"
    elif n_meas == 0:
        status = "lost" if lost_ids else "unworn"
    elif n_meas == 1:
        status = "single"
    elif weak_signal:
        status = "poor_signal"
    elif n_meas * 2 <= included:
        status = "partial"
    else:
        status = "measured"

    flags = []
    if 0 < n_meas < included:
        flags.append("partial")
    if lost_ids:
        flags.append("lost")
    if weak_signal:
        flags.append("poor_signal")

    rows = []
    for p in participants:
        row_metrics = {
            key: {"mean": _r6(m.mean), "early": _r6(m.early), "late": _r6(m.late),
                  "delta": _r6(m.late - m.early) if m.comparable else None,
                  "direction": m.direction,
                  "valid_min": _r6(m.valid_sec / 60),
                  "valid_ratio": _r6(m.valid_sec / session_sec) if session_sec > 0 else None}
            for key, m in per_person[p.participant_id].items()
        }
        rows.append({"participant_id": p.participant_id, "state": person_state(p), "metrics": row_metrics})

    return {
        "schema_version": SCHEMA_VERSION,
        "status": status,
        "flags": flags,
        "normalization_version": norm_version,
        "scope": {"attended": attended, "measured": n_meas, "included": included,
                  "duration_min": duration_min, "bucket_min": bucket_min,
                  "split_min": duration_min / 2},
        "metrics": metrics,
        "participants": rows,
    }


# ──────────────────────────── DB 입력 수집 ────────────────────────────

def _ms_of(window) -> float | None:
    """윈도우의 절대 시각(ms). device_timestamp_ms 우선, 없으면 서버 저장 시각(created_at)."""
    if window.device_timestamp_ms is not None:
        return float(window.device_timestamp_ms)
    created = window.created_at
    if created is None:
        return None
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    return created.timestamp() * 1000


def compute_class_stats(db, session) -> dict:
    """명상 클래스 회차의 통계 블록(통계부)을 DB 에서 모아 계산한다. 쓰기·AI·네트워크 호출 없음."""
    from sqlalchemy import and_, or_

    from app.models.eeg_feature import EEGFeatureWindow
    from app.models.normalization_model import NormalizationModel
    from app.models.session import SessionParticipant
    from app.services import eeg_metrics, report_scope
    from app.services.normalization_score import sigmoid_score
    from app.tasks.report_task import _ensure_aware_dt, _longest_usable_run

    scope = report_scope.scope_for_session(session.id, db)
    in_scope = set(scope.included_ids) | set(scope.excluded_ids)
    rows = (
        db.query(SessionParticipant)
        .filter(SessionParticipant.id.in_(in_scope), SessionParticipant.is_waitlisted.is_(False))
        .all()
    ) if in_scope else []
    # 결석·이탈·제거된 참여자는 어떤 집계에도 기여하지 않는다(출석 수에서도 제외).
    present = [r for r in rows
               if r.removed_at is None and r.attendance_status not in ("excused", "withdrawn")]
    attended = len(present)
    included_rows = sorted(
        [r for r in present if r.id in scope.included_ids],
        key=lambda r: (r.joined_at is None, r.joined_at, str(r.id)),
    )

    started, ended = session.started_at, session.ended_at
    if started is not None and ended is not None:
        session_sec = max(0, int((_ensure_aware_dt(ended) - _ensure_aware_dt(started)).total_seconds()))
    else:
        session_sec = int((session.duration_min or 0) * 60)
    duration_min = round(session_sec / 60) if session_sec else int(session.duration_min or 0)

    q = db.query(EEGFeatureWindow).filter(
        EEGFeatureWindow.session_id == session.id,
        EEGFeatureWindow.participant_id.in_([r.id for r in included_rows] or [None]),
    )
    # 구간 필터는 _build_eeg_content 와 같다: device_timestamp_ms 우선, 없으면 created_at.
    if started is not None:
        start_ms = int(_ensure_aware_dt(started).timestamp() * 1000)
        q = q.filter(or_(
            and_(EEGFeatureWindow.device_timestamp_ms.isnot(None), EEGFeatureWindow.device_timestamp_ms >= start_ms),
            and_(EEGFeatureWindow.device_timestamp_ms.is_(None), EEGFeatureWindow.created_at >= started),
        ))
    if ended is not None:
        end_ms = int(_ensure_aware_dt(ended).timestamp() * 1000)
        q = q.filter(or_(
            and_(EEGFeatureWindow.device_timestamp_ms.isnot(None), EEGFeatureWindow.device_timestamp_ms <= end_ms),
            and_(EEGFeatureWindow.device_timestamp_ms.is_(None), EEGFeatureWindow.created_at <= ended),
        ))
    by_person: dict = {}
    for w in q.order_by(EEGFeatureWindow.window_index).all():
        by_person.setdefault(w.participant_id, []).append(w)

    # 정규화 모델: _build_eeg_content 와 같은 선택 규칙(활성 → 없으면 최신).
    model = db.query(NormalizationModel).filter(NormalizationModel.is_active.is_(True)).first()
    if model is None:
        model = db.query(NormalizationModel).order_by(
            NormalizationModel.version.desc(), NormalizationModel.id.desc()).first()
    params = model.params if model is not None and isinstance(model.params, dict) else {}
    version = str(model.version) if model is not None and model.version is not None else None

    def mind(key: str, raw, fallback):
        score = sigmoid_score(key, raw, params.get(key))
        return score if score is not None else fallback(raw)

    if started is not None:
        base_sec = math.floor(_ensure_aware_dt(started).timestamp())
    else:
        all_ms = [m for ws in by_person.values() for w in ws if (m := _ms_of(w)) is not None]
        base_sec = math.floor(min(all_ms) / 1000) if all_ms else 0

    inputs: list[ParticipantInput] = []
    for r in included_rows:
        wins = by_person.get(r.id, [])
        total = len(wins)
        valid = sum(1 for w in wins if w.quality == "valid")
        degraded = sum(1 for w in wins if w.quality == "degraded")
        status = eeg_metrics.evaluate_session_quality(
            total, valid, degraded, _longest_usable_run(wins))[0] if wins else "insufficient"
        stat_windows = []
        for w in wins:
            ms = _ms_of(w)
            if ms is None:
                continue
            stat_windows.append(StatWindow(
                participant_id=str(r.id), window_index=w.window_index, play_group_id=w.play_group_id,
                quality=w.quality, rel_sec=math.floor(ms / 1000) - base_sec,
                respiratory_rate=w.respiratory_rate, heart_rate=w.heart_rate, sdnn=w.sdnn,
                focus_index=mind("focusIndex", w.focus_index, eeg_metrics.normalize_focus),
                relaxation_index=mind("relaxationIndex", w.relaxation_index, eeg_metrics.normalize_relaxation),
                emotional_stability=mind("emotionalStability", w.emotional_stability,
                                         eeg_metrics.normalize_emotional_stability),
            ))
        inputs.append(ParticipantInput(
            participant_id=str(r.id), windows=stat_windows, eeg_status=status, norm_version=version,
            intent="yes" if (wins or r.band_connected) else "no",
        ))
    return compute_stats(inputs, attended=attended, session_sec=session_sec, duration_min=duration_min)
