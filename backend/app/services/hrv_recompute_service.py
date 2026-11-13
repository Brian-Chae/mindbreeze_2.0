"""PPG 원시(v2) → 심박변이 재산출 (RMSSD 과대 산출 수정, specs/fix-rmssd-overestimate).

저장된 `eeg_feature_windows` 의 rmssd/sdnn/lf_power/hf_power/lf_hf_ratio 를 수정된 알고리즘으로 다시 산출해
**같은 행을 제자리 UPDATE** 한다. 버전별 사본·새 컬럼·새 테이블은 만들지 않는다(대표 결정 2026-11-13).

- 계산 엔진: Rust 측정 코어(`measurement-core` example `recompute_ppg_hrv`). 네이티브 앱과 같은 코어이며
  TS 처리기와 같은 입력에서 소수 6자리까지 일치함을 골든 테스트로 고정했다(웹과 동일 수치).
- 롤업(`eeg_rollup_service`)은 이 윈도우에서 온디맨드로 파생되므로 별도 저장값이 없다 → 윈도우만 고치면 된다.
- 원시(S3)가 없거나 디코딩 실패한 참가자의 윈도우는 건드리지 않고 건수만 집계한다.
- 새 알고리즘 값이 null(워밍업 등)이고 기존 값이 있는 칸은 덮어쓰지 않는다(건수만 집계, 0·null 치환 금지).
"""
from __future__ import annotations

import bisect
import json
import logging
import os
import statistics
import subprocess
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Iterable

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session as DBSession

from app.models.eeg_feature import EEGFeatureWindow
from app.models.record import EEGRawChunk
from app.models.session import Session as SessionModel

logger = logging.getLogger(__name__)

HRV_COLS: tuple[str, ...] = ("rmssd", "sdnn", "lf_power", "hf_power", "lf_hf_ratio")
ENGINE_COLS: tuple[str, ...] = HRV_COLS + ("heart_rate",)
DEFAULT_TOLERANCE_MS = 750.0
SAMPLE_PERIOD_MS = 20.0
_EPS = 1e-9

Reader = Callable[[str], "bytes | None"]
Engine = Callable[[list[tuple[float, float, float]]], list[dict]]


def default_engine_bin() -> Path:
    env = os.environ.get("HRV_RECOMPUTE_BIN")
    if env:
        return Path(env)
    root = Path(__file__).resolve().parents[3]
    return root / "packages/measurement-core/target/release/examples/recompute_ppg_hrv"


def run_rust_engine(samples: list[tuple[float, float, float]], binary: Path | None = None) -> list[dict]:
    """연속 구간 PPG(ts_ms, red, ir) → 1초 간격 HRV 행. 서비스와 동일한 500샘플 링·50샘플 간격 재생."""
    exe = binary or default_engine_bin()
    if not exe.exists():
        raise FileNotFoundError(
            f"재산출 엔진이 없습니다: {exe} — `cd packages/measurement-core && cargo build --release --example recompute_ppg_hrv`")
    payload = "\n".join(f"{ts:.3f},{r:.0f},{i:.0f}" for ts, r, i in samples) + "\n"
    proc = subprocess.run([str(exe)], input=payload, capture_output=True, text=True, check=True)
    lines = proc.stdout.strip().splitlines()
    rows: list[dict] = []
    for line in lines[1:]:
        p = line.split(",")
        row: dict = {"ts_ms": float(p[0])}
        for name, val in zip(ENGINE_COLS, p[1:7]):
            row[name] = float(val) if val != "" else None
        rows.append(row)
    return rows


@dataclass
class Stats:
    sessions: int = 0
    participants: int = 0
    participants_no_raw: int = 0          # 원시 없음/디코딩 실패 → 미변경
    windows_considered: int = 0           # HRV 값이 하나라도 있는 윈도우
    windows_unmatched: int = 0            # 대응하는 재산출 틱 없음 → 미변경
    windows_changed: int = 0
    cells_changed: int = 0
    cells_skipped_new_null: int = 0
    before: dict[str, list[float]] = field(default_factory=lambda: {c: [] for c in HRV_COLS})
    after: dict[str, list[float]] = field(default_factory=lambda: {c: [] for c in HRV_COLS})

    def medians(self) -> dict[str, dict[str, float | None]]:
        f = lambda v: round(statistics.median(v), 3) if v else None  # noqa: E731
        return {c: {"before": f(self.before[c]), "after": f(self.after[c])} for c in HRV_COLS}

    def report(self) -> dict:
        return {
            "sessions": self.sessions, "participants": self.participants,
            "participants_no_raw": self.participants_no_raw,
            "windows_considered": self.windows_considered, "windows_unmatched": self.windows_unmatched,
            "windows_changed": self.windows_changed, "cells_changed": self.cells_changed,
            "cells_skipped_new_null": self.cells_skipped_new_null, "medians": self.medians(),
        }


