"""SDD-246 T04 — DB outbox → Redis projector (순서 소비) 와 DB 기반 재구축.

원칙 (plan §4.2)
- 정본은 DB(`live_outbox`). Redis 는 projection 이다. 순서는 회차 durable revision(gap 없음)으로 고정된다.
- projector 는 Redis 의 `applied_revision`(projection watermark) 바로 다음 revision 만 적용한다. 앞선 항목을
  건너뛰지 않는다(Lua 가 `prev revision` 검사). 호출자가 역순/중복 event 를 넘겨도 `project()` 는 DB 에서
  watermark 이후를 순서대로 다시 읽어 적용하므로 결과는 같다.
- Redis 적용 성공 뒤에 DB `processed_at` 을 표기한다. 그 사이 crash 하면 다음 drain 이 같은 event 를 다시
  보내지만 Lua 의 `dedupe`/watermark 가 duplicate 로 무해화한다(seq 이중 증가 없음).
- 중복 projector 는 Redis fence 락(TTL 10초)으로 하나만 쓴다. 락을 잃으면 stale_fence 로 쓰기가 거부된다.
- Redis 전체 소실: DB 의 epoch 를 원자 증가시키고(회차 행 락) outbox 전체를 접어 상태를 복원한다. 재구축 락으로
  단일 rebuild. 복원 중에는 meta 가 없어 snapshot/READY 가 열리지 않는다.
- Redis 불가/OOM 은 `LiveRedisUnavailable` 로 전파(fail-closed). 메모리 폴백 없음.
"""

from __future__ import annotations

import json
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session as DBSession

from app.models.live_state import LiveOutbox, LiveSessionEpoch
from app.services.live_redis import keys
from app.services.live_redis.client import (
    Fence,
    LiveNotReady,
    LiveRedis,
    LiveRedisUnavailable,
    ProjectionEpochMismatch,
    ProjectionFenceLost,
    ProjectionGap,
)
from app.services.session_live_ledger import lock_epoch
from app.services.session_live_state import (
    LiveStateService,
    Scope,
    entity_key,
    is_removal,
    is_terminal_event,
    state_value,
)

DRAIN_BATCH = 500
REBUILD_LOCK_TTL_MS = 30_000
REBUILD_WAIT_S = 5.0


@dataclass
class DrainResult:
    projected: int = 0  # 이번 호출이 Redis 에 새로 적용한 event 수
    duplicates: int = 0  # Redis 가 이미 적용했다고 응답(재처리 무해)
    marked: int = 0  # DB processed_at 표기 수
    applied_revision: int = 0
    busy: bool = False  # 다른 projector 가 fence 를 쥐고 있어 이번엔 쓰지 않음
    epoch: int = 0
    rebuilt: bool = False


@dataclass
class Hooks:
    """crash 매트릭스 시험용 주입점. 운영 코드는 None."""

    after_redis: Callable[[LiveOutbox], None] | None = None  # Redis 적용 직후, DB 표기 전
    before_redis: Callable[[LiveOutbox], None] | None = None


def _now_ms() -> int:
    return int(time.time() * 1000)


# ---------------------------------------------------------------------------------------------
# DB 헬퍼
# ---------------------------------------------------------------------------------------------

def _epoch_row(db: DBSession, session_id: uuid.UUID) -> LiveSessionEpoch:
    row = db.execute(select(LiveSessionEpoch).where(LiveSessionEpoch.session_id == session_id)
                     .execution_options(populate_existing=True)).scalar_one_or_none()
    if row is None:
        row = lock_epoch(db, session_id)  # 행 생성(+락) → 즉시 commit 으로 락 해제
        db.commit()
        row = db.execute(select(LiveSessionEpoch).where(LiveSessionEpoch.session_id == session_id)
                         .execution_options(populate_existing=True)).scalar_one()
    return row


def _mark_processed(db: DBSession, session_id: uuid.UUID, up_to: int) -> int:
    res = db.execute(update(LiveOutbox).where(
        LiveOutbox.session_id == session_id, LiveOutbox.revision <= up_to, LiveOutbox.processed_at.is_(None)
    ).values(processed_at=func.now()))
    db.commit()
    return int(res.rowcount or 0)


