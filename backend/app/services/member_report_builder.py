"""SDD-327 T5 — 회원 개인 명상 리포트(v11) 조립기.

`build_member_report(db, session_id, participant_id)` 가 DB 의 EEGFeatureWindow 를 읽어
T1(지표 집계) → T2(그룹 분포) → T3(1/f) → T4(문장 규칙, 지연 import) 순으로 이어 붙이고
`MemberReport` 계약으로 검증한 dict 를 돌려준다. 저장(`reports.content["member_report"]`)은 호출자
(`report_task`)가 한다. 기존 4쪽 서사형 리포트 경로와 병행한다.

설계 메모
- 구간(segments): 클래스 단계(준비·호흡/몸 움직임/명상 전·후반)를 기록한 DB 원천은 현재 없다
  (조사: sessions·classes·class_*·live_state(outbox)·session_records 어디에도 단계 시각 컬럼 없음).
  그래서 세션 실제 길이에 시안(2–12/13–31/33–47/48–63분, 총 64분) 비율을 곱해 나눈다.
  단계 기록이 생기면 `resolve_segments` 한 곳만 바꾸면 된다.
- 마음 3지표 0~100 정규화는 `person_minutes_from_windows` 의 `mind_normalizer` 훅에 연결한다
  (집중·감정 균형 = 활성 정규화 모델 시그모이드, 모델 없으면 `eeg_metrics` 폴백 / 이완도 = 두뇌 휴식(TNA)).
- 1/f 는 원시 EEG 를 한 번만 읽어(`load_eeg_array`) 구간 4개 + 5분 타일로 나눠 계산한다
  (`compute_member_aperiodic` 를 구간마다 부르면 S3 를 구간 수만큼 다시 내려받는다).
  그룹 1/f 는 전원의 원시를 디코딩해야 해서 이번 단계에서 만들지 않는다(group=None).
- 문장(conclusion·interpretation 등)은 T4 `apply_wording` 의 몫. 모듈이 아직 없으면 비워 둔다.
"""

from __future__ import annotations

import logging
import math
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Callable, Optional
from zoneinfo import ZoneInfo

import numpy as np

from app.schemas.member_report import (
    BackCover,
    Change,
    Cover,
    GroupBlock,
    Hero,
    Journey,
    MemberMeta,
    MemberReport,
    MemoPage,
    Method,
    MetricBody,
    MetricSection,
    Narrative,
    NextSteps,
    Opinion,
    ReferenceScale,
    Segment,
    Stable5,
    StableSummary,
    Toc,
)
from app.services import member_report_aperiodic as aperiodic_mod
from app.services.member_report_group import compute_group, stable_group_stats
from app.services.member_report_metrics import (
    METRIC_DECIMALS,
    METRIC_UNIT,
    Minutes,
    PersonMinutes,
    StableWindow,
    build_effect_pairs,
    build_series,
    compute_change,
    is_valid_person,
    pick_stable_window,
    person_minutes_from_windows,
    segment_values,
)
from app.services.report_narrative import direction_for_change

logger = logging.getLogger(__name__)

KST = ZoneInfo("Asia/Seoul")

# 시안 총 길이(분)와 구간(양끝 포함) — 세션 길이에 비례해 늘리고 줄인다.
_REF_TOTAL_MIN = 64
_REF_SEGMENTS: tuple[tuple[str, str, int, int], ...] = (
    ("prep", "준비·호흡", 2, 12),
    ("move", "몸 움직임", 13, 31),
    ("first_half", "명상 전반", 33, 47),
    ("second_half", "명상 후반", 48, 63),
)

BODY_KEYS = ("motion", "heart_rate", "rmssd", "lf_hf")
MIND_SECTION_KEYS = ("focus", "relaxation", "emotional_balance")
AP_TILE_MIN = 5  # 1/f 시계열 타일(분)
_FS = aperiodic_mod.FS
_SAMPLES_PER_MIN = 60 * _FS

# ── 정적 문구(시안 v11 구조 문구 — 수치·방향과 무관) ────────────────
_TITLES: dict[str, tuple[str, str]] = {  # 키 → (쪽 제목, 장)
    "motion": ("몸의 움직임", "body"), "heart_rate": ("심박수", "body"), "rmssd": ("RMSSD", "body"),
    "lf_hf": ("LF/HF 흐름", "body"), "focus": ("마음의 변화 · 집중도", "mind"),
    "relaxation": ("이완도", "mind"), "emotional_balance": ("감정 균형도", "mind"),
    "aperiodic": ("뇌파 1/f 기울기", "mind"),
}
_EYEBROW: dict[str, str] = {
    "motion": "02 / 수업 여정 · 몸의 움직임", "heart_rate": "03 / 심장 리듬·자율신경 · 심박수",
    "rmssd": "03 / 심장 리듬·자율신경 · 심박변이 · RMSSD",
    "lf_hf": "03 / 심장 리듬·자율신경 · LF/HF · 수업 흐름", "focus": "04 / 마음 지표 · 집중도",
    "relaxation": "04 / 마음 지표 · 이완도", "emotional_balance": "04 / 마음 지표 · 감정 균형도",
    "aperiodic": "04 / 마음 지표 · 뇌파 1/f 기울기",
}
_INTRO: dict[str, str] = {
    "motion": "가속도 크기는 밴드에서 감지한 움직임의 크기예요.",
    "heart_rate": "심박수는 1분 동안 심장이 뛰는 횟수예요.",
    "rmssd": "RMSSD(이웃한 박동 간격 변화의 크기)는 맥박 사이의 미세한 흔들림을 나타내요. "
             "이 그림의 1분 값과 안정된 5분의 값은 계산 길이가 달라 따로 읽어요.",
    "focus": "집중도는 뇌파로 계산한 서비스 지표예요. 집중 능력이나 수업 참여의 충실함을 뜻하지는 않아요.",
    "relaxation": "이완도는 뇌파로 계산한 서비스 지표예요. 그때의 편안함을 떠올리며 읽어 주세요.",
    "emotional_balance": "감정 균형도는 뇌파로 계산한 서비스 지표예요. 이름만으로 그날의 기분이나 평소 성향을 "
                         "단정할 수 없어, 실제로 느낀 마음과 나란히 살펴봐요.",
    "aperiodic": "1/f 기울기(뇌파의 주파수에 따른 전체적인 감소 모양)는 뇌파를 보는 또 하나의 관점이에요. "
                 "한 가지 값으로 각성이나 이완 상태를 확정하지 않아요.",
}
_SERIES_LEGEND = ("┄ 그룹 중앙 · 진한 띠 50% · 옅은 띠 80% ━ 나의 매분 값 · 신호가 없는 분은 선을 끊었어요 · "
                  "배경: 비교 전/후 · 짧은 점선: 나의 구간 중앙값")