def select_sessions(db: DBSession, *, session_ids: Iterable[str] | None = None, since: datetime | None = None,
                    limit: int | None = None) -> list[uuid.UUID]:
    q = (select(EEGRawChunk.session_id).where(
        EEGRawChunk.signal_type == "ppg", EEGRawChunk.schema_version == "mb-biosignal-raw-v2",
        EEGRawChunk.upload_status == "uploaded").distinct())
    if session_ids:
        q = q.where(EEGRawChunk.session_id.in_([uuid.UUID(str(s)) for s in session_ids]))
    if since is not None:
        q = q.join(SessionModel, SessionModel.id == EEGRawChunk.session_id).where(SessionModel.created_at >= since)
    ids = sorted(db.execute(q).scalars().all(), key=str)
    return ids[:limit] if limit else ids


def _decode_segments(chunks: list[EEGRawChunk], reader: Reader) -> list[list[tuple[float, float, float]]] | None:
    """참가자의 PPG 청크 → 연속 구간별 (ts_ms, red, ir). 하나라도 읽기/디코딩 실패면 None(전체 미변경)."""
    from app.schemas.biosignal import RawChunkMeta
    from app.services.biosignal_decoder import DecodeError, decode_raw_chunk_with_gaps

    segments: list[list[tuple[float, float, float]]] = []
    cur: list[tuple[float, float, float]] = []
    last_idx: int | None = None
    last_key = None
    for row in sorted(chunks, key=lambda c: (c.stream_id, c.segment_id, c.chunk_index)):
        payload = reader(row.object_key)
        if payload is None or not row.header:
            return None
        try:
            meta = RawChunkMeta(session_id=row.session_id, participant_id=row.participant_id, play_group_id=None,
                                chunk_id=row.id, header=row.header, checksum=row.checksum, size_bytes=row.size_bytes,
                                object_key=row.object_key, object_version_id=row.object_version_id)
            decoded = decode_raw_chunk_with_gaps(payload, meta)
        except (DecodeError, ValueError):
            return None
        key = (row.stream_id, row.segment_id)
        for s in decoded.samples:
            if s.utc_us is None:
                return None
            contiguous = key == last_key and last_idx is not None and s.sample_index == last_idx + 1
            if not contiguous and cur:
                segments.append(cur)
                cur = []
            cur.append((float(s.utc_us) / 1000.0, float(s.values[0]), float(s.values[1])))
            last_idx, last_key = s.sample_index, key
    if cur:
        segments.append(cur)
    return segments


def _changed(old: float | None, new: float | None) -> bool:
    return old is not None and new is not None and abs(old - new) > _EPS


def plan_participant(db: DBSession, session_id: uuid.UUID, participant_id: uuid.UUID, chunks: list[EEGRawChunk],
                     reader: Reader, engine: Engine, stats: Stats, tolerance_ms: float) -> list[dict] | None:
    """변경 계획: [{id, old:{col:val}, new:{col:val}}]. 원시를 못 쓰면 None."""
    segments = _decode_segments(chunks, reader)
    windows = list(db.execute(select(EEGFeatureWindow).where(
        EEGFeatureWindow.session_id == session_id, EEGFeatureWindow.participant_id == participant_id,
        EEGFeatureWindow.device_timestamp_ms.is_not(None))).scalars())
    windows = [w for w in windows if any(getattr(w, c) is not None for c in HRV_COLS)]
    if segments is None:
        stats.participants_no_raw += 1
        stats.windows_considered += len(windows)
        stats.windows_unmatched += len(windows)
        return None
    ticks: list[dict] = []
    for seg in segments:
        if len(seg) >= 50:
            ticks.extend(engine(seg))
    ticks.sort(key=lambda t: t["ts_ms"])
    keys = [t["ts_ms"] for t in ticks]
    plan: list[dict] = []
    for w in windows:
        stats.windows_considered += 1
        j = bisect.bisect_left(keys, w.device_timestamp_ms)
        cand = [k for k in (j - 1, j) if 0 <= k < len(ticks)]
        best = min(cand, key=lambda k: abs(keys[k] - w.device_timestamp_ms), default=None)
        if best is None or abs(keys[best] - w.device_timestamp_ms) > tolerance_ms:
            stats.windows_unmatched += 1
            continue
        tick = ticks[best]
        old, new = {}, {}
        for c in HRV_COLS:
            o, n = getattr(w, c), tick.get(c)
            if o is None:
                continue
            if n is None:
                stats.cells_skipped_new_null += 1
                continue
            stats.before[c].append(o)
            stats.after[c].append(n)
            if _changed(o, n):
                old[c], new[c] = o, n
        if new:
            plan.append({"id": str(w.id), "session_id": str(session_id), "old": old, "new": new})
    stats.windows_changed += len(plan)
    stats.cells_changed += sum(len(p["new"]) for p in plan)
    return plan


def count_hrv_windows(db: DBSession, session_id: uuid.UUID, participant_id: uuid.UUID) -> int:
    q = select(func.count()).select_from(EEGFeatureWindow).where(
        EEGFeatureWindow.session_id == session_id, EEGFeatureWindow.participant_id == participant_id,
        or_(*[getattr(EEGFeatureWindow, c).is_not(None) for c in HRV_COLS]))
    return int(db.execute(q).scalar_one())