def _pending_rows(db: DBSession, session_id: uuid.UUID, after_revision: int, limit: int) -> list[LiveOutbox]:
    return list(db.execute(
        select(LiveOutbox).where(LiveOutbox.session_id == session_id, LiveOutbox.revision > after_revision)
        .order_by(LiveOutbox.revision).limit(limit).execution_options(populate_existing=True)
    ).scalars())


def _audiences(row: LiveOutbox) -> list[str]:
    seen: list[str] = []
    for a in row.audience_policy or []:
        if a not in seen:
            seen.append(a)
    return seen


def _row_version(row: LiveOutbox) -> int:
    # entity_version 이 없는 event 는 revision 을 버전으로 쓴다(회차 내 단조 증가).
    return int(row.entity_version) if row.entity_version is not None else int(row.revision)


# ---------------------------------------------------------------------------------------------
# 재구축
# ---------------------------------------------------------------------------------------------

def _fold(rows: list[LiveOutbox], *, now_ms: int) -> tuple[dict[str, dict[str, str]], dict[str, int], bool]:
    """outbox 전체를 Redis 가 projection 할 때와 같은 규칙으로 접는다 → (states, seqs, terminal)."""
    states: dict[str, dict[str, dict[str, Any]]] = {}
    seqs: dict[str, int] = {}
    session_state: dict[str, Any] | None = None
    for row in rows:
        removed = is_removal(row.event_type)
        ent = entity_key(row.domain, row.entity_id, row.payload or {})
        ver = _row_version(row)
        for aud in _audiences(row):
            ad = f"{aud}|{row.domain}"
            seqs[ad] = seqs.get(ad, 0) + 1
            bucket = states.setdefault(ad, {})
            cur = bucket.get(ent)
            if cur is None or int(cur["v"]) <= ver:  # Lua 와 동일: 낮은 버전은 덮지 못한다
                bucket[ent] = {"v": ver, "x": 1} if removed else {"v": ver, "d": dict(row.payload or {})}
        if row.domain == "session" and not removed:
            session_state = dict(row.payload or {})

    # 오래된 값 보정: metric 은 stale, signal 은 절대 만료 지난 것 제거, 접속(connected)은 재join 전 unknown→false
    for ad, bucket in states.items():
        dom = ad.split("|", 1)[1]
        for ent, raw in bucket.items():
            if raw.get("x"):
                continue
            d = raw["d"]
            if dom == "metrics" and isinstance(d, dict):
                d["freshness"] = "stale"
            elif dom == "signal" and isinstance(d, dict) and int(d.get("expires_at_ms", 0)) <= now_ms:
                bucket[ent] = {"v": raw["v"], "x": 1}
            elif dom == "participation" and isinstance(d, dict) and "connected" in d:
                d["connected"] = False
    out = {ad: {ent: json.dumps(raw, separators=(",", ":"), ensure_ascii=False) for ent, raw in b.items()}
           for ad, b in states.items()}
    terminal = bool(session_state and is_terminal_event("session", session_state))
    return out, seqs, terminal


