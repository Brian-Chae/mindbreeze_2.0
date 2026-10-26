"""SDD-246 T05/T09 — live:metric · live:device 수집(저장 + 라이브 투영).

규칙(contracts/session-live-v2 와 progress/t05.md 에 명문화):
- **participant_id 획득**: 서버가 인증 문맥에서 확정한 본인 participant(actor.participant_id)만 쓴다. 클라이언트는
  `capture.start` ACK 의 `result.participant_id`(= snapshot audiences `member:<pid>` 와 같은 값)를 envelope 에 넣고,
  다르면 `participant_mismatch` 로 거절한다(타인 지표 위조 불가).
- **저장(durable)**: 기존 feature 저장 경로(`session_service._persist_feature_items` → eeg_feature_windows)를 재사용한다.
  멱등 키 = (session, participant, play_group_id=stream_id, window_index=sequence). 같은 sequence 에 다른 feature_hash 는
  `feature_hash_conflict`(조용히 덮어쓰지 않는다). durable ACK 는 이 commit 이후에만 낸다.
- **판정**: 수락 여부는 T03 `evaluate_ingest`(cutoff·동의철회·lease·offline 상한). 시각은 서버 anchor(anchor_server_at ↔ monotonic)
  기준이고 클라이언트 wall clock(observed_at_ms)은 신뢰하지 않는다. anchor 가 없으면 서버 수신시각을 쓰고 clock_uncertain 이다.
- **신선도**: 서버가 판정한다. clock_uncertain → time_uncertain, 아니면 서버 수신시각 − 창 종료(서버시계) 기준 fresh/delayed/stale.
- **라이브 투영(최신값만)**: 한 배치에서 투영 가능한 *가장 새 창 하나*만 `metrics.updated` outbox event 로 만든다
  (audience host + member:<pid>, 타인 불가). entity_version = (generation<<31)|sequence 라 stream 이 바뀌어도 단조,
  이미 투영된 값보다 낮거나 같으면 건너뛴다. 투영 조건 = 수락 + stream active + lease 유효 + 현재 generation(fencing).
  고빈도라 Redis dedupe 키는 만들지 않는다(live_redis.METRIC_DEDUPE_TTL_S=0). outbox 가 정본이라 T04 재구축 대상이 된다.
- 투영(Redis/방송) 실패는 ACK 를 막지 않는다: feature 는 이미 commit 됐고 outbox 행도 commit 됐으므로 heartbeat/drain 이 이어서 적용한다.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session as DBSession

from app.models.eeg_feature import EEGFeatureWindow
from app.models.live_state import CaptureStream, LiveOutbox
from app.models.session import SessionParticipant
from app.schemas.session import EEGFeatureItem
from app.schemas.session_live_ingest import DeviceReport, MetricWindow, parse_device, parse_metric_batch
from app.schemas.session_live_v2 import PROTOCOL_VERSION, SCHEMA_VERSION, WireError
from app.services.session_live_commands import Actor, device_payload, evaluate_ingest, last_device_payload
from app.services.session_live_ledger import append_outbox, lock_epoch

logger = logging.getLogger(__name__)

FRESH_MAX_MS = 5_000       # 서버 수신시각 − 창 종료 ≤ 5초 → fresh
DELAYED_MAX_MS = 30_000    # ≤ 30초 → delayed, 초과 → stale
FUTURE_TOLERANCE_MS = 2_000  # 창 종료가 서버시계보다 이만큼 넘게 미래면 시계/anchor 오류 → time_uncertain
_GEN_SHIFT = 31            # entity_version = (generation << 31) | sequence  (sequence ≤ 2^31-1)


@dataclass
class IngestOutcome:
    """sink 응답(wire dict)과 후처리(방송) 필요 여부."""

    response: dict[str, Any]
    projected: bool = False


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _ms(dt: datetime) -> int:
    return int(dt.timestamp() * 1000)


def _err(code: str, *, retry: bool = False, field: str | None = None, **extra: Any) -> dict[str, Any]:
    out: dict[str, Any] = {"ok": False, "code": code, "retryable": retry, **extra}
    if field:
        out["field"] = field
    return out


def metric_entity_version(generation: int, sequence: int) -> int:
    return (int(generation) << _GEN_SHIFT) | int(sequence)


def _window_server_times(stream: CaptureStream, w: MetricWindow, now: datetime) -> tuple[datetime, datetime, bool]:
    """창 [start,end] 의 서버시계 시각. anchor 가 없으면 (수신시각, 수신시각, False). 반환 3번째 = anchor 로 환산했는가."""
    if stream.anchor_server_at is None or stream.anchor_monotonic_us is None:
        return now, now, False
    base = int(stream.anchor_monotonic_us)
    return (stream.anchor_server_at + timedelta(microseconds=w.window_start_us - base),
            stream.anchor_server_at + timedelta(microseconds=w.window_end_us - base), True)


def freshness_of(stream: CaptureStream, end_at: datetime, now: datetime, anchored: bool) -> str:
    if stream.clock_uncertain or not anchored:
        return "time_uncertain"
    age_ms = (now - end_at).total_seconds() * 1000
    if age_ms < -FUTURE_TOLERANCE_MS:  # 미래 창은 fresh 가 될 수 없다(anchor/시계 오류)
        return "time_uncertain"
    if age_ms <= FRESH_MAX_MS:
        return "fresh"
    return "delayed" if age_ms <= DELAYED_MAX_MS else "stale"


def _feature_item(w: MetricWindow, end_at: datetime, anchored: bool) -> EEGFeatureItem:
    """MetricWindow → 기존 feature 저장 형식. invalid/warming_up/gap 은 null 보존(0 치환 금지). display 값은 raw 에서 재계산 가능해 저장하지 않는다."""
    def v(name: str) -> float | None:
        m = w.metrics.get(name)
        return float(m["value"]) if m and m["validity"] == "valid" and m["value"] is not None else None

    return EEGFeatureItem(
        second_offset=w.sequence, timestamp=float(_ms(end_at)) if anchored else None, play_group_id=w.stream_id,
        focus_index=v("focus_raw"), relaxation_index=v("relaxation_raw"), emotional_stability=v("emotion_raw"),
        heart_rate=v("bpm"), respiratory_rate=v("respiration"), sdnn=v("sdnn"), signal_quality=w.sqi,
        source_feature_alias=w.feature_hash, algorithm_version=w.algorithm_version[:40],
    )


def _load_stream(db: DBSession, session_id: uuid.UUID, participant_id: uuid.UUID, stream_id: str) -> CaptureStream | None:
    try:
        sid = uuid.UUID(stream_id)
    except ValueError:
        return None
    s = db.execute(select(CaptureStream).where(CaptureStream.id == sid, CaptureStream.session_id == session_id)
                   .execution_options(populate_existing=True)).scalar_one_or_none()
    # 타인 stream 은 존재 여부도 알리지 않는다(같은 코드)
    return s if s is not None and s.participant_id == participant_id else None


def _ack(w: MetricWindow, status: str, now: datetime, *, code: str | None = None, durable: bool = False) -> dict[str, Any]:
    a: dict[str, Any] = {"session_id": w.session_id, "participant_id": w.participant_id, "stream_id": w.stream_id,
                         "sequence": str(w.sequence), "status": status, "durable": durable, "feature_hash": w.feature_hash,
                         "received_at_server_ms": _ms(now)}
    if code:
        a["code"] = code
    return a


def ingest_metrics(db: DBSession, actor: Actor, session_id: uuid.UUID, data: Any, *, now: datetime | None = None) -> IngestOutcome:
    """live:metric 배치 처리. 항상 DB 트랜잭션을 정리하고 wire 응답을 돌려준다(MetricAckBatch 또는 {ok:false})."""
    now = now or _now()
    if actor.participant_id is None:
        return IngestOutcome(_err("forbidden"))
    try:
        windows = parse_metric_batch(data)
    except WireError as exc:
        return IngestOutcome(_err(exc.code, field=exc.field))
    pid = actor.participant_id
    try:
        acks, live_candidates = _store_windows(db, actor, session_id, windows, now)
    except SQLAlchemyError:
        db.rollback()
        logger.warning("[live-ingest] metric 저장 실패", exc_info=True)
        return IngestOutcome(_err("db_unavailable", retry=True, retry_after_ms=1000))
    projected = False
    if live_candidates:
        try:
            projected = _project_latest(db, session_id, pid, live_candidates)
        except SQLAlchemyError:
            db.rollback()
            logger.warning("[live-ingest] metric 투영 실패 — 저장은 완료, 다음 수신이 최신값을 갱신한다", exc_info=True)
    return IngestOutcome({"protocol_version": PROTOCOL_VERSION, "schema_version": SCHEMA_VERSION, "acks": acks}, projected)


def _store_windows(db: DBSession, actor: Actor, session_id: uuid.UUID, windows: list[MetricWindow],
                   now: datetime) -> tuple[list[dict[str, Any]], list[tuple[MetricWindow, dict[str, Any]]]]:
    from app.services import session_service

    pid = actor.participant_id
    participant = db.get(SessionParticipant, pid)
    streams: dict[str, CaptureStream | None] = {}
    acks: list[dict[str, Any]] = []
    candidates: list[tuple[MetricWindow, dict[str, Any]]] = []
    to_save: list[tuple[int, MetricWindow, EEGFeatureItem, dict[str, Any]]] = []
    for w in windows:
        if w.session_id != str(session_id):
            acks.append(_ack(w, "rejected", now, code="session_mismatch"))
            continue
        if w.participant_id != str(pid) or participant is None or participant.session_id != session_id:
            acks.append(_ack(w, "rejected", now, code="participant_mismatch"))
            continue
        if w.stream_id not in streams:
            streams[w.stream_id] = _load_stream(db, session_id, pid, w.stream_id)
        stream = streams[w.stream_id]
        if stream is None:
            acks.append(_ack(w, "rejected", now, code="stream_not_found"))
            continue
        if w.stream_generation != int(stream.generation):
            acks.append(_ack(w, "rejected", now, code="stale_owner_generation"))  # fencing: 구 owner 는 저장도 live 도 못 한다
            continue
        start_at, end_at, anchored = _window_server_times(stream, w, now)
        decision = evaluate_ingest(db, stream_id=stream.id, window_start_at=start_at, window_end_at=end_at, now=now)
        if decision.verdict != "accept":
            # 격리(pending_time_review)·거절 모두 live/DB 에 반영하지 않는다. 원본은 archive(T09 v3) 경로가 시간검토로 보존한다.
            acks.append(_ack(w, "rejected", now, code=decision.code or decision.verdict))
            continue
        lease_ok = stream.lease_expires_at is not None and now <= stream.lease_expires_at
        item = _feature_item(w, end_at, anchored)
        live = None
        if stream.status == "active" and lease_ok:
            live = {"freshness": freshness_of(stream, end_at, now, anchored),
                    "observed_at_ms": _ms(end_at) if anchored and not stream.clock_uncertain else None,
                    "generation": int(stream.generation)}
        to_save.append((len(acks), w, item, live or {}))
        acks.append(_ack(w, "accepted", now))  # 아래에서 저장 결과로 확정/수정

    if not to_save:
        db.rollback()
        return acks, candidates

    # 기존 행 조회: 중복(duplicate)·해시 충돌 판정. play_group_id=stream_id 라 같은 키가 곧 같은 창이다.
    seqs = {w.sequence for _, w, _, _ in to_save}
    existing = {
        (pg, idx): alias
        for pg, idx, alias in db.execute(
            select(EEGFeatureWindow.play_group_id, EEGFeatureWindow.window_index, EEGFeatureWindow.source_feature_alias).where(
                EEGFeatureWindow.session_id == session_id, EEGFeatureWindow.participant_id == pid,
                EEGFeatureWindow.window_index.in_(seqs), EEGFeatureWindow.play_group_id.in_({w.stream_id for _, w, _, _ in to_save}))
        ).all()
    }
    fresh_items: list[EEGFeatureItem] = []
    seen: dict[tuple[str, int], str] = {}
    for idx, w, item, live in to_save:
        key = (w.stream_id, w.sequence)
        prev = existing.get(key, seen.get(key))
        if prev is not None:
            if prev == w.feature_hash:
                acks[idx] = _ack(w, "duplicate", now, durable=True)
            else:
                acks[idx] = _ack(w, "rejected", now, code="feature_hash_conflict")
            continue
        seen[key] = w.feature_hash
        fresh_items.append(item)
    saved_keys: set[tuple[str, int]] = set()
    if fresh_items:
        # 같은 배치 안에 서로 다른 stream 이 섞여도 participant 단위 한 번에 저장한다(기존 저장 경로, 내부 SAVEPOINT 멱등)
        saved = session_service._persist_feature_items(session_id, participant, fresh_items, db)  # commit 포함
        saved_keys = {(str(i.play_group_id), int(i.second_offset)) for i in saved}
    else:
        db.rollback()
    for idx, w, item, live in to_save:
        key = (w.stream_id, w.sequence)
        if acks[idx]["status"] != "accepted":
            continue
        if key in saved_keys:
            acks[idx]["durable"] = True
            if live:
                candidates.append((w, live))
        else:  # 동시 저장 경합으로 건너뜀 → 이미 저장된 중복
            acks[idx] = _ack(w, "duplicate", now, durable=True)
    return acks, candidates


def _project_latest(db: DBSession, session_id: uuid.UUID, pid: uuid.UUID,
                    candidates: list[tuple[MetricWindow, dict[str, Any]]]) -> bool:
    """투영 가능한 창 중 가장 새 것 하나만 metrics.updated 로 outbox 에 기록한다(commit). 이미 더 새 값이 있으면 건너뛴다."""
    w, live = max(candidates, key=lambda c: metric_entity_version(c[1]["generation"], c[0].sequence))
    version = metric_entity_version(live["generation"], w.sequence)
    epoch_row = lock_epoch(db, session_id)  # 회차 직렬화(명령과 같은 락) → outbox revision 은 gap 없이 증가
    prev = db.execute(
        select(LiveOutbox.entity_version).where(LiveOutbox.session_id == session_id, LiveOutbox.domain == "metrics",
                                                LiveOutbox.entity_id == str(pid)).order_by(LiveOutbox.revision.desc()).limit(1)
    ).scalar_one_or_none()
    if prev is not None and int(prev) >= version:
        db.rollback()
        return False
    payload = {"participant_id": str(pid), "stream_id": w.stream_id, "sequence": str(w.sequence),
               "observed_at_ms": live["observed_at_ms"], "freshness": live["freshness"], "sqi": w.sqi,
               "contact": w.contact, "metrics": w.metrics}
    append_outbox(db, epoch_row, domain="metrics", event_type="metrics.updated", entity_id=str(pid), entity_version=version,
                  audience=["host", f"member:{pid}"], payload=payload, command_id=None)
    db.commit()
    return True


# ---------------------------------------------------------------------------
# live:device
# ---------------------------------------------------------------------------

def ingest_device(db: DBSession, actor: Actor, session_id: uuid.UUID, data: Any, *, now: datetime | None = None) -> IngestOutcome:
    """live:device 밴드 상태 보고. 본인 active stream 만, device_seq 는 단조(작거나 같으면 duplicate). outbox `device.changed` + v1 호환 필드 갱신."""
    now = now or _now()
    if actor.participant_id is None:
        return IngestOutcome(_err("forbidden"))
    try:
        rep = parse_device(data)
    except WireError as exc:
        return IngestOutcome(_err(exc.code, field=exc.field))
    if rep.session_id != str(session_id):
        return IngestOutcome(_err("session_mismatch"))
    pid = actor.participant_id
    try:
        stream = _load_stream(db, session_id, pid, rep.stream_id)
        if stream is None:
            db.rollback()
            return IngestOutcome(_err("stream_not_found"))
        if stream.status != "active":
            db.rollback()
            return IngestOutcome(_err("stream_not_active"))
        epoch_row = lock_epoch(db, session_id)
        db.refresh(stream)
        if stream.status != "active":
            db.rollback()
            return IngestOutcome(_err("stream_not_active"))
        prev = last_device_payload(db, session_id, pid)
        if prev and prev.get("stream_id") == rep.stream_id and prev.get("device_seq") is not None and int(prev["device_seq"]) >= rep.device_seq:
            db.rollback()
            return IngestOutcome(_device_ack(rep, "duplicate"))
        band = {"device_seq": str(rep.device_seq), "band_state": rep.band_state, "contact": rep.contact, "sqi": rep.sqi,
                "battery_pct": rep.battery_pct, "state_reason": rep.state_reason}
        append_outbox(db, epoch_row, domain="device", event_type="device.changed", entity_id=str(pid),
                      entity_version=int(stream.entity_version), audience=["host", f"member:{pid}"],
                      payload=device_payload(stream, band=band), command_id=None)
        participant = db.get(SessionParticipant, pid)
        if participant is not None:  # v1 호환: 호스트 모니터링(밴드 연결/배터리)
            participant.band_connected = rep.band_state == "connected"
            if rep.battery_pct is not None:
                participant.band_battery = rep.battery_pct
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        logger.warning("[live-ingest] device 저장 실패", exc_info=True)
        return IngestOutcome(_err("db_unavailable", retry=True, retry_after_ms=1000))
    return IngestOutcome(_device_ack(rep, "accepted"), True)


def _device_ack(rep: DeviceReport, status: str) -> dict[str, Any]:
    return {"protocol_version": PROTOCOL_VERSION, "schema_version": SCHEMA_VERSION, "session_id": rep.session_id,
            "stream_id": rep.stream_id, "device_seq": str(rep.device_seq), "status": status, "durable": True,
            "received_at_server_ms": _ms(_now())}


# ---------------------------------------------------------------------------
# sink 어댑터 (ws 네임스페이스가 set_metric_sink/set_device_sink 로 등록)
# ---------------------------------------------------------------------------

def make_sinks(open_db: Callable[[], DBSession], publish: Callable[[uuid.UUID], Any]):
    """(metric_sink, device_sink). open_db 는 호출 시점에 평가한다(시험에서 교체 가능). publish 실패는 ACK 를 막지 않는다."""

    def _run(fn, actor, session_id, data):
        db = open_db()
        try:
            out = fn(db, actor, session_id, data)
        finally:
            db.close()
        if out.projected:
            try:
                publish(session_id)
            except Exception:  # noqa: BLE001 — 방송은 heartbeat 가 이어서 한다
                logger.warning("[live-ingest] 투영 방송 실패 — heartbeat self-heal", exc_info=True)
        return out.response

    return (lambda actor, sid, data: _run(ingest_metrics, actor, sid, data),
            lambda actor, sid, data: _run(ingest_device, actor, sid, data))
