"""SDD-264 B4 — 총량 대비 수집률 판정·합계 (순수 함수, DB 없음).

- 참여자별 `progress.state`(모두 수신/진행 중/확인 필요/기대량 미확인/수집 제외)와 컴포넌트별 기대·수신·진행률.
- 합계(`aggregate`)와 회차 병합(`merge`)은 상세·목록이 같은 함수를 써서 화면 간 수치가 어긋나지 않게 한다.
- percent 는 정수 연산 내림(소수 1자리): 부족분이 있으면 100.0 이 되지 않는다. 기대 0/미보고는 None.
- 계약 정본: specs/sdd-264-upload-progress-expected/contract.md §2~§4
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel

STALL_SEC = 120
FINAL_GRACE_SEC = 30 * 60
SIGNALS = ("eeg", "ppg", "acc")

ProgressState = Literal["all_received", "in_progress", "needs_attention", "expected_unknown", "not_collected"]


def _aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


# ---------------------------------------------------------------------------
# 입력
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ExpectedSnapshot:
    feature: int
    raw: dict[str, int | None]
    final: bool
    first_reported_at: datetime


@dataclass(frozen=True)
class ProgressInput:
    excluded: bool                      # 수집 제외(opt-out/대기열)
    has_data: bool                      # feature 수신>0 또는 raw 등록>0
    expected: ExpectedSnapshot | None   # 폰 보고(없으면 None)
    feature_received: int
    raw_received: dict[str, int]        # 신호별 uploaded 수
    raw_failed: int
    last_received_at: datetime | None
    session_status: str
    ended_at: datetime | None
    as_of: datetime


# ---------------------------------------------------------------------------
# 출력 모델
# ---------------------------------------------------------------------------

class Component(BaseModel):
    expected: int | None
    received: int
    percent: float | None


class RawComponents(BaseModel):
    eeg: Component
    ppg: Component
    acc: Component


class ParticipantProgress(BaseModel):
    state: ProgressState
    feature: Component
    raw: RawComponents
    total: Component


class ParticipantCounts(BaseModel):
    total: int
    counted: int
    all_received: int
    in_progress: int
    needs_attention: int
    expected_unknown: int
    not_collected: int


class AggregateProgress(BaseModel):
    participants: ParticipantCounts
    feature: Component
    raw: RawComponents
    overall: Component


# ---------------------------------------------------------------------------
# 수식
# ---------------------------------------------------------------------------

def percent(expected: int | None, received: int) -> float | None:
    """min(수신, 기대)/기대 를 소수 1자리로 내림. 기대가 없거나 0 이면 None."""
    if expected is None or expected <= 0:
        return None
    return (min(max(received, 0), expected) * 1000 // expected) / 10


def _component(expected: int | None, received: int) -> Component:
    return Component(expected=expected, received=received, percent=percent(expected, received))


def _sum_components(parts: list[Component]) -> Component:
    """보고된(expected 가 있는) 컴포넌트만 합산. received 는 컴포넌트별 상한 후 합. 대상 없으면 expected None."""
    reported = [c for c in parts if c.expected is not None]
    if not reported:
        return Component(expected=None, received=0, percent=None)
    exp = sum(c.expected for c in reported)
    rec = sum(min(c.received, c.expected) for c in reported)
    return Component(expected=exp, received=rec, percent=percent(exp, rec))


# ---------------------------------------------------------------------------
# 참여자별 판정
# ---------------------------------------------------------------------------

def _stalled(inp: ProgressInput) -> bool:
    last = _aware(inp.last_received_at)
    if last is not None:
        return (inp.as_of - last).total_seconds() >= STALL_SEC
    first = _aware(inp.expected.first_reported_at) if inp.expected else None
    return first is not None and (inp.as_of - first).total_seconds() >= STALL_SEC


def build_participant_progress(inp: ProgressInput) -> ParticipantProgress:
    e = inp.expected
    feature = _component(e.feature if e else None, inp.feature_received)
    raw = RawComponents(**{
        name: _component(e.raw.get(name) if e else None, inp.raw_received.get(name, 0)) for name in SIGNALS})
    total = _sum_components([feature, raw.eeg, raw.ppg, raw.acc])

    if inp.excluded and not inp.has_data:
        state: ProgressState = "not_collected"
    elif e is None or any(e.raw.get(name) is None for name in SIGNALS):
        state = "expected_unknown"
    else:
        ended = _aware(inp.ended_at)
        stale_open = (not e.final and inp.session_status == "completed" and ended is not None
                      and (inp.as_of - ended).total_seconds() >= FINAL_GRACE_SEC)
        if stale_open:
            state = "expected_unknown"
        else:
            shortage = any(c.received < c.expected for c in (feature, raw.eeg, raw.ppg, raw.acc))
            if shortage and (inp.raw_failed > 0 or _stalled(inp)):
                state = "needs_attention"
            elif e.final and not shortage:
                state = "all_received"
            else:
                state = "in_progress"
    return ParticipantProgress(state=state, feature=feature, raw=raw, total=total)


# ---------------------------------------------------------------------------
# 기대량 적재 (DB 1회, 인원·회차 수 무관)
# ---------------------------------------------------------------------------

def snapshot_of(row) -> ExpectedSnapshot | None:
    if row is None:
        return None
    return ExpectedSnapshot(
        feature=row.feature, raw={"eeg": row.raw_eeg, "ppg": row.raw_ppg, "acc": row.raw_acc},
        final=bool(row.final), first_reported_at=row.first_reported_at)


def load_expected_by_session(db, session_ids: list) -> dict:
    """session_id 목록의 보고 행을 한 번에 읽어 {participant_id: 행} 으로 돌려준다."""
    from sqlalchemy import select

    from app.models.session_ingest_expected import SessionIngestExpected as E

    if not session_ids:
        return {}
    rows = db.execute(select(E).where(E.session_id.in_(session_ids))).scalars().all()
    return {r.participant_id: r for r in rows}


# ---------------------------------------------------------------------------
# 합계
# ---------------------------------------------------------------------------

def _count_states(plist: list[ParticipantProgress]) -> ParticipantCounts:
    n = {k: 0 for k in ("all_received", "in_progress", "needs_attention", "expected_unknown", "not_collected")}
    for p in plist:
        n[p.state] += 1
    return ParticipantCounts(total=len(plist), counted=len(plist) - n["not_collected"], **n)


def aggregate(plist: list[ParticipantProgress]) -> AggregateProgress:
    """수집 제외 참여자는 모든 합계에서 뺀다. 기대량 미확인은 사람 수엔 남고 보고된 컴포넌트만 수치에 들어간다."""
    active = [p for p in plist if p.state != "not_collected"]
    feature = _sum_components([p.feature for p in active])
    raw = RawComponents(**{name: _sum_components([getattr(p.raw, name) for p in active]) for name in SIGNALS})
    overall = _sum_components([feature, raw.eeg, raw.ppg, raw.acc])
    return AggregateProgress(participants=_count_states(plist), feature=feature, raw=raw, overall=overall)


def merge(parts: list[AggregateProgress]) -> AggregateProgress:
    """회차별 합계를 합친다(전체 회차 목록 최상위). aggregate(전체 참여자) 와 같은 수치가 나온다."""
    counts = ParticipantCounts(**{
        k: sum(getattr(a.participants, k) for a in parts) for k in ParticipantCounts.model_fields})
    feature = _sum_merge([a.feature for a in parts])
    raw = RawComponents(**{name: _sum_merge([getattr(a.raw, name) for a in parts]) for name in SIGNALS})
    overall = _sum_merge([a.overall for a in parts])
    return AggregateProgress(participants=counts, feature=feature, raw=raw, overall=overall)


def _sum_merge(parts: list[Component]) -> Component:
    reported = [c for c in parts if c.expected is not None]
    if not reported:
        return Component(expected=None, received=0, percent=None)
    exp = sum(c.expected for c in reported)
    rec = sum(c.received for c in reported)
    return Component(expected=exp, received=rec, percent=percent(exp, rec))