def rebuild(db: DBSession, live: LiveRedis, session_id: uuid.UUID, *, now_ms: int | None = None,
            force: bool = False) -> int:
    """DB outbox 로부터 Redis 상태를 단일 rebuild 로 복원하고 현재 epoch 를 돌려준다.

    - meta 가 없고 과거에 projection 된 흔적(processed_at)이 있으면 Redis 소실 → epoch +1 (원자, 회차 행 락).
    - meta 가 없고 projection 된 적이 없으면 최초 구축 → epoch 유지.
    - meta epoch < DB epoch(이전 rebuild 가 중간에 죽음) → DB epoch 로 복원(추가 증가 없음).
    """
    now_ms = now_ms if now_ms is not None else _now_ms()
    token = uuid.uuid4().hex
    deadline = time.monotonic() + REBUILD_WAIT_S
    while not live.acquire_rebuild(session_id, token, REBUILD_LOCK_TTL_MS):
        # 다른 프로세스가 재구축 중: 끝나면 meta 가 생긴다.
        meta = live.read_meta(session_id)
        if meta and int(meta.get("epoch", 0)) == int(_epoch_row(db, session_id).epoch):
            db.rollback()
            return int(meta["epoch"])
        db.rollback()
        if time.monotonic() > deadline:
            raise LiveNotReady("rebuild_in_progress")
        time.sleep(0.05)
    try:
        meta = live.read_meta(session_id)
        row = lock_epoch(db, session_id)
        db_epoch = int(row.epoch)
        if meta and int(meta.get("epoch", 0)) == db_epoch and not force:
            db.rollback()
            return db_epoch
        if meta and int(meta.get("epoch", 0)) > db_epoch:
            db.rollback()
            raise RuntimeError(f"Redis epoch({meta['epoch']}) 가 DB epoch({db_epoch}) 보다 크다 — 수동 확인 필요")
        was_projected = db.execute(select(func.count()).select_from(LiveOutbox).where(
            LiveOutbox.session_id == session_id, LiveOutbox.processed_at.is_not(None))).scalar_one() > 0
        bump = force or (not meta and was_projected)
        if bump:
            row.epoch = db_epoch + 1
        target_epoch = int(row.epoch)
        # 최초 구축(Redis 에 흔적도 없고 projection 이력도 없음)은 빈 상태로 시작해 drain 이 event 를 하나씩
        # projection 한다(stream 이력 보존). Redis 소실/epoch 뒤처짐은 outbox 를 접어 상태를 복원한다.
        fold = bump or bool(meta)
        high = int(row.revision) if fold else 0
        rows = list(db.execute(
            select(LiveOutbox).where(LiveOutbox.session_id == session_id, LiveOutbox.revision <= high)
            .order_by(LiveOutbox.revision).execution_options(populate_existing=True)).scalars()) if fold else []
        states, seqs, terminal = _fold(rows, now_ms=now_ms)
        auth_rev = int(row.auth_revision) if fold else 0
        db.commit()  # epoch 증가 확정 + 회차 행 락 해제 (이후 명령은 새 epoch 로 outbox 를 쌓는다)

        res = live.restore_raw(session_id, epoch=target_epoch, applied_revision=high, auth_revision=auth_rev,
                               status="terminal" if terminal else "active", states=states, seqs=seqs)
        if res[0] == "exists":
            return int(res[1])
        # 복원된 revision 까지는 Redis 가 정본으로 가졌으므로 표기. 이후 revision 은 drain 이 이어서 적용한다.
        if fold:
            _mark_processed(db, session_id, high)
        return target_epoch
    finally:
        live.release_rebuild(session_id, token)


def ensure_ready(db: DBSession, live: LiveRedis, session_id: uuid.UUID) -> int:
    """Redis 가 이 회차의 현재 DB epoch 로 준비되어 있는지 확인(아니면 rebuild)하고 epoch 를 돌려준다."""
    meta = live.read_meta(session_id)
    row = _epoch_row(db, session_id)
    db_epoch = int(row.epoch)
    db.rollback()
    if meta and int(meta.get("epoch", 0)) == db_epoch and meta.get("status") in ("active", "terminal"):
        return db_epoch
    return rebuild(db, live, session_id)


# ---------------------------------------------------------------------------------------------
# projector
# ---------------------------------------------------------------------------------------------

def _acquire(live: LiveRedis, session_id: uuid.UUID, token: str, wait_s: float) -> Fence | None:
    deadline = time.monotonic() + wait_s
    while True:
        fence = live.acquire_projector(session_id, token)
        if fence is not None or time.monotonic() >= deadline:
            return fence
        time.sleep(0.02)


def drain(db: DBSession, live: LiveRedis, session_id: uuid.UUID, *, wait_s: float = 0.0,
          hooks: Hooks | None = None, token: str | None = None, batch: int = DRAIN_BATCH) -> DrainResult:
    """Redis watermark 이후의 outbox 를 revision 순서대로 모두 projection 한다."""
    hooks = hooks or Hooks()
    token = token or uuid.uuid4().hex
    out = DrainResult()
    for _attempt in range(3):
        try:
            epoch = ensure_ready(db, live, session_id)
            out.epoch = epoch
            fence = _acquire(live, session_id, token, wait_s)
            if fence is None:
                out.busy = True
                return out
            try:
                _drain_locked(db, live, session_id, fence, epoch, out, hooks, batch)
            finally:
                try:
                    live.release_projector(session_id, fence)
                except LiveRedisUnavailable:
                    pass  # 락은 TTL 로 만료된다
            return out
        except (ProjectionEpochMismatch, LiveNotReady):
            continue  # 재구축/전환 중 — ensure_ready 를 다시 거친다
    raise LiveNotReady("not_ready_after_retries")