_SERIES_LEGEND_NO_GROUP = "━ 나의 매분 값 · 신호가 없는 분은 선을 끊었어요 · 배경: 비교 전/후 · 짧은 점선: 나의 구간 중앙값"
_LF_HF_LEGEND = "━ 나의 매분 값 · 신호가 없는 분은 선을 끊었어요"
_LF_HF_SOURCE = "출처: 서비스 저장 LF/HF 1분 값(보정 전). 같은 사람 안의 오르내림만 살펴봐요."
_APERIODIC_RESULT_NOTE = ("결과 해석 · 원시 뇌파 4초 창에서 재계산하고 신호 기준을 통과한 분만 표시해요. "
                          "절대적인 건강 기준이나 각성·이완의 확정 판정은 붙이지 않아요.")
_GROUP_LEGEND = "━ 그룹 분포 · 옅은 음영: 평균 ± 1SD 막대 나의 매분 값 · 세로선: 각각의 평균 · 평균선: 실선 나 / 점선 그룹"

# 안정된 5분 참고 띠 (HR = AHA 성인 안내 범위, 나머지 = Voss 등(2015) 25–49세 여성 평균 ± 1SD)
_REF_SCALES: dict[str, dict] = {
    "heart_rate": dict(
        title="안정 심박 회/분", unit="회/분", band_lo=60.0, band_hi=100.0, axis_min=40.0, axis_max=120.0,
        range_note="성인 안정 시 안내 범위 [1] · 60–100회/분", pill_name="성인 안내 범위",
        meaning=["낮은 쪽 느린 맥박 · 운동 습관·약물 영향도 있어요", "참고 띠 일반 성인 안내 범위에 들어요",
                 "높은 쪽 빠른 맥박 · 긴장·체온 등도 영향을 줘요"],
        explain="이번 맥박 위치를 참고 띠와 비교한 것이에요. 한 번의 값만으로 이상 여부를 판단하지 않아요.",
        overview_line="평소 맥박과 함께 살펴볼 위치예요. [1]"),
    "rmssd": dict(
        title="RMSSD ms", unit="ms", band_lo=16.4, band_hi=56.6, axis_min=0.0, axis_max=90.0,
        range_note="25–49세 여성 · 연구 평균 ± 1SD [2] · 16.4–56.6ms", pill_name="참고 띠",
        meaning=["낮은 쪽 박동 간 미세한 변동이 작은 쪽이에요", "참고 띠 연구집단의 참고 띠 안이에요",
                 "높은 쪽 변동이 큰 쪽 · 잡음·불규칙 박동도 확인해요"],
        explain="휴식 신경과 관련된 변동이에요. 수면·피로·호흡과 측정 조건을 함께 봐요.",
        overview_line="이웃한 박동 간격의 미세한 변화를 봐요. [2]"),
    "sdnn": dict(
        title="SDNN ms", unit="ms", band_lo=25.7, band_hi=64.1, axis_min=0.0, axis_max=100.0,
        range_note="25–49세 여성 · 연구 평균 ± 1SD [2] · 25.7–64.1ms", pill_name="참고 띠",
        meaning=["낮은 쪽 5분간 박동 간격의 변동이 작은 쪽이에요", "참고 띠 연구집단의 참고 띠 안이에요",
                 "높은 쪽 변동이 큰 쪽 · 무조건 건강하다는 뜻은 아니에요"],
        explain="5분 동안의 전체 변동이에요. 24시간 SDNN의 판단 기준을 여기에 적용하지 않아요.",
        overview_line="안정된 5분 전체의 변동을 봐요. [2]"),
}

_NEXT_STEPS = dict(
    eyebrow="05 / 다음 걸음", title="오늘의 변화를, 다음 만남으로 이어가요",
    body="이번 수업에서 보인 변화는 회원님을 규정하는 성격표가 아니에요. 몸이 반응한 순간을 기억하고 같은 조건에서 "
         "다시 살펴보면, 나만의 흐름을 조금 더 알아갈 수 있어요.",
)
_METHOD = dict(
    eyebrow="06 / 측정·분석 안내", title="숫자의 의미는, 측정 조건과 함께 읽어요",
    body="같은 숫자라도 측정 길이와 장비, 계산 방식이 다르면 의미가 달라져요. 이번 기록에서 비교한 대상과 계산 기준을 "
         "함께 남겨 두었어요.",
    reading_title="읽는 방법과 한계",
    footnote="[1] AHA, All About Heart Rate(2024). [2] Voss 등(2015), 표 3: 여성 571명, 5–10분 휴식 후 누운 자세·"
             "5분 ECG 500Hz. [3] Billman(2013). 이번 값은 이마 PPG 50Hz의 맥박 간격 변동(PRV)이므로 ECG HRV와 "
             "같다고 볼 수 없어요. 자세·호흡 통제도 동일하게 확인되지 않았어요.",
    references_title="참고 문헌",
    references=[
        "AHA(2024). All About Heart Rate.", "Voss 등(2015). PLOS ONE 10:e0118308, 표 3.",
        "Billman(2013). LF/HF와 자율신경 균형 해석의 한계.", "Shaffer & Ginsberg(2017). HRV 지표와 규준.",
        "PPG 측정 위치·표본화 주파수 연구(2024), PMID 38610260.",
    ],
    references_checked="문헌 확인: 2026.11.13 · 상세 확인 기록은 함께 제공되는 references.md에 있어요.",
    contact_title="문의 안내",
    contact_body="리포트에 관한 질문은 프로그램 담당자에게 전달해 주세요. 문의: 담당 클래스 코치",
)


