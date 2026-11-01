"""SDD-265 — 데이터 현황 상황판 수치: 측정 길이·데이터 크기·도착 인원 (순수 계산 + 크기 일괄 조회) + cursor 코덱.

- 서버가 받은 것만 센다(`uploaded`). 점수·완료·보증 값은 만들지 않는다.
- 기대 크기는 "도착한 청크의 평균 크기 × 폰이 보고한 기대 개수" 추정이다. 근거가 하나라도 모자라면 None.
- 계약 정본: specs/sdd-265-upload-status-redesign/contract.md
"""

from __future__ import annotations

import base64
import json
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone

from sqlalchemy import func, literal, select, union_all
from sqlalchemy.orm import Session as DBSession

from app.models.biosignal import BiosignalArtifact
from app.models.record import EEGRawChunk

SIGNALS = ("eeg", "ppg", "acc")
FEATURE_KIND = "feature"


def _aware(dt: datetime) -> datetime:
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


# ---------------------------------------------------------------------------
# 측정 길이
# ---------------------------------------------------------------------------

def duration_minutes(started_at: datetime | None, ended_at: datetime | None, status: str,
                     as_of: datetime) -> int | None:
    """회차 측정 길이(분, 반올림). 진행 중이면 경과, 시작 없음·종료 시각 없는 완료 회차는 None."""
    if started_at is None:
        return None
    start = _aware(started_at)
    if ended_at is not None:
        end = _aware(ended_at)
    elif status == "in_progress":
        end = _aware(as_of)
    else:
        return None
    return max(int((end - start).total_seconds() + 30) // 60, 0)


# ---------------------------------------------------------------------------
# 데이터 크기
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class BytesStat:
    """참여자 한 명의 서버 도착 크기. raw={신호: (바이트 합, 크기가 있는 행 수)}."""

    raw: dict[str, tuple[int, int]] = field(default_factory=dict)
    feature_bytes: int = 0      # 분석 데이터 파일 바이트
    feature_rows: int = 0       # 분석 데이터 파일이 담은 창 수(row_count 합)
    other_bytes: int = 0        # 그 외 산출물 바이트


@dataclass(frozen=True)
class PMetrics:
    excluded: bool
    arrived: bool
    bytes_arrived: int
    bytes_expected: int | None
    windows: int


def _estimate(stat_bytes: int, stat_rows: int, expected: int, received: int) -> int | None:
    """평균 크기 × max(기대, 도착). 개수가 0이면 0, 평균을 알 수 없으면 None."""
    count = max(expected, received)
    if count == 0:
        return 0
    if stat_rows <= 0:
        return None
    return stat_bytes * count // stat_rows


def participant_metrics(part, stat: BytesStat | None) -> PMetrics:
    """`part` 는 SDD-261 UploadStatusParticipant(또는 같은 모양)."""
    stat = stat or BytesStat()
    excluded = part.status == "excluded"
    signals = {s.signal_type: s for s in part.raw.signals}
    uploaded_total = sum(s.uploaded for s in signals.values())
    raw_bytes = sum(b for b, _ in stat.raw.values())
    arrived_bytes = raw_bytes + stat.feature_bytes + stat.other_bytes

    expected_bytes: int | None = stat.other_bytes
    feature_expected = part.feature.expected
    if feature_expected is None:
        expected_bytes = None
    elif stat.feature_rows > 0:
        est = _estimate(stat.feature_bytes, stat.feature_rows, feature_expected, part.feature.received)
        expected_bytes = None if est is None or expected_bytes is None else expected_bytes + est
    elif expected_bytes is not None:
        expected_bytes += stat.feature_bytes  # 분석 데이터 파일이 없으면 0
    for name in SIGNALS:
        s = signals.get(name)
        if expected_bytes is None:
            break
        if s is None or s.expected is None:
            expected_bytes = None
            break
        b, rows = stat.raw.get(name, (0, 0))
        est = _estimate(b, rows, s.expected, s.uploaded)
        expected_bytes = None if est is None else expected_bytes + est
    if expected_bytes is not None:
        expected_bytes = max(expected_bytes, arrived_bytes)

    return PMetrics(
        excluded=excluded,
        arrived=(not excluded) and (part.feature.received > 0 or uploaded_total > 0),
        bytes_arrived=arrived_bytes, bytes_expected=expected_bytes, windows=part.feature.received)


@dataclass(frozen=True)
class Rollup:
    participants_expected: int
    participants_arrived: int
    bytes_arrived: int
    bytes_expected: int | None
    bytes_basis: str | None
    participant_minutes_total: int


def rollup(pms: list[PMetrics]) -> Rollup:
    active = [p for p in pms if not p.excluded]
    known = [p.bytes_expected for p in active]
    expected = None if not known or any(v is None for v in known) else sum(known)
    return Rollup(
        participants_expected=len(active), participants_arrived=sum(1 for p in active if p.arrived),
        bytes_arrived=sum(p.bytes_arrived for p in pms), bytes_expected=expected,
        bytes_basis="estimate" if expected is not None else None,
        participant_minutes_total=sum(p.windows for p in pms) // 60)


# ---------------------------------------------------------------------------
# 크기 일괄 조회 (UNION ALL 1쿼리, 회차·참여자 수 무관)
# ---------------------------------------------------------------------------

def load_bytes_by_session(db: DBSession, session_ids: list[uuid.UUID]) -> dict[uuid.UUID, dict[uuid.UUID, BytesStat]]:
    if not session_ids:
        return {}
    r, a = EEGRawChunk, BiosignalArtifact
    raw_q = (
        select(r.session_id.label("sid"), r.participant_id.label("pid"),
               func.concat("raw:", r.signal_type).label("tag"),
               func.coalesce(func.sum(r.size_bytes), 0).label("bytes"),
               func.count(r.size_bytes).label("rows"))
        .where(r.session_id.in_(session_ids), r.participant_id.isnot(None), r.upload_status == "uploaded")
        .group_by(r.session_id, r.participant_id, r.signal_type)
    )
    art_q = (
        select(a.session_id.label("sid"), a.participant_id.label("pid"),
               func.concat("art:", a.artifact_kind).label("tag"),
               func.coalesce(func.sum(a.size_bytes), 0).label("bytes"),
               func.coalesce(func.sum(a.row_count), 0).label("rows"))
        .where(a.session_id.in_(session_ids), a.upload_status == "uploaded")
        .group_by(a.session_id, a.participant_id, a.artifact_kind)
    )
    rows = db.execute(union_all(raw_q, art_q)).all()
    acc: dict[uuid.UUID, dict[uuid.UUID, dict]] = {}
    for x in rows:
        slot = acc.setdefault(x.sid, {}).setdefault(x.pid, {"raw": {}, "fb": 0, "fr": 0, "other": 0})
        tag, nbytes, nrows = x.tag, int(x.bytes or 0), int(x.rows or 0)
        if tag.startswith("raw:"):
            slot["raw"][tag[4:]] = (nbytes, nrows)
        elif tag == f"art:{FEATURE_KIND}":
            slot["fb"] += nbytes
            slot["fr"] += nrows
        else:
            slot["other"] += nbytes
    return {sid: {pid: BytesStat(raw=v["raw"], feature_bytes=v["fb"], feature_rows=v["fr"], other_bytes=v["other"])
                  for pid, v in parts.items()} for sid, parts in acc.items()}


# ---------------------------------------------------------------------------
# cursor — 정렬 키 (그룹, 유효시각 desc, id asc) 의 불투명 토큰
# ---------------------------------------------------------------------------

def encode_cursor(group: int, effective: datetime, session_id: uuid.UUID) -> str:
    payload = json.dumps([group, _aware(effective).isoformat(), str(session_id)], separators=(",", ":"))
    return base64.urlsafe_b64encode(payload.encode()).decode().rstrip("=")


def decode_cursor(token: str) -> tuple[int, datetime, uuid.UUID]:
    try:
        raw = base64.urlsafe_b64decode(token + "=" * (-len(token) % 4))
        group, eff, sid = json.loads(raw)
        if group not in (0, 1) or isinstance(group, bool):
            raise ValueError("group")
        return int(group), _aware(datetime.fromisoformat(eff)), uuid.UUID(sid)
    except (ValueError, TypeError, UnicodeDecodeError) as exc:
        raise ValueError("invalid cursor") from exc
