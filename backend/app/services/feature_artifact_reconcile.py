"""SDD-282/285 — feature 산출물(S3) → eeg_feature_windows 공통 변환·멱등 적재.

복구 로더(`scripts/sdd282-recovery-load.py`, ingest_path='recover')와 종료 정산 태스크
(`app/tasks/feature_reconcile_task.py`, ingest_path='recon')가 이 모듈 하나를 공유한다.

원칙
- 변환은 운영 경로와 같은 함수(`parse_metric_window` → `_feature_item` → `_quality_from_signal`)를 쓴다.
  정상자 3,300행과 30개 컬럼이 전부 일치함이 검증된 규칙(드라이런 결과 §2-2)이다.
- `store_batch`/`_persist_feature_items` 를 쓰지 않는다 — 그 경로는 `participant.band_connected=True`
  변경과 `device_status_changed` 방송을 일으킨다. 여기서는 eeg_feature_windows 에 INSERT 만 한다.
- 멱등 키 = (session_id, participant_id, play_group_id=capture_stream.id, window_index=sequence).
  이미 있는 키는 건너뛰고, 같은 키에 다른 feature_hash 가 있으면 덮어쓰지 않고 `conflicts` 로 보고한다.
- 이 모듈은 commit 하지 않는다. 트랜잭션 경계는 호출자가 정한다.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Iterable

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session as DBSession

from app.models.biosignal import BiosignalArtifact
from app.models.eeg_feature import EEGFeatureWindow
from app.models.live_state import CaptureStream
from app.models.session import Session as SessionModel, SessionParticipant
from app.schemas.session_live_ingest import parse_metric_window
from app.services.live_ingest_service import _feature_item, eeg_window_invalid
from app.services.session_service import _quality_from_signal

logger = logging.getLogger(__name__)

INGEST_PATH_RECOVER = "recover"  # 복구 로더(SDD-282)
INGEST_PATH_RECON = "recon"  # 종료 정산(SDD-285 S1)
_ZERO_UUID = "00000000-0000-0000-0000-000000000000"
_INSERT_CHUNK = 500

# 변환 결과에서 eeg_feature_windows 로 그대로 옮기는 값 컬럼(운영 `_persist_feature_items` 와 같은 목록)
VALUE_COLS = (
    "delta_power", "theta_power", "alpha_power", "beta_power", "gamma_power", "total_power",
    "focus_index", "relaxation_index", "stress_index", "meditation_level", "attention_level", "cognitive_load",
    "emotional_stability", "hemispheric_balance", "total_neural_activity", "faa", "signal_quality",
    "sdnn", "rmssd", "lf_power", "hf_power", "lf_hf_ratio", "heart_rate", "respiratory_rate", "motion",
    "source_feature_alias", "algorithm_version",
)

Downloader = Callable[[str], "bytes | None"]


def _default_downloader(key: str) -> bytes | None:
    from app.services import storage_service

    return storage_service.download_bytes(key)


def _decode_rows(blob: bytes) -> list[dict[str, Any]]:
    if blob[:2] == b"\x1f\x8b":
        blob = gzip.decompress(blob)
    return [json.loads(line) for line in blob.splitlines() if line.strip()]


def _envelope(row: dict[str, Any], session_id: str, participant_id: str, cs: CaptureStream) -> dict[str, Any]:
    """파일 행 + capture_stream → MetricWindow 원본 형태. 앵커가 없던 stream 은 검증 전용 필드를 영값으로 채운다
    (`_feature_item` 은 clock_anchor_id/clock_uncertainty_ms 를 쓰지 않는다)."""
    return {
        **row,
        "session_id": session_id,
        "participant_id": participant_id,
        "stream_id": str(cs.id),
        "stream_generation": str(cs.generation),
        "clock_anchor_id": str(cs.clock_anchor_id) if cs.clock_anchor_id else _ZERO_UUID,
        "clock_uncertainty_ms": cs.clock_uncertainty_ms if cs.clock_uncertainty_ms is not None else 0,
        "device_profile_version": cs.device_profile,
        "algorithm_version": cs.algorithm_version,
        "model_version": cs.model_version,
    }


def convert_row(row: dict[str, Any], session_id: str, participant_id: str, cs: CaptureStream,
                *, session_ended_ms: int | None) -> dict[str, Any]:
    """파일 1행 → eeg_feature_windows 컬럼 dict(INSERT 용). 변환 불가면 예외."""
    w = parse_metric_window(_envelope(row, session_id, participant_id, cs))
    end_at = datetime.fromtimestamp(w.observed_at_ms / 1000, tz=timezone.utc)
    f = _feature_item(w, end_at, True).model_copy(update={"timestamp": float(w.observed_at_ms)})
    vals: dict[str, Any] = {k: getattr(f, k, None) for k in VALUE_COLS}
    vals["window_index"] = int(f.second_offset)
    vals["device_timestamp_ms"] = f.timestamp
    vals["quality"] = "invalid" if eeg_window_invalid(w) else _quality_from_signal(f.signal_quality)
    vals["late"] = session_ended_ms is not None and w.observed_at_ms > session_ended_ms
    # 설계 §2-1: created_at 을 관측 시각으로 명시한다(기본값이면 시간순 조회가 이 행들을 '회차 후 도착'으로 정렬).
    vals["created_at"] = end_at
    vals["_feature_hash"] = w.feature_hash
    return vals


@dataclass
class ParticipantPlan:
    participant_id: str
    skipped_reason: str | None = None  # 값이 있으면 이 참가자는 대상에서 제외(로그용)
    stream_ids: list[str] = field(default_factory=list)
    files_uploaded: int = 0
    files_pending_included: int = 0
    files_pending_excluded: int = 0
    pending_excluded_reasons: list[str] = field(default_factory=list)
    file_rows: int = 0
    unique_seqs: int = 0
    dup_in_file: int = 0
    already_in_db: int = 0
    convert_fail: int = 0
    # 같은 키에 다른 feature_hash — DB(기존) 또는 파일 안 중복. 비어 있어야 적재해도 안전하다.
    conflicts: list[dict[str, Any]] = field(default_factory=list)
    to_insert: list[dict[str, Any]] = field(default_factory=list)  # 값 dict(_stream_id 포함)
    quality: dict[str, int] = field(default_factory=dict)

    @property
    def insert_count(self) -> int:
        return len(self.to_insert)

    def summary(self) -> dict[str, Any]:
        return {
            "participant": self.participant_id[:6], "skipped": self.skipped_reason, "streams": len(self.stream_ids),
            "files_uploaded": self.files_uploaded, "files_pending_included": self.files_pending_included,
            "files_pending_excluded": self.files_pending_excluded, "file_rows": self.file_rows,
            "unique_seqs": self.unique_seqs, "dup_in_file": self.dup_in_file, "already_in_db": self.already_in_db,
            "convert_fail": self.convert_fail, "conflicts": len(self.conflicts), "to_insert": self.insert_count,
            "quality": dict(self.quality),
        }


def _pending_valid(a: BiosignalArtifact, blob: bytes | None, rows: list[dict[str, Any]] | None) -> str | None:
    """업로드 미확정(pending) 산출물을 포함해도 되는지 검증. 통과하면 None, 아니면 제외 사유."""
    if blob is None:
        return "S3 객체 없음"
    if len(blob) != a.size_bytes:
        return "크기 불일치"
    if hashlib.sha256(blob).hexdigest() != a.checksum:
        return "체크섬 불일치"
    if rows is None or len(rows) != a.row_count:
        return "행 수 불일치"
    seqs = [int(r["sequence"]) for r in rows]
    if a.first_sequence is not None and a.last_sequence is not None and (min(seqs), max(seqs)) != (a.first_sequence, a.last_sequence):
        return "순번 범위 불일치"
    if len(set(seqs)) != len(seqs):
        return "파일 내 순번 중복"
    return None


def plan_participant(db: DBSession, session_id: uuid.UUID, participant_id: uuid.UUID, *,
                     include_pending: bool = False, downloader: Downloader | None = None) -> ParticipantPlan:
    """참가자 1명의 feature 산출물을 읽어 적재 계획을 만든다. **읽기만 한다**(DB·S3)."""
    dl = downloader or _default_downloader
    plan = ParticipantPlan(participant_id=str(participant_id))
    participant = db.get(SessionParticipant, participant_id)
    if participant is None or participant.session_id != session_id:
        plan.skipped_reason = "참가자 없음/회차 불일치"
        return plan
    streams = db.execute(select(CaptureStream).where(
        CaptureStream.session_id == session_id, CaptureStream.participant_id == participant_id)
        .order_by(CaptureStream.generation)).scalars().all()
    if not streams:
        plan.skipped_reason = "capture_stream 없음"
        return plan
    by_id = {str(s.id): s for s in streams}
    plan.stream_ids = list(by_id)
    session = db.get(SessionModel, session_id)
    ended_ms = int(session.ended_at.timestamp() * 1000) if session is not None and session.ended_at is not None else None

    arts = db.execute(select(BiosignalArtifact).where(
        BiosignalArtifact.session_id == session_id, BiosignalArtifact.participant_id == participant_id,
        BiosignalArtifact.artifact_kind == "feature", BiosignalArtifact.signal == "eeg")
        .order_by(BiosignalArtifact.sequence)).scalars().all()

    # 키 → (stream, 파일 행)
    chosen: dict[tuple[str, int], tuple[CaptureStream, dict[str, Any]]] = {}
    hashes: dict[tuple[str, int], set[str]] = {}
    for a in arts:
        if a.stream_id and a.stream_id in by_id:
            cs = by_id[a.stream_id]
        elif len(streams) == 1:
            cs = streams[0]  # 산출물에 stream 표기가 없고 stream 이 하나뿐이면 그 stream
        else:
            plan.skipped_reason = None
            plan.conflicts.append({"kind": "stream_unresolved", "artifact_seq": a.sequence})
            continue
        blob = dl(a.object_key)
        if a.upload_status != "uploaded":
            rows_try = None
            if blob is not None:
                try:
                    rows_try = _decode_rows(blob)
                except Exception:  # noqa: BLE001
                    rows_try = None
            reason = None if include_pending else "기본 제외(pending)"
            if reason is None:
                reason = _pending_valid(a, blob, rows_try)
            if reason is not None:
                plan.files_pending_excluded += 1
                plan.pending_excluded_reasons.append(reason)
                continue
            plan.files_pending_included += 1
            rows = rows_try or []
        else:
            if blob is None:
                plan.conflicts.append({"kind": "object_missing", "artifact_seq": a.sequence})
                continue
            plan.files_uploaded += 1
            rows = _decode_rows(blob)
        for r in rows:
            plan.file_rows += 1
            key = (str(cs.id), int(r["sequence"]))
            hashes.setdefault(key, set()).add(r["feature_hash"])
            if key in chosen:
                plan.dup_in_file += 1
                continue
            chosen[key] = (cs, r)
    plan.unique_seqs = len(chosen)
    for key, hs in hashes.items():
        if len(hs) > 1:
            plan.conflicts.append({"kind": "hash_conflict_in_files", "stream": key[0][:6], "sequence": key[1]})

    existing: dict[tuple[str, int], str | None] = {}
    if chosen:
        seqs = {k[1] for k in chosen}
        for pg, idx, alias in db.execute(select(
                EEGFeatureWindow.play_group_id, EEGFeatureWindow.window_index, EEGFeatureWindow.source_feature_alias)
                .where(EEGFeatureWindow.session_id == session_id, EEGFeatureWindow.participant_id == participant_id,
                       EEGFeatureWindow.play_group_id.in_(list(by_id)), EEGFeatureWindow.window_index.in_(seqs))).all():
            existing[(pg, int(idx))] = alias

    qual: dict[str, int] = {}
    for key in sorted(chosen, key=lambda k: (k[0], k[1])):
        cs, r = chosen[key]
        if key in existing:
            if existing[key] == r["feature_hash"]:
                plan.already_in_db += 1
            else:
                plan.conflicts.append({"kind": "hash_conflict_db", "stream": key[0][:6], "sequence": key[1]})
            continue
        try:
            vals = convert_row(r, str(session_id), str(participant_id), cs, session_ended_ms=ended_ms)
        except Exception as exc:  # noqa: BLE001
            plan.convert_fail += 1
            if plan.convert_fail == 1:
                logger.warning("[reconcile] 변환 실패 예: %s %s", type(exc).__name__, str(exc)[:100])
            continue
        vals["_stream_id"] = key[0]
        qual[vals["quality"]] = qual.get(vals["quality"], 0) + 1
        plan.to_insert.append(vals)
    plan.quality = qual
    return plan


def apply_plan(db: DBSession, session_id: uuid.UUID, participant_id: uuid.UUID, plan: ParticipantPlan,
               *, ingest_path: str) -> int:
    """계획의 to_insert 를 직접 INSERT(ON CONFLICT DO NOTHING). 실제 삽입된 행 수를 돌려준다. commit 은 호출자 몫.

    다른 테이블(participant.band_connected 등)은 건드리지 않고 방송도 하지 않는다.
    """
    if len(ingest_path) > 8:
        raise ValueError("ingest_path 는 8자 이하여야 한다")
    participant = db.get(SessionParticipant, participant_id)
    user_id = participant.user_id if participant is not None else None
    inserted = 0
    items = plan.to_insert
    for i in range(0, len(items), _INSERT_CHUNK):
        batch = []
        for v in items[i:i + _INSERT_CHUNK]:
            row = {k: v[k] for k in (*VALUE_COLS, "window_index", "device_timestamp_ms", "quality", "late", "created_at")}
            row.update(session_id=session_id, participant_id=participant_id, user_id=user_id,
                       play_group_id=v["_stream_id"], ingest_path=ingest_path)
            batch.append(row)
        stmt = (pg_insert(EEGFeatureWindow).values(batch)
                .on_conflict_do_nothing(constraint="uq_eeg_feature_window").returning(EEGFeatureWindow.id))
        inserted += len(db.execute(stmt).all())
    return inserted


def count_rows(db: DBSession, session_id: uuid.UUID, participant_ids: Iterable[uuid.UUID] | None = None,
               ingest_path: str | None = None) -> int:
    q = select(func.count()).select_from(EEGFeatureWindow).where(EEGFeatureWindow.session_id == session_id)
    if participant_ids is not None:
        q = q.where(EEGFeatureWindow.participant_id.in_(list(participant_ids)))
    if ingest_path is not None:
        q = q.where(EEGFeatureWindow.ingest_path == ingest_path)
    return int(db.execute(q).scalar_one())


def delete_marked(db: DBSession, session_id: uuid.UUID, participant_ids: Iterable[uuid.UUID], ingest_path: str) -> int:
    """표식(ingest_path) 행만 삭제한다. commit 은 호출자 몫."""
    res = db.execute(delete(EEGFeatureWindow).where(
        EEGFeatureWindow.session_id == session_id, EEGFeatureWindow.participant_id.in_(list(participant_ids)),
        EEGFeatureWindow.ingest_path == ingest_path))
    return int(res.rowcount or 0)