# ── 기초 유틸 ──────────────────────────────────────────────────────
def _fmt(value: Optional[float], decimals: int) -> str:
    return "-" if value is None else f"{value:.{decimals}f}"


def _utc(dt: datetime) -> datetime:
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


def _ms_of(row: object) -> Optional[float]:
    """윈도우의 절대 시각(ms). device_timestamp_ms 우선, 없으면 created_at (class_report_stats_service 와 동일)."""
    dev = getattr(row, "device_timestamp_ms", None)
    if dev is not None:
        return float(dev)
    created = getattr(row, "created_at", None)
    return None if created is None else _utc(created).timestamp() * 1000


# ── 구간 ──────────────────────────────────────────────────────────
def scale_segments(total_min: int) -> list[Segment]:
    """시안 구간을 세션 길이(분)에 비례해 늘리고 줄인다. total_min=64 면 시안과 같다."""
    scale = max(total_min, 1) / _REF_TOTAL_MIN
    segs: list[Segment] = []
    prev_end = -1
    for key, label, a, b in _REF_SEGMENTS:
        start = max(int(round(a * scale)), prev_end + 1 if segs else 0)
        end = max(int(round((b + 1) * scale)) - 1, start)
        segs.append(Segment(key=key, label=label, start_min=start, end_min=end))  # type: ignore[arg-type]
        prev_end = end
    return segs