def count_sessions_without_raw(db: DBSession) -> int:
    """HRV 값은 있는데 PPG 원시(v2, 업로드 완료)가 하나도 없는 회차 수 — 재산출 불가(미변경) 규모 파악용."""
    has_hrv = select(EEGFeatureWindow.session_id).where(or_(*[getattr(EEGFeatureWindow, c).is_not(None) for c in HRV_COLS])).distinct()
    has_raw = select(EEGRawChunk.session_id).where(
        EEGRawChunk.signal_type == "ppg", EEGRawChunk.schema_version == "mb-biosignal-raw-v2",
        EEGRawChunk.upload_status == "uploaded").distinct()
    return int(db.execute(select(func.count()).select_from(has_hrv.where(EEGFeatureWindow.session_id.not_in(has_raw)).subquery())).scalar_one())


def run(db: DBSession, *, session_ids: list[uuid.UUID], reader: Reader, engine: Engine, apply: bool,
        backup_path: Path | None, tolerance_ms: float = DEFAULT_TOLERANCE_MS,
        progress: Callable[[str], None] = lambda m: None) -> Stats:
    """회차 단위 트랜잭션. apply=False 면 DB 를 전혀 쓰지 않는다. apply=True 면 회차별로 백업 기록 → UPDATE → commit."""
    stats = Stats()
    for n, sid in enumerate(session_ids, 1):
        stats.sessions += 1
        rows = db.execute(select(EEGRawChunk).where(
            EEGRawChunk.session_id == sid, EEGRawChunk.signal_type == "ppg",
            EEGRawChunk.schema_version == "mb-biosignal-raw-v2", EEGRawChunk.upload_status == "uploaded")).scalars().all()
        by_participant: dict[uuid.UUID, list[EEGRawChunk]] = {}
        for r in rows:
            if r.participant_id is not None:
                by_participant.setdefault(r.participant_id, []).append(r)
        session_plan: list[dict] = []
        # 원시 청크가 전혀 없는 참가자(HRV 값만 있음)도 '원시 없음'으로 집계한다(건드리지 않음).
        hrv_pids = set(db.execute(select(EEGFeatureWindow.participant_id).where(
            EEGFeatureWindow.session_id == sid, EEGFeatureWindow.participant_id.is_not(None),
            (EEGFeatureWindow.rmssd.is_not(None)) | (EEGFeatureWindow.sdnn.is_not(None))).distinct()).scalars())
        for pid in hrv_pids - set(by_participant):
            stats.participants += 1
            stats.participants_no_raw += 1
            stats.windows_considered += count_hrv_windows(db, sid, pid)
            stats.windows_unmatched += count_hrv_windows(db, sid, pid)
        for pid, chunks in by_participant.items():
            stats.participants += 1
            plan = plan_participant(db, sid, pid, chunks, reader, engine, stats, tolerance_ms)
            if plan:
                session_plan.extend(plan)
        if apply and session_plan:
            try:
                if backup_path is not None:
                    with backup_path.open("a", encoding="utf-8") as f:
                        for p in session_plan:
                            f.write(json.dumps({"id": p["id"], "session_id": p["session_id"], "old": p["old"]}) + "\n")
                        f.flush()
                        os.fsync(f.fileno())
                for p in session_plan:
                    row = db.get(EEGFeatureWindow, uuid.UUID(p["id"]))
                    for c, v in p["new"].items():
                        setattr(row, c, round(v, 6))
                db.commit()
            except Exception:
                db.rollback()
                raise
        else:
            db.rollback()  # 읽기만 한 트랜잭션 정리
        progress(f"[{n}/{len(session_ids)}] session={str(sid)[:8]} changed_windows={len(session_plan)}")
    return stats


def rollback(db: DBSession, backup_path: Path, progress: Callable[[str], None] = lambda m: None) -> dict:
    """백업(JSONL)의 원래 값으로 되돌린다. 회차 단위 트랜잭션. 없는 행은 건수만 집계."""
    by_session: dict[str, list[dict]] = {}
    for line in backup_path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            rec = json.loads(line)
            by_session.setdefault(rec["session_id"], []).append(rec)
    restored = missing = 0
    for sid, recs in by_session.items():
        try:
            for rec in recs:
                row = db.get(EEGFeatureWindow, uuid.UUID(rec["id"]))
                if row is None:
                    missing += 1
                    continue
                for c, v in rec["old"].items():
                    setattr(row, c, v)
                restored += 1
            db.commit()
        except Exception:
            db.rollback()
            raise
        progress(f"rollback session={sid[:8]} rows={len(recs)}")
    return {"sessions": len(by_session), "rows_restored": restored, "rows_missing": missing}


def new_backup_path(directory: Path) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    return directory / f"hrv_recompute_backup_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.jsonl"