def _drain_locked(db: DBSession, live: LiveRedis, session_id: uuid.UUID, fence: Fence, epoch: int, out: DrainResult,
                  hooks: Hooks, batch: int) -> None:
    last_renew = time.monotonic()
    while True:
        meta = live.read_meta(session_id)
        if not meta:
            raise LiveNotReady("no_meta")
        applied = int(meta["applied_revision"])
        out.applied_revision = applied
        # Redis 는 적용했지만 DB 표기 전에 죽은 항목(crash 후 재처리)을 표기만 한다.
        out.marked += _mark_processed(db, session_id, applied)
        rows = _pending_rows(db, session_id, applied, batch)
        if not rows:
            return
        auth_rev = int(_epoch_row(db, session_id).auth_revision)
        db.rollback()
        for row in rows:
            if time.monotonic() - last_renew > 3.0:  # renew 3초
                if not live.renew_projector(session_id, fence):
                    raise ProjectionFenceLost("projector fence 를 잃었다")
                last_renew = time.monotonic()
            if hooks.before_redis:
                hooks.before_redis(row)
            res = _project_row(live, session_id, row, epoch, fence, auth_rev)
            if res[0] == "dup":
                out.duplicates += 1
            else:
                out.projected += 1
            out.applied_revision = max(out.applied_revision, int(row.revision))
            if hooks.after_redis:
                hooks.after_redis(row)
            out.marked += _mark_processed(db, session_id, int(row.revision))


def _project_row(live: LiveRedis, session_id: uuid.UUID, row: LiveOutbox, epoch: int, fence: Fence,
                 auth_rev: int) -> list:
    payload = dict(row.payload or {})
    removed = is_removal(row.event_type)
    res = live.project(
        session_id, epoch=epoch, fence=fence, revision=int(row.revision), event_id=str(row.event_id),
        domain=row.domain, entity_id=row.entity_id or "", entity_version=_row_version(row), kind=row.event_type,
        payload=payload, command_id=str(row.command_id) if row.command_id else "", now_ms=_now_ms(),
        deleted=removed, terminal=is_terminal_event(row.domain, payload), auth_revision=auth_rev,
        state_value=state_value(_row_version(row), payload, removed), audiences=_audiences(row))
    if res[0] in ("ok", "dup"):
        return res
    code = res[1]
    if code == "stale_fence":
        raise ProjectionFenceLost("stale fence")
    if code == "epoch_mismatch":
        raise ProjectionEpochMismatch()
    if code == "gap":
        raise ProjectionGap(int(res[2]), int(row.revision))
    if code in ("no_meta", "not_ready"):
        raise LiveNotReady(code)
    raise RuntimeError(f"projection 오류: {res}")


def project(db: DBSession, live: LiveRedis, event: LiveOutbox | None, *, session_id: uuid.UUID | None = None,
            wait_s: float = 5.0, hooks: Hooks | None = None) -> DrainResult:
    """T03 의 DurableResult/outbox → Redis. 호출 순서와 무관하게 revision 순서로 적용한다.

    `event` 는 어느 항목이든(역순·중복 포함) 이 호출이 끝나면 projection 이 보장되는 대상일 뿐이다.
    watermark 이후 전부를 순서대로 적용하므로 앞선 revision 을 건너뛰는 일이 없다.
    """
    sid = session_id or (event.session_id if event is not None else None)
    if sid is None:
        raise ValueError("event 또는 session_id 필요")
    res = drain(db, live, sid, wait_s=wait_s, hooks=hooks)
    if event is not None and not res.busy and res.applied_revision < int(event.revision):
        raise ProjectionGap(res.applied_revision, int(event.revision))
    return res


def snapshot_ready(db: DBSession, live: LiveRedis, session_id: uuid.UUID, scope: Scope, *,
                   request_id: uuid.UUID | None = None, connection_generation: int = 0,
                   wait_s: float = 2.0) -> dict[str, Any]:
    """미projection outbox 까지 재생한 뒤에만 snapshot 을 공개한다(재구축 직후 포함, plan §4.2)."""
    drain(db, live, session_id, wait_s=wait_s)
    return LiveStateService(live).snapshot(session_id, scope, request_id=request_id,
                                           connection_generation=connection_generation)