def resolve_segments(
    db, session, last_window_min: Optional[int]
) -> tuple[list[Segment], str]:
    """(구간 4개, 원천 이름). 클래스 단계 기록이 DB 에 없어 세션 길이 비례 분할만 쓴다.

    길이 = 실제 시작~종료, 없으면 예정 시간(duration_min), 윈도우가 그보다 길면 윈도우 끝까지.
    """
    started, ended = session.started_at, session.ended_at
    if started is not None and ended is not None:
        total = int((_utc(ended) - _utc(started)).total_seconds() // 60)
        source = "proportional:actual_duration"
    else:
        total = int(session.duration_min or 0)
        source = "proportional:planned_duration"
    if last_window_min is not None and last_window_min + 1 > total:
        total = last_window_min + 1
        source = "proportional:window_extent"
    if total <= 0:
        total = _REF_TOTAL_MIN
        source = "proportional:default"
    return scale_segments(total), source


# ── 마음 지표 정규화 훅 ────────────────────────────────────────────
def make_mind_normalizer(db) -> Callable[[str, float], Optional[float]]:
    """(지표 키, 원값) → 0~100. class_report_stats_service 와 같은 모델 선택·매핑 규칙.

    relaxation 의 원값은 totalNeuralActivity(TNA) — 이완도 = 두뇌 휴식(TNA 반전).
    """
    from app.models.normalization_model import NormalizationModel
    from app.services import eeg_metrics
    from app.services.normalization_score import brain_rest_score, sigmoid_score

    model = db.query(NormalizationModel).filter(NormalizationModel.is_active.is_(True)).first()
    if model is None:
        model = db.query(NormalizationModel).order_by(
            NormalizationModel.version.desc(), NormalizationModel.id.desc()).first()
    params = model.params if model is not None and isinstance(model.params, dict) else {}

    def normalize(key: str, raw: float) -> Optional[float]:
        if key == "focus":
            score = sigmoid_score("focusIndex", raw, params.get("focusIndex"))
            return score if score is not None else eeg_metrics.normalize_focus(raw)
        if key == "emotional_balance":
            score = sigmoid_score("emotionalStability", raw, params.get("emotionalStability"))
            return score if score is not None else eeg_metrics.normalize_emotional_stability(raw)
        if key == "relaxation":
            return brain_rest_score(raw, params)  # 모델·TNA 없으면 None(0 금지)
        return raw

    return normalize


# ── DB 로딩 ───────────────────────────────────────────────────────
@dataclass
class _Roster:
    session: object
    me: object
    me_ordinal: int
    others: list  # 나를 뺀, 같은 회차 리포트 반영 참여자


def _load_roster(db, session_id: uuid.UUID, participant_id: uuid.UUID) -> _Roster:
    from app.models.session import Session, SessionParticipant
    from app.services import report_scope

    session = db.query(Session).filter(Session.id == session_id).first()
    if session is None:
        raise ValueError(f"세션을 찾을 수 없습니다: {session_id}")
    me = db.query(SessionParticipant).filter(
        SessionParticipant.id == participant_id, SessionParticipant.session_id == session_id).first()
    if me is None:
        raise ValueError(f"참여자를 찾을 수 없습니다: {participant_id}")

    scope = report_scope.scope_for_session(session_id, db)
    ids = set(scope.included_ids)
    rows = db.query(SessionParticipant).filter(
        SessionParticipant.session_id == session_id, SessionParticipant.id.in_(ids or {participant_id}),
        SessionParticipant.is_waitlisted.is_(False)).all()
    # 결석·이탈·제거 참여자는 어떤 집계에도 기여하지 않는다(class_report_stats_service 와 동일).
    present = [r for r in rows if r.removed_at is None and r.attendance_status not in ("excused", "withdrawn")]
    ordered = sorted(present, key=lambda r: (r.joined_at is None, r.joined_at, str(r.id)))
    ordinal = next((i + 1 for i, r in enumerate(ordered) if r.id == me.id), len(ordered) + 1)
    return _Roster(session=session, me=me, me_ordinal=ordinal, others=[r for r in ordered if r.id != me.id])


def _load_windows(db, session_id: uuid.UUID, pids: list[uuid.UUID]) -> dict[uuid.UUID, list]:
    from app.models.eeg_feature import EEGFeatureWindow as W

    if not pids:
        return {}
    cols = (W.participant_id, W.window_index, W.quality, W.device_timestamp_ms, W.created_at, W.motion,
            W.heart_rate, W.rmssd, W.sdnn, W.lf_hf_ratio, W.focus_index, W.total_neural_activity,
            W.emotional_stability)
    out: dict[uuid.UUID, list] = {}
    for r in db.query(*cols).filter(W.session_id == session_id, W.participant_id.in_(pids)).all():
        out.setdefault(r.participant_id, []).append(r)
    return out


def _to_person_minutes(rows: list, base_sec: int, normalizer) -> PersonMinutes:
    """DB 행 → 1초 윈도우 → 지표별 분 시계열. relaxation 의 원값은 TNA(정규화 훅이 두뇌 휴식으로 바꾼다)."""
    ws = []
    for r in rows:
        ms = _ms_of(r)
        if ms is None:
            continue
        ws.append(SimpleNamespace(
            rel_sec=math.floor(ms / 1000) - base_sec, quality=r.quality, motion=r.motion,
            heart_rate=r.heart_rate, rmssd=r.rmssd, sdnn=r.sdnn, lf_hf_ratio=r.lf_hf_ratio,
            focus_index=r.focus_index, relaxation_index=r.total_neural_activity,
            emotional_stability=r.emotional_stability))
    return person_minutes_from_windows(ws, mind_normalizer=normalizer)


# ── 1/f ───────────────────────────────────────────────────────────
def _raw_array(db, session_id, participant_id, t_lo_ms: float, t_hi_ms: float, reader=None):
    """참여자의 [t_lo, t_hi] 원시 EEG (2, n) 배열. 없으면 None. 테스트에서 이 함수만 바꿔 끼운다."""
    from sqlalchemy import select

    from app.models.record import EEGRawChunk

    if reader is None:
        from app.services import storage_service

        reader = storage_service.download_bytes
    rows = list(db.execute(select(EEGRawChunk).where(
        EEGRawChunk.session_id == session_id, EEGRawChunk.participant_id == participant_id,
        EEGRawChunk.signal_type == "eeg", EEGRawChunk.upload_status == "uploaded")).scalars())
    if not rows:
        return None
    return aperiodic_mod.load_eeg_array(rows, reader, t_lo_ms, t_hi_ms)


@dataclass
class _ApResult:
    by_segment: dict[str, aperiodic_mod.AperiodicResult]
    tiles: Minutes  # {분: 지수} — 5분 타일 값을 타일 안 모든 분에 둔다


def compute_aperiodic_parts(
    db, session_id, participant_id, base_ms: float, segments: list[Segment], first: int, last: int, reader=None
) -> _ApResult:
    """원시를 한 번 읽어 구간 4개와 5분 타일의 1/f 를 계산한다. 어떤 실패도 예외로 올리지 않는다."""
    missing = aperiodic_mod.AperiodicResult(state="missing", missing_reason="no_raw")
    none_result = _ApResult({s.key: missing for s in segments}, {})
    try:
        t_lo = base_ms + first * 60_000
        t_hi = base_ms + (last + 1) * 60_000
        arr = _raw_array(db, session_id, participant_id, t_lo, t_hi, reader)
        if arr is None:
            return none_result

        def slice_min(a: int, b: int) -> np.ndarray:  # [a, b] 분, 양끝 포함
            return arr[:, (a - first) * _SAMPLES_PER_MIN:(b + 1 - first) * _SAMPLES_PER_MIN]

        by_segment = {s.key: aperiodic_mod.compute_aperiodic(slice_min(s.start_min, s.end_min)) for s in segments}
        tiles: Minutes = {}
        m = first
        while m + AP_TILE_MIN - 1 <= last:
            res = aperiodic_mod.compute_aperiodic(slice_min(m, m + AP_TILE_MIN - 1))
            if res.state == "ok" and res.exponent is not None:
                for k in range(m, m + AP_TILE_MIN):
                    tiles[k] = float(res.exponent)
            m += AP_TILE_MIN
        return _ApResult(by_segment, tiles)
    except Exception as exc:  # noqa: BLE001 — 1/f 실패가 리포트 생성을 막지 않는다
        logger.warning("[member_report] 1/f 산출 실패: %s", exc)
        return none_result


# ── 지표 섹션 ──────────────────────────────────────────────────────
def _missing_section(key: str, reason: str) -> MetricSection:
    title, chapter = _TITLES[key]
    return MetricSection(key=key, title=title, chapter=chapter, state="missing",  # type: ignore[arg-type]
                         missing_reason=reason, body=None)  # type: ignore[arg-type]


def _group_block(key: str, res, mine: Minutes, first: int, last: int) -> GroupBlock:
    dec = METRIC_DECIMALS[key]
    d = res.distribution
    diff = d.mean_me - d.mean_group
    rel = "비슷한" if abs(diff) <= 0.25 * d.sd_group else ("높은" if diff > 0 else "낮은")
    explain = (f"{_INTRO[key]} 수업 전체에서 회원님 평균은 {_fmt(d.mean_me, dec)}, 같은 수업의 매분 값 전체 평균은 "
               f"{_fmt(d.mean_group, dec)}예요. 회원님 값은 그보다 {rel} 편이었어요.")
    unit = METRIC_UNIT[key]
    note = ("*나와 그룹 값이 함께 있는 분만 비교했어요. 그룹의 매분 중앙값을 구간 안에서 다시 중앙값으로 묶었어요. "
            f"단위: {unit}. 분포: {d.n_people}명·{d.n_person_minutes}개 사람-분 / 나: {d.my_minutes}분. "
            f"유효한 분이 {10}개 이상인 참여자만 그룹에 포함해요. 그룹에는 회원님도 포함돼요.")
    return GroupBlock(title="그룹은 보조로 · 같은 수업 기록과 함께 읽어요", explain=explain, distribution=d,
                      rows=res.rows, table_note=note, legend=_GROUP_LEGEND)


def _band_extra(band) -> list[float]:
    return [v for arr in (band.p10, band.p90) for v in arr if v is not None]


def _metric_section(
    key: str, mine: Minutes, others: dict[str, Minutes], segments: list[Segment], first: int, last: int
) -> tuple[MetricSection, Optional[Change]]:
    """분 시계열 지표 한 개 → 섹션(+히어로용 변화량). 신호 부족이면 poor_signal 결측."""
    title, chapter = _TITLES[key]
    if not is_valid_person(mine, first, last):
        return _missing_section(key, "poor_signal"), None
    dec = METRIC_DECIMALS[key]
    if key == "lf_hf":
        # 흐름 전용: 전후 변화량·그룹 없음 (시안과 같이 0 변화 자리표시)
        change = Change(before=0.0, after=0.0, delta=0.0, direction="stable", decimals=dec,
                        unit=METRIC_UNIT[key], label="변화량 미표시(흐름 전용)")
        body = MetricBody(
            eyebrow=_EYEBROW[key], conclusion="", bridge=None, change=change,
            series=build_series(key, mine, first, last), series_legend=_LF_HF_LEGEND, my_segments=[],
            interpretation="", reading=None, result_note=None, source_note=_LF_HF_SOURCE,
            group=None, group_hidden_reason=None)
        return MetricSection(key=key, title=title, chapter=chapter, state="ok", body=body), None  # type: ignore[arg-type]

    change = compute_change(key, mine, segments, first, last)
    if change is None:
        return _missing_section(key, "poor_signal"), None
    res = compute_group(key, mine, others, first, last, segments)
    band = res.band if res is not None else None
    series = build_series(key, mine, first, last, group_band=band,
                          extra_axis_values=_band_extra(band) if band is not None else ())
    body = MetricBody(
        eyebrow=_EYEBROW[key], conclusion="", bridge=None, change=change, series=series,
        series_legend=_SERIES_LEGEND if res is not None else _SERIES_LEGEND_NO_GROUP,
        my_segments=segment_values(mine, segments, dec), interpretation="", reading=None, result_note=None,
        source_note=None, group=_group_block(key, res, mine, first, last) if res is not None else None,
        group_hidden_reason=None if res is not None else "min_n")
    return MetricSection(key=key, title=title, chapter=chapter, state="ok", body=body), change  # type: ignore[arg-type]


def _aperiodic_section(ap: _ApResult, segments: list[Segment], first: int, last: int) -> MetricSection:
    """1/f 섹션. 준비·호흡/명상 후반 값이 모두 있어야 전후 변화를 낸다. 그룹은 만들지 않는다(group=None)."""
    prep = ap.by_segment.get("prep")
    late = ap.by_segment.get("second_half")
    for res in (prep, late):
        if res is None or res.state != "ok":
            reason = (res.missing_reason if res is not None else None) or "no_raw"
            return _missing_section("aperiodic", reason)
    dec = METRIC_DECIMALS["aperiodic"]
    before, after = round(float(prep.exponent), dec), round(float(late.exponent), dec)  # type: ignore[arg-type]
    direction = direction_for_change(before, after, None) or "stable"  # type: ignore[assignment]
    change = Change(before=before, after=after, delta=round(after - before, dec), direction=direction,
                    decimals=dec, unit=METRIC_UNIT["aperiodic"], label=METRIC_UNIT["aperiodic"])
    my_segments = [
        {"segment_key": s.key, "value": (round(float(ap.by_segment[s.key].exponent), dec)  # type: ignore[arg-type]
                                         if ap.by_segment[s.key].state == "ok" else None)}
        for s in segments
    ]
    body = MetricBody(
        eyebrow=_EYEBROW["aperiodic"], conclusion="", bridge=None, change=change,
        series=build_series("aperiodic", ap.tiles, first, last), series_legend=_SERIES_LEGEND_NO_GROUP,
        my_segments=my_segments, interpretation="", reading=None, result_note=_APERIODIC_RESULT_NOTE,  # type: ignore[arg-type]
        source_note=None, group=None, group_hidden_reason=None)
    title, chapter = _TITLES["aperiodic"]
    return MetricSection(key="aperiodic", title=title, chapter=chapter, state="ok", body=body)  # type: ignore[arg-type]


# ── 안정된 5분 ─────────────────────────────────────────────────────
def _scale(key: str, value: float, group_median: Optional[float], group_n: Optional[int]) -> ReferenceScale:
    spec = _REF_SCALES[key]
    dec = 1
    shown = round(value, dec)
    lo, hi = spec["band_lo"], spec["band_hi"]
    if shown < lo:
        side, pill_pos, overview = "below", "아래", "범위 밖"
    elif shown > hi:
        side, pill_pos, overview = "above", "위", "범위 밖"
    else:
        side, pill_pos = "within", "안"
        overview = "경계" if shown in (lo, hi) else "범위 안"
    pill = f"{spec['pill_name']} {pill_pos}"
    note = ("같은 수업 안정된 5분 중앙: 움직임 오염 표시가 없는 "
            f"{group_n}명 · 연구 띠와 별개예요.") if group_n else "같은 수업 비교는 인원이 부족해 보여드리지 않아요. 연구 띠와 별개예요."
    return ReferenceScale(
        key=key, title=spec["title"], value=shown, decimals=dec, unit=spec["unit"], pill=pill,  # type: ignore[arg-type]
        overview_position=overview, side=side, range_note=spec["range_note"],  # type: ignore[arg-type]
        band_lo=lo, band_hi=hi, axis_min=spec["axis_min"], axis_max=spec["axis_max"],
        group_median=group_median, group_n=group_n, meaning=list(spec["meaning"]),
        explain=spec["explain"], note=note, overview_line=spec["overview_line"])


def _stable5(win: Optional[StableWindow], others_wins: list[Optional[StableWindow]]) -> Optional[Stable5]:
    if win is None:
        return None
    scales: list[ReferenceScale] = []
    for key in ("heart_rate", "rmssd", "sdnn"):
        val = getattr(win, key)
        if val is None:
            continue
        gm, gn = stable_group_stats(key, others_wins)
        scales.append(_scale(key, val, gm, gn))
    if not scales:
        return None
    return Stable5(
        window_label=win.window_label, eyebrow="03 / 심장 리듬·자율신경",
        title="안정된 5분은, 나를 살피는 또 하나의 기준이에요",
        narrative="수업에서 움직임이 가장 적었던 연속 5분을 따로 모아 심장 리듬을 살펴봤어요. RMSSD는 이웃한 박동 간격의 "
                  "변화, SDNN은 5분 전체 박동 간격의 변동을 뜻해요. LF/HF는 느린 변동과 빠른 변동의 상대 비중으로, "
                  "자율신경의 균형을 판정하는 수치는 아니에요.",
        scales=scales,
        reading="이렇게 읽어요 · ●는 나, ▲는 같은 수업의 안정 5분 중앙값이에요. 진한 띠는 문헌 참고 범위예요.",
        callout_title="참고 띠와 정상 판정은 달라요.",
        callout_body="HR은 AHA 성인 안내 범위예요. 나머지 띠는 Voss 연구의 25–49세 여성 평균 ± 1표준편차를 표시한 것으로, "
                     "임상 정상구간이나 95% 참고구간이 아니에요. LF/HF에는 건강 판정을 붙이지 않아요.",
        contaminated=win.contaminated)


def _interpret_body(stable: Optional[Stable5]) -> str:
    tail = ("박동 간격의 변화인 RMSSD와 SDNN은 연구집단 안에서의 위치를 보여 주며, 개인의 상태를 확정하지 않아요.")
    if stable is None:
        return "이번 수업에서는 안정된 5분의 참고 위치를 계산할 만큼 신호가 충분하지 않았어요. " + tail
    hr = next((s for s in stable.scales if s.key == "heart_rate"), None)
    if hr is None:
        return tail
    return (f"안정 심박은 {hr.value:.1f}회/분으로 {hr.pill}에 있어요. 평소 맥박·운동 습관·약물과 함께 읽어 주세요. " + tail)


# ── 메타·표지 ──────────────────────────────────────────────────────
def _reference_group_text(me) -> Optional[str]:
    """내 성별·생년월일로 만든 참고 집단 문구. 둘 다 없으면 None(표시 생략)."""
    gender = (getattr(me, "gender", None) or "").strip().lower()
    g = "여성" if gender.startswith(("f", "여")) else ("남성" if gender.startswith(("m", "남")) else None)
    birth = getattr(me, "birth_date", None)
    decade = None
    if birth is not None:
        age = datetime.now(KST).year - birth.year
        decade = f"{(age // 10) * 10}대" if age >= 10 else None
    if g is None and decade is None:
        return None
    label = " ".join(x for x in (decade, g) if x)
    return f"{label} · 연구 비교는 연령 조건 충족 시 적용"


def _build_meta(db, roster: _Roster, segments: list[Segment], band_status: str, stable: Optional[Stable5]) -> MemberMeta:
    from app.models.class_program import Class

    session = roster.session
    program = session.title or "명상 수업"
    if getattr(session, "class_id", None):
        cls_row = db.get(Class, session.class_id)
        if cls_row is not None and cls_row.title:
            program = cls_row.title
    seq = getattr(session, "seq", None)
    program_label = f"{program} {seq}회차" if seq else program
    ref = session.started_at or session.scheduled_at
    local = _utc(ref).astimezone(KST) if ref is not None else datetime.now(KST)
    first, last = segments[0].start_min, segments[-1].end_min
    basis = (f"수업 {first}–{last}분" + (f" · 안정 상태 5분 {stable.window_label}" if stable is not None else "")
             if band_status == "worn" else "수업 참여 기록")
    return MemberMeta(
        member_code=f"B{seq or 1}-{roster.me_ordinal}", program_label=program_label,
        chapter_label=f"章 1 · {program_label} · {local:%m/%d}", session_date=f"{local:%Y-%m-%d}",
        start_clock=f"{local:%H:%M}",
        device_text="LINK BAND 2.0 · 뇌파 2채널 · 이마 맥파" if band_status == "worn" else "LINK BAND 미착용",
        basis_text=basis, reference_group_text=_reference_group_text(roster.me) if band_status == "worn" else None,
        issued_on=f"{datetime.now(KST):%Y-%m-%d}", volume_label="VOLUME 01", band_status=band_status,  # type: ignore[arg-type]
        segments=segments, first_minute=first, last_minute=last)


def _cover(meta: MemberMeta) -> Cover:
    d = datetime.strptime(meta.session_date, "%Y-%m-%d")
    issued = datetime.strptime(meta.issued_on, "%Y-%m-%d")
    rows = [("회원님", meta.member_code), ("프로그램", meta.program_label),
            ("측정일시", f"{d:%Y.%m.%d} · 시작 {meta.start_clock}"), ("측정 장비", meta.device_text),
            ("분석 기준", meta.basis_text)]
    if meta.reference_group_text:
        rows.append(("참고 집단", meta.reference_group_text))
    return Cover(
        kicker=f"PERSONAL RHYTHM REPORT / {issued:%Y.%m}", title="마음·몸\n리듬 리포트",
        tagline="몸을 깨운 시간에서\n고요하게 나를 만나는 시간으로.", rows=rows, brand="MIND BREEZE · Looxid Labs",
        footer="한 번의 수업에서 관찰한 몸과 마음의 기록이에요.", issued_note=f"발행일 {issued:%Y.%m.%d}")


def _hero(meta: MemberMeta, pairs, stable: Optional[Stable5]) -> Hero:
    seg = {s.key: s for s in meta.segments}
    stable_summary = None
    if stable is not None:
        lines = []
        hr = next((s for s in stable.scales if s.key == "heart_rate"), None)
        if hr is not None:
            lines.append(f"심박 {hr.value:.1f}회/분 · {hr.pill}")
        rs = [s for s in stable.scales if s.key in ("rmssd", "sdnn")]
        if rs:
            lines.append(" · ".join(f"{s.key.upper()} {s.value:.1f}ms" for s in rs)
                         + (f" · 연구 참고 범위 {rs[0].pill.replace('참고 띠 ', '')}" if len({s.side for s in rs}) == 1 else ""))
        stable_summary = StableSummary(title="안정된 5분의 참고 위치", lines=lines,
                                       note="구간 전후 비교와는 별개의 기록이에요. 나의 느낌과 함께 읽어요.")
    worn = meta.band_status == "worn"
    return Hero(
        kicker=f"{meta.program_label} · {meta.member_code} · 나의 변화", headline="", lead="",
        pair_caption_before=f"전 · {seg['prep'].label} {seg['prep'].start_min}–{seg['prep'].end_min}분" if pairs else None,
        pair_caption_after=(f"후 · {seg['second_half'].label} {seg['second_half'].start_min}–"
                            f"{seg['second_half'].end_min}분") if pairs else None,
        pairs=pairs,
        caution=("별도 사전 측정이 아닌 수업 안의 구간 중앙값 비교예요.\n명상만의 영향인지는 이 기록으로 확인할 수 없어요."
                 if pairs and worn else None),
        other_directions=None, stable_summary=stable_summary)


# ── 조립 ──────────────────────────────────────────────────────────
def _empty_wording_parts(meta: MemberMeta, hero: Hero, journey, stable, metrics, band_status: str) -> dict:
    return dict(
        schema_version="member_report.v1", meta=meta, cover=_cover(meta),
        toc=Toc(heading="CONTENTS", chapter_title="내가 머문 시간들", chapter_subtitle="오늘의 한 장을 펼쳐 봅니다.",
                next_chapter_note="다음 장은 다음 수업 뒤에 이어집니다",
                guide="목차는 이 책의 쪽번호입니다. 본문에 남긴 원문 쪽 안내는 이전 기록과 대조하기 위한 표시예요."),
        hero=hero,
        opinion=Opinion(
            narrative=Narrative(eyebrow="01 / 종합 소견", title="", body="", source="rule"),
            table_title="참고 범위로 본 나의 심장·자율신경 리듬", interpret_title="결과 해석",
            interpret_body=_interpret_body(stable),
            reading="이렇게 읽어요 · 종합 소견을 읽은 뒤, 수업의 흐름과 안정된 5분을 나누어 살펴보세요.",
            footnote="[1–3] 문헌과 측정 한계는 방법 쪽에 있어요. 이마 맥파와 연구의 심전도는 측정 방식이 달라요.",
            legend_note="● 범위 안 · ● 경계(양 끝값과 일치) · ● 범위 밖 / 색과 문구는 참고 띠의 위치만 나타내요. "
                        "안정 심박은 성인 안내 범위, 나머지는 연구집단의 평균 ± 1표준편차예요."),
        journey=journey, stable5=stable, metrics=metrics,
        next_steps=NextSteps(items=[], **_NEXT_STEPS),
        memo=MemoPage(eyebrow="A NOTE TO MYSELF", title="오늘의 나에게 남기는 말",
                      prompt="수업에서 기억에 남는 순간을, 나의 말로 적어 보세요.",
                      labels=["몸에 남은 감각", "마음에 머문 장면", "다음 수업까지 이어가고 싶은 것"]),
        method=Method(paragraphs=[
            "한 번의 클래스 기록이에요. 그룹 비교는 같은 수업 회차 안에서만 해요. 분포는 사람별 평균의 분포가 아니라 유효한 "
            "매분 값 전체의 분포여서, 유효 분이 많은 참여자의 기여가 커요. 곡선은 관측값을 부드럽게 표현한 밀도이고 "
            "정규분포를 가정하지 않아요.",
            "시간 띠는 매분 5명 이상일 때만 표시해요. 서비스 지표는 해당 분의 유효 비율 50% 이상을 사용했어요. 뇌파는 "
            "2채널 250Hz, 맥파는 이마 50Hz예요. PPG의 맥박 검출·호흡·자세·수면·약물 등에 영향을 받아요. 안정된 5분의 "
            "눈 감은 안정 상태는 수업 브리프에 따른 구간 정의이며 생리적 정상성을 보증하지 않아요.",
        ], **{**_METHOD, "references": [dict(text=t) for t in _METHOD["references"]]}),
        back=BackCover(kicker="TO BE CONTINUED", title="다음 시간에도,\n나의 속도로.",
                       subtitle="다음 장은 다음 수업 뒤에 이어집니다.", brand="MIND BREEZE · Looxid Labs",
                       note=f"발행일 {datetime.strptime(meta.issued_on, '%Y-%m-%d'):%Y.%m.%d}",
                       contact="문의: 담당 클래스 코치"),
        forbidden_words_checked=False,
    )


def _apply_wording(parts: dict) -> dict:
    """T4 문장 규칙을 지연 import 로 적용한다. 모듈이 아직 없으면 문장을 비운 채 돌려준다."""
    try:
        from app.services.member_report_wording import apply_wording  # type: ignore[import-not-found]
    except ImportError:
        logger.info("[member_report] member_report_wording 없음 — 문장 비움")
        return parts
    worded = apply_wording(parts)
    worded["forbidden_words_checked"] = True
    return worded


def build_member_report(
    db, session_id: uuid.UUID | str, participant_id: uuid.UUID | str, raw_reader=None
) -> dict:
    """회원 한 명의 v11 리포트(MemberReport 계약 dict, JSON 직렬화 가능)를 만든다.

    - 밴드 미착용(유효 윈도우 없음)이면 모든 지표를 band_not_worn 결측으로 둔다(0 채움 금지).
    - 그룹 = 같은 회차의 다른 리포트 반영 참여자. 유효 인원 < MIN_GROUP_N 이면 그룹·띠 숫자를 보내지 않는다.
    """
    sid = session_id if isinstance(session_id, uuid.UUID) else uuid.UUID(str(session_id))
    pid = participant_id if isinstance(participant_id, uuid.UUID) else uuid.UUID(str(participant_id))
    roster = _load_roster(db, sid, pid)
    session = roster.session
    by_pid = _load_windows(db, sid, [pid, *[r.id for r in roster.others]])

    # 시간 기준(수업 시작 초). 시작 시각이 없으면 가장 이른 윈도우.
    if session.started_at is not None:
        base_sec = math.floor(_utc(session.started_at).timestamp())
    else:
        all_ms = [m for rows in by_pid.values() for r in rows if (m := _ms_of(r)) is not None]
        base_sec = math.floor(min(all_ms) / 1000) if all_ms else 0

    normalizer = make_mind_normalizer(db)
    mine_rows = by_pid.get(pid, [])
    person = _to_person_minutes(mine_rows, base_sec, normalizer)
    last_window_min = max((m for ms in person.values() for m in ms), default=None)
    segments, seg_source = resolve_segments(db, session, last_window_min)
    first, last = segments[0].start_min, segments[-1].end_min
    logger.info("[member_report] 구간 원천=%s 분석=%s–%s분 session=%s", seg_source, first, last, sid)

    # 착용 판정은 EEG 유효 창 기준 유지 — EEG 가 전부 포화·평탄(미착용)인 회차의 PPG 값(고정 HR 등)은 신뢰하지 않는다
    worn = any(r.quality != "invalid" for r in mine_rows)
    band_status = "worn" if worn else "not_worn"

    if not worn:
        metrics = {k: _missing_section(k, "band_not_worn") for k in (*BODY_KEYS, *MIND_SECTION_KEYS, "aperiodic")}
        meta = _build_meta(db, roster, segments, band_status, None)
        parts = _empty_wording_parts(meta, _hero(meta, [], None), None, None, metrics, band_status)
        parts["hero"] = parts["hero"].model_copy(update={"stable_summary": None})
        return _finish(_apply_wording(_dump(parts)))

    others_minutes: dict[str, PersonMinutes] = {
        str(r.id): _to_person_minutes(by_pid.get(r.id, []), base_sec, normalizer) for r in roster.others}

    metrics: dict = {}
    changes: dict[str, Optional[Change]] = {}
    for key in (*BODY_KEYS, *MIND_SECTION_KEYS):
        others = {opid: pm.get(key, {}) for opid, pm in others_minutes.items()}
        sec, change = _metric_section(key, person.get(key, {}), others, segments, first, last)
        metrics[key] = sec
        changes[key] = change

    ap = compute_aperiodic_parts(db, sid, pid, base_sec * 1000.0, segments, first, last, raw_reader)
    metrics["aperiodic"] = _aperiodic_section(ap, segments, first, last)

    win = pick_stable_window(person, segments, first, last)
    others_wins = [pick_stable_window(pm, segments, first, last) for pm in others_minutes.values()]
    stable = _stable5(win, others_wins)

    meta = _build_meta(db, roster, segments, band_status, stable)
    pairs = build_effect_pairs(changes)
    ok_keys = {k for k, s in metrics.items() if s.state == "ok"}
    journey = Journey(
        eyebrow="02 / 수업 여정", title="움직임을 지나, 고요하게 머문 시간이에요",
        body="준비하며 호흡을 살핀 뒤 몸을 움직이고, 명상 전반과 후반으로 이어졌어요. 아래 그림은 같은 시간에 몸의 움직임과 "
             "심박, 이완도 지표가 어떻게 달라졌는지 보여 줘요. 수업 전 별도의 상태 측정은 없어, 준비·호흡 구간부터 "
             "이야기를 시작해요.",
        chart_keys=[k for k in ("motion", "heart_rate", "relaxation") if k in ok_keys],  # type: ignore[misc]
        stable_basis_note=(f"안정 기준 안정된 5분은 {win.window_label} 구간이에요. "
                           + ("이 구간에는 움직임 오염 표시가 있었어요. " if win.contaminated
                              else "이 구간의 움직임 오염 표시는 없었어요. ")
                           + "움직임 기준을 통과해도 맥박 검출 정확도와 신호의 안정성이 모두 보장되지는 않아요.")
        if win is not None else "이번 수업에서는 안정된 5분을 고를 만큼 움직임·심박 신호가 충분하지 않았어요.",
        footer_note="심박·이완도·움직임은 서비스 1분 지표예요. 이완도에는 임상 표준 척도를 적용하지 않아요.")
    parts = _empty_wording_parts(meta, _hero(meta, pairs, stable), journey, stable, metrics, band_status)
    return _finish(_apply_wording(_dump(parts)))


def _dump(parts: dict) -> dict:
    """계약 검증 가능한 dict 로 직렬화(중간 단계: 아직 MemberReport 로 묶지 않은 상태)."""
    return MemberReport.model_construct(**parts).model_dump(mode="json")


def _finish(report: dict) -> dict:
    """T4 이후 최종 계약 검증. 실패하면 ValidationError 를 올린다(호출자가 저장을 건너뛴다)."""
    return MemberReport.model_validate(report).model_dump(mode="json")
