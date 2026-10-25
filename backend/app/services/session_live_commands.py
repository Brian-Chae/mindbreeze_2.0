"""SDD-246 T03 — 영속 command service.

`apply_command(db, actor, command)` 는 한 트랜잭션 안에서
  회차 epoch 행 락 → ledger 조회(멱등/충돌) → 인가 → handler(업무 전이) → outbox append → ledger 기록 → commit
을 수행한다. 업무 전이·ledger·outbox 는 같은 commit 이므로 "commit 직후 crash" 에서도 재시도가 원 결과를 받고,
commit 전 crash 면 아무것도 남지 않아 같은 command_id 로 안전하게 재실행된다.

업무 handler 는 레지스트리에 등록한다. T03 은 capture.* 와 종료 cutoff 를 제공하고, 입장·대기·발언 등
기존 서비스 연결은 T05 가 `register_handler(kind, fn)` 으로 붙인다(같은 트랜잭션·같은 락 아래 실행).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DBSession

from app.models.live_state import CaptureStream, LiveSessionEpoch
from app.models.session import Session as SessionModel, SessionParticipant
from app.services.session_live_ledger import (
    SYSTEM_ACTOR_ID,
    DurableResult,
    append_outbox,
    canonical_body_hash,
    entry_to_result,
    find_entry,
    insert_entry,
    lock_epoch,
    lookup_result,  # noqa: F401  (재노출)
    replay_or_conflict,
)

# --- 상수 (plan §3.2/§7.1) ---
CAPTURE_LEASE_SECONDS = 30
CAPTURE_OFFLINE_BOUND_SECONDS = 600  # 마지막 서버 서명 이후 최대 10분
CLOSE_DEADLINE_SECONDS = 24 * 3600

CUTOFF_COMPLETED = "completed"  # 수료·정상 종료
CUTOFF_EXPELLED = "expelled"  # 추방
CUTOFF_CONSENT_WITHDRAWN = "consent_withdrawn"  # 뇌파 동의 철회
_CUTOFF_CODES = {CUTOFF_COMPLETED, CUTOFF_EXPELLED, CUTOFF_CONSENT_WITHDRAWN}

HOST_KINDS = frozenset({
    "session.open", "session.start", "session.end", "session.cancel", "waiting.remind", "waitlist.promote",
    "hand.lower", "speaking.set", "audio.set", "chat.set_enabled",
})
SELF_KINDS = frozenset({
    "entry.enter", "entry.leave", "waiting.set_ready", "waitlist.cancel", "hand.set", "signal.send", "signal.clear",
})
CAPTURE_KINDS = frozenset({"capture.start", "capture.close", "capture.renew", "capture.reanchor"})
ALL_KINDS = HOST_KINDS | SELF_KINDS | CAPTURE_KINDS


@dataclass(frozen=True)
class Actor:
    """role: host | member | system. participant_id 는 member 의 본인 참가자 행."""

    actor_id: uuid.UUID
    role: str
    participant_id: uuid.UUID | None = None

    @staticmethod
    def system() -> "Actor":
        return Actor(actor_id=SYSTEM_ACTOR_ID, role="system")


@dataclass(frozen=True)
class LiveCommand:
    """command.schema.json 의 서버 내부 표현(검증은 T05 transport 가 JSON Schema 로 선행)."""

    command_id: uuid.UUID
    session_id: uuid.UUID
    kind: str
    payload: dict[str, Any] = field(default_factory=dict)
    expected_epoch: int | None = None
    target_id: str | None = None
    expected_entity_version: int | None = None
    client_generation: int | None = None

    def body_hash(self) -> str:
        ev = None if self.expected_entity_version is None else str(self.expected_entity_version)
        return canonical_body_hash(session_id=self.session_id, kind=self.kind, target_id=self.target_id,
                                   expected_entity_version=ev, payload=self.payload)


class CommandRejected(Exception):
    """handler 가 던지는 결정적 거절(ledger 에 rejected 로 저장 → 재시도도 같은 결과)."""

    def __init__(self, code: str, result: dict[str, Any] | None = None):
        super().__init__(code)
        self.code = code
        self.result = result or {}


@dataclass
class HandlerContext:
    db: DBSession
    actor: Actor
    command: LiveCommand
    session: SessionModel
    epoch_row: LiveSessionEpoch
    now: datetime
    clock_probe_resolver: Callable[[uuid.UUID], int | None] | None = None
    entity_version: int | None = None
    result: dict[str, Any] = field(default_factory=dict)

    def emit(self, *, domain: str, event_type: str, entity_id: str | None, entity_version: int | None,
             audience: list[str], payload: dict[str, Any]) -> None:
        append_outbox(self.db, self.epoch_row, domain=domain, event_type=event_type, entity_id=entity_id,
                      entity_version=entity_version, audience=audience, payload=payload,
                      command_id=self.command.command_id)


Handler = Callable[[HandlerContext], None]
_HANDLERS: dict[str, Handler] = {}


def register_handler(kind: str, handler: Handler) -> None:
    """T05 가 기존 서비스 연결 handler 를 등록/교체한다."""
    if kind not in ALL_KINDS:
        raise ValueError(f"unknown command kind: {kind}")
    _HANDLERS[kind] = handler


def _transient(command: LiveCommand, code: str, epoch: int, revision: int) -> DurableResult:
    return DurableResult(command_id=command.command_id, status="rejected", code=code, epoch=epoch, revision=revision,
                         entity_version=None, result={}, duplicate=False, committed=False, transient=True)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _authorized(actor: Actor, kind: str) -> bool:
    if kind in HOST_KINDS:
        return actor.role in ("host", "system")
    if kind in CAPTURE_KINDS:
        return actor.role == "member" and actor.participant_id is not None
    if kind in SELF_KINDS:
        return actor.role in ("member", "host")
    return False


def apply_command(db: DBSession, actor: Actor, command: LiveCommand, *, now: datetime | None = None,
                  clock_probe_resolver: Callable[[uuid.UUID], int | None] | None = None,
                  commit: bool = True) -> DurableResult:
    """명령을 정확히 한 번 적용한다. 같은 (session, actor, command_id) 는 원 결과, body 가 다르면 idempotency_conflict."""
    now = now or _utcnow()
    body_hash = command.body_hash()
    if command.kind not in ALL_KINDS:
        return _transient(command, "unknown_kind", 0, 0)
    try:
        epoch_row = lock_epoch(db, command.session_id)
    except IntegrityError:  # 존재하지 않는 session_id (FK)
        db.rollback()
        return _transient(command, "session_not_found", 0, 0)

    # 1) 멱등/충돌: 락을 쥔 뒤 읽으므로 동시 중복 요청은 먼저 commit 한 하나만 남는다.
    existing = find_entry(db, command.session_id, actor.actor_id, command.command_id)
    if existing is not None:
        out = replay_or_conflict(existing, body_hash)
        if commit:
            db.rollback()  # 락 해제(읽기만 했다)
        return out

    epoch, revision = int(epoch_row.epoch), int(epoch_row.revision)
    if command.expected_epoch is not None and command.expected_epoch != epoch:
        if commit:
            db.rollback()
        return _transient(command, "epoch_mismatch", epoch, revision)

    session = db.execute(
        select(SessionModel).where(SessionModel.id == command.session_id).execution_options(populate_existing=True)
    ).scalar_one_or_none()
    if session is None:
        if commit:
            db.rollback()
        return _transient(command, "session_not_found", epoch, revision)

    status, code, entity_version, result = "applied", None, None, {}
    ctx = HandlerContext(db=db, actor=actor, command=command, session=session, epoch_row=epoch_row, now=now,
                         clock_probe_resolver=clock_probe_resolver)
    if not _authorized(actor, command.kind):
        status, code = "rejected", "forbidden"
    else:
        handler = _HANDLERS.get(command.kind)
        if handler is None:
            if commit:
                db.rollback()
            return _transient(command, "handler_not_registered", epoch, revision)
        try:
            with db.begin_nested():  # 거절 시 handler 가 쓴 부분 변경을 되돌린다
                handler(ctx)
            entity_version, result = ctx.entity_version, ctx.result
        except CommandRejected as rej:
            status, code, result = "rejected", rej.code, rej.result
            # savepoint 가 outbox revision 증가분도 되돌렸으므로 in-memory 값을 DB 와 맞춘다
            db.refresh(epoch_row)
        except Exception:
            db.rollback()  # 예기치 못한 오류: 아무것도 남기지 않고(ledger 없음) 호출자가 같은 ID 로 재시도
            raise

    insert_entry(db, session_id=command.session_id, actor_id=actor.actor_id, command_id=command.command_id,
                 kind=command.kind, body_hash=body_hash, status=status, code=code, epoch=epoch,
                 revision=int(epoch_row.revision), entity_version=entity_version, result=result)
    if commit:
        db.commit()
    return DurableResult(command_id=command.command_id, status=status, code=code, epoch=epoch,
                         revision=int(epoch_row.revision), entity_version=entity_version, result=result,
                         duplicate=False, committed=True)


# ---------------------------------------------------------------------------
# capture handlers
# ---------------------------------------------------------------------------

def _aud(participant_id: uuid.UUID) -> list[str]:
    return ["host", f"member:{participant_id}"]


def _session_over(session: SessionModel) -> bool:
    return session.status in ("completed", "cancelled") or session.ended_at is not None


def _own_participant(ctx: HandlerContext) -> SessionParticipant:
    participant = ctx.db.execute(
        select(SessionParticipant).where(SessionParticipant.id == ctx.actor.participant_id,
                                         SessionParticipant.session_id == ctx.session.id)
    ).scalar_one_or_none()
    if participant is None or participant.waitlist_cancelled_at is not None:
        raise CommandRejected("participant_not_found")
    return participant


def _emit_device(ctx: HandlerContext, stream: CaptureStream, event_type: str = "device.changed") -> None:
    ctx.emit(domain="device", event_type=event_type, entity_id=str(stream.participant_id),
             entity_version=int(stream.entity_version), audience=_aud(stream.participant_id),
             payload={"stream_id": str(stream.id), "generation": int(stream.generation), "status": stream.status,
                      "clock_uncertain": bool(stream.clock_uncertain), "cutoff_code": stream.cutoff_code})


def _load_stream(ctx: HandlerContext, stream_id_raw: Any) -> CaptureStream:
    try:
        stream_id = uuid.UUID(str(stream_id_raw))
    except ValueError:
        raise CommandRejected("invalid_stream_id")
    stream = ctx.db.execute(
        select(CaptureStream).where(CaptureStream.id == stream_id, CaptureStream.session_id == ctx.session.id)
        .with_for_update().execution_options(populate_existing=True)
    ).scalar_one_or_none()
    # 타인 stream 은 존재 여부도 알리지 않는다
    if stream is None or stream.participant_id != ctx.actor.participant_id:
        raise CommandRejected("stream_not_found")
    ev = ctx.command.expected_entity_version
    if ev is not None and int(stream.entity_version) != ev:
        raise CommandRejected("entity_version_conflict", {"entity_version": str(int(stream.entity_version))})
    return stream


def _bump(stream: CaptureStream) -> None:
    stream.entity_version = int(stream.entity_version) + 1


def _handle_capture_start(ctx: HandlerContext) -> None:
    participant = _own_participant(ctx)
    if _session_over(ctx.session):
        raise CommandRejected("session_ended")  # 종료 후 새 stream 금지
    if participant.removed_at is not None:
        raise CommandRejected("participant_removed")
    if participant.eeg_collection_consented is False:
        raise CommandRejected("eeg_consent_required")
    p = ctx.command.payload
    # 참가자 단위 직렬화: 활성 stream 인계(fencing)는 같은 트랜잭션에서 이전 stream 을 superseded 로 닫고 세대를 올린다.
    ctx.db.execute(select(SessionParticipant.id).where(SessionParticipant.id == participant.id).with_for_update())
    prev = ctx.db.execute(
        select(CaptureStream).where(CaptureStream.participant_id == participant.id, CaptureStream.status == "active")
        .with_for_update().execution_options(populate_existing=True)
    ).scalars().all()
    for old in prev:
        old.status, old.closed_at, old.close_reason = "superseded", ctx.now, "superseded"
        old.lease_expires_at = None
        _bump(old)
        _emit_device(ctx, old)
    generation = int(ctx.db.execute(
        select(func.coalesce(func.max(CaptureStream.generation), 0)).where(CaptureStream.participant_id == participant.id)
    ).scalar_one()) + 1
    stream = CaptureStream(
        id=uuid.uuid4(), session_id=ctx.session.id, participant_id=participant.id, owner_actor_id=ctx.actor.actor_id,
        generation=generation, status="active", device_profile=p["device_profile"],
        algorithm_version=p["algorithm_version"], model_version=p["model_version"], clock_uncertain=True,
        lease_expires_at=ctx.now + timedelta(seconds=CAPTURE_LEASE_SECONDS),
        offline_bound_until=ctx.now + timedelta(seconds=CAPTURE_OFFLINE_BOUND_SECONDS),
        opened_at=ctx.now, entity_version=1,
    )
    ctx.db.add(stream)
    ctx.db.flush()
    _emit_device(ctx, stream)
    ctx.entity_version = 1
    ctx.result = {"stream_id": str(stream.id), "generation": str(generation),
                  "lease_expires_at": stream.lease_expires_at.isoformat(),
                  "offline_bound_until": stream.offline_bound_until.isoformat()}


def _handle_capture_close(ctx: HandlerContext) -> None:
    stream = _load_stream(ctx, ctx.command.payload.get("stream_id"))
    p = ctx.command.payload
    if stream.status in ("closed", "superseded", "revoked"):
        raise CommandRejected("stream_not_open")
    # 종료(ended) 상태는 cutoff 이후 close 를 받는 정상 경로 — deadline 이후만 거절
    if stream.status == "ended" and stream.close_deadline_at is not None and ctx.now > stream.close_deadline_at:
        raise CommandRejected("close_deadline_passed")
    final = {k: str(v) for k, v in dict(p.get("final_sequences") or {}).items()}
    stream.final_sequences = final
    stream.closed_at, stream.close_reason = ctx.now, str(p.get("reason"))
    # cutoff 가 이미 있으면 상태는 유지(ended 에서 closed 로) — cutoff_code 는 보존된다
    stream.status = "closed"
    stream.lease_expires_at = None
    _bump(stream)
    ctx.db.flush()
    _emit_device(ctx, stream)
    ctx.entity_version = int(stream.entity_version)
    ctx.result = {"stream_id": str(stream.id), "status": "closed"}


def _handle_capture_renew(ctx: HandlerContext) -> None:
    stream = _load_stream(ctx, ctx.command.payload.get("stream_id"))
    if stream.status != "active":
        raise CommandRejected("stream_not_active")
    if _session_over(ctx.session):
        raise CommandRejected("session_ended")
    if int(ctx.command.payload.get("owner_generation")) != int(stream.generation):
        raise CommandRejected("stale_owner_generation")  # fencing: 오래된 owner 는 갱신 불가
    stream.clock_anchor_id = uuid.UUID(str(ctx.command.payload["clock_anchor_id"]))
    stream.lease_expires_at = ctx.now + timedelta(seconds=CAPTURE_LEASE_SECONDS)
    stream.offline_bound_until = ctx.now + timedelta(seconds=CAPTURE_OFFLINE_BOUND_SECONDS)
    _bump(stream)
    ctx.db.flush()
    ctx.entity_version = int(stream.entity_version)
    ctx.result = {"stream_id": str(stream.id), "lease_expires_at": stream.lease_expires_at.isoformat(),
                  "offline_bound_until": stream.offline_bound_until.isoformat()}


def _handle_capture_reanchor(ctx: HandlerContext) -> None:
    stream = _load_stream(ctx, ctx.command.payload.get("stream_id"))
    if stream.status != "active":
        raise CommandRejected("stream_not_active")
    p = ctx.command.payload
    probe_id = uuid.UUID(str(p["clock_probe_id"]))
    # 오차는 서버가 probe 로 산출한 값만 신뢰한다. 확인 못 하면 clock_uncertain 유지(live fresh 제한).
    uncertainty = ctx.clock_probe_resolver(probe_id) if ctx.clock_probe_resolver else None
    stream.clock_probe_id = probe_id
    stream.anchor_device_ticks = int(p["device_ticks"])
    stream.anchor_monotonic_us = int(p["monotonic_us"])
    stream.anchor_server_at = ctx.now
    stream.clock_uncertainty_ms = uncertainty
    stream.clock_uncertain = uncertainty is None
    _bump(stream)
    ctx.db.flush()
    _emit_device(ctx, stream)
    ctx.entity_version = int(stream.entity_version)
    ctx.result = {"stream_id": str(stream.id), "clock_uncertain": bool(stream.clock_uncertain)}


# ---------------------------------------------------------------------------
# 종료·권한회수 cutoff (T05 의 session.end/추방/동의철회 handler 가 같은 트랜잭션에서 호출)
# ---------------------------------------------------------------------------

def _apply_cutoff(ctx_db: DBSession, streams: list[CaptureStream], *, cutoff_at: datetime, code: str, now: datetime,
                  emit: Callable[[CaptureStream], None] | None) -> list[CaptureStream]:
    if code not in _CUTOFF_CODES:
        raise ValueError(f"unknown cutoff code: {code}")
    changed = []
    for s in streams:
        if s.cutoff_at is not None:
            continue  # cutoff 는 한 번 고정되면 바꾸지 않는다(최초 확정 우선)
        s.cutoff_at, s.cutoff_code = cutoff_at, code
        s.close_deadline_at = now + timedelta(seconds=CLOSE_DEADLINE_SECONDS)
        if s.status == "active":
            s.status = "revoked" if code != CUTOFF_COMPLETED else "ended"
            s.lease_expires_at = None
        _bump(s)
        changed.append(s)
        if emit:
            emit(s)
    ctx_db.flush()
    return changed


def end_session_cutoff(ctx: HandlerContext, *, cutoff_at: datetime | None = None) -> list[CaptureStream]:
    """회차 종료: 등록된 모든 stream 에 cutoff(completed)·close deadline(24h) 고정. 종료 후 새 stream 은 거절된다."""
    streams = ctx.db.execute(
        select(CaptureStream).where(CaptureStream.session_id == ctx.session.id).with_for_update()
        .execution_options(populate_existing=True)
    ).scalars().all()
    ctx.epoch_row.auth_revision = int(ctx.epoch_row.auth_revision) + 1
    return _apply_cutoff(ctx.db, list(streams), cutoff_at=cutoff_at or ctx.now, code=CUTOFF_COMPLETED, now=ctx.now,
                         emit=lambda s: _emit_device(ctx, s))


def revoke_participant_capture(ctx: HandlerContext, participant_id: uuid.UUID, *, code: str,
                               cutoff_at: datetime | None = None) -> list[CaptureStream]:
    """추방(expelled)·동의철회(consent_withdrawn): 수료(completed)와 다른 권한 코드로 해당 참가자 stream 만 차단."""
    if code not in (CUTOFF_EXPELLED, CUTOFF_CONSENT_WITHDRAWN):
        raise ValueError("revoke code must be expelled or consent_withdrawn")
    streams = ctx.db.execute(
        select(CaptureStream).where(CaptureStream.participant_id == participant_id).with_for_update()
        .execution_options(populate_existing=True)
    ).scalars().all()
    ctx.epoch_row.auth_revision = int(ctx.epoch_row.auth_revision) + 1
    return _apply_cutoff(ctx.db, list(streams), cutoff_at=cutoff_at or ctx.now, code=code, now=ctx.now,
                         emit=lambda s: _emit_device(ctx, s))


def _handle_session_end(ctx: HandlerContext) -> None:
    """기본 session.end: live 상태(stream cutoff)만 확정. 업무 전이는 T05 가 이 handler 를 감싸 등록한다."""
    changed = end_session_cutoff(ctx)
    ctx.entity_version = int(ctx.session.state_version or 0)
    ctx.result = {"cutoff_at": ctx.now.isoformat(), "streams": str(len(changed))}


# ---------------------------------------------------------------------------
# ingest 판정 (T09/T04 가 metric·archive 수신 시 호출)
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class IngestDecision:
    verdict: str  # accept | reject | pending_time_review
    code: str | None = None
    live_fresh_allowed: bool = False  # 오래된 owner/종료 후/시간 불확실이면 False


def evaluate_ingest(db: DBSession, *, stream_id: uuid.UUID, window_start_at: datetime, window_end_at: datetime,
                    now: datetime | None = None) -> IngestDecision:
    """창 [start,end] (서버 시계 기준으로 anchor 에서 환산된 값) 의 수락 여부.

    - stream 없음/비활성+cutoff 없음(superseded·closed): 이력 저장만 허용 → accept(live_fresh_allowed=False)
    - cutoff 있음: end+오차<=cutoff 만 accept, 걸치면 pending_time_review, 이후면 reject(window_after_cutoff)
    - consent_withdrawn: 철회 이후 전송은 cutoff 이전 창이라도 reject (동의 없는 데이터 보관 금지)
    - expelled: cutoff 이전 창은 보관 목적으로 accept(live 반영 없음)
    - completed: close deadline(24h) 초과 시 reject
    - cutoff 없는 active: lease 만료 후면 offline_bound_until 이내 창만 accept, 넘으면 pending_time_review
    """
    now = now or _utcnow()
    s = db.execute(select(CaptureStream).where(CaptureStream.id == stream_id)
                   .execution_options(populate_existing=True)).scalar_one_or_none()
    if s is None:
        return IngestDecision("reject", "stream_not_found")
    uncertainty = timedelta(milliseconds=int(s.clock_uncertainty_ms or 0))
    if s.clock_uncertain or s.anchor_server_at is None:
        # 서버 서명 anchor 가 없으면 시각을 입증할 수 없다 — 종료/철회 이후 가능성이 있으면 격리
        if s.cutoff_at is not None:
            return IngestDecision("pending_time_review", "clock_uncertain")
    if s.cutoff_code == CUTOFF_CONSENT_WITHDRAWN:
        return IngestDecision("reject", CUTOFF_CONSENT_WITHDRAWN)
    if s.cutoff_at is not None:
        if s.cutoff_code == CUTOFF_COMPLETED and s.close_deadline_at is not None and now > s.close_deadline_at:
            return IngestDecision("reject", "close_deadline_passed")
        if window_start_at >= s.cutoff_at + uncertainty:
            return IngestDecision("reject", "window_after_cutoff")
        if window_end_at + uncertainty <= s.cutoff_at:
            return IngestDecision("accept", None, live_fresh_allowed=False)
        return IngestDecision("pending_time_review", "straddles_cutoff")
    if s.status == "active":
        if s.lease_expires_at is not None and now <= s.lease_expires_at:
            return IngestDecision("accept", None, live_fresh_allowed=not s.clock_uncertain)
        if s.offline_bound_until is not None and window_end_at + uncertainty <= s.offline_bound_until:
            return IngestDecision("accept", None, live_fresh_allowed=False)
        return IngestDecision("pending_time_review", "beyond_offline_bound")
    return IngestDecision("accept", None, live_fresh_allowed=False)  # superseded/closed: 이력만


register_handler("capture.start", _handle_capture_start)
register_handler("capture.close", _handle_capture_close)
register_handler("capture.renew", _handle_capture_renew)
register_handler("capture.reanchor", _handle_capture_reanchor)
register_handler("session.end", _handle_session_end)
