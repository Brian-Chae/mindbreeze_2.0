"""SDD-246 T03 — command ledger 저수준 연산 (해시·epoch 락·outbox append·결과 변환).

동시성 모델: 회차당 `live_session_epoch` 행을 `SELECT ... FOR UPDATE` 로 잠가 그 회차의 모든 명령을 직렬화한다.
같은 command_id 가 100번 동시에 들어와도 락 대기 후 ledger 를 다시 읽어 하나만 실행되고 나머지는 원 결과를 받는다.
PostgreSQL 전용이다(SQLite 로 동시성 증거를 대체하지 않는다).
"""

from __future__ import annotations

import hashlib
import json
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session as DBSession

from app.models.live_state import LiveCommandLedger, LiveOutbox, LiveSessionEpoch

# 시스템 actor(자동 승격 등). 계정/참가자 UUID 와 충돌하지 않는 고정값.
SYSTEM_ACTOR_ID = uuid.UUID(int=0)

# 같은 command_id 로 body 가 다를 때의 코드(HTTP 409 매핑은 T05).
IDEMPOTENCY_CONFLICT = "idempotency_conflict"


@dataclass(frozen=True)
class DurableResult:
    """`apply_command` / `lookup_result` 의 영속 결과. ACK 매핑은 T05 가 한다.

    status: applied | rejected. duplicate=True 면 ledger 의 원 결과 재생(ACK status=duplicate).
    committed=False 는 이 호출이 아무것도 commit 하지 않았다는 뜻(충돌·일시 거절).
    """

    command_id: uuid.UUID
    status: str
    code: str | None
    epoch: int
    revision: int
    entity_version: int | None
    result: dict[str, Any] = field(default_factory=dict)
    duplicate: bool = False
    committed: bool = True
    transient: bool = False  # True 면 ledger 에 저장되지 않은 일시 거절(epoch 불일치·세션 없음 등)

    @property
    def http_status(self) -> int:
        if self.code == IDEMPOTENCY_CONFLICT:
            return 409
        return 200


def canonical_body_hash(*, session_id: uuid.UUID, kind: str, target_id: str | None,
                        expected_entity_version: str | None, payload: dict[str, Any]) -> str:
    """재시도 시 달라질 수 있는 필드(command_id·expected_epoch·client_generation·protocol)는 해시에서 제외한다."""
    body = {
        "session_id": str(session_id),
        "kind": kind,
        "target_id": target_id,
        "expected_entity_version": expected_entity_version,
        "payload": payload,
    }
    raw = json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def require_postgres(db: DBSession) -> None:
    name = db.get_bind().dialect.name
    if name != "postgresql":
        raise RuntimeError(f"session_live ledger 는 PostgreSQL 전용이다(dialect={name})")


def lock_epoch(db: DBSession, session_id: uuid.UUID) -> LiveSessionEpoch:
    """epoch 행을 (없으면 만들고) FOR UPDATE 로 잠근다. 같은 회차 명령은 여기서 직렬화된다."""
    require_postgres(db)
    db.execute(pg_insert(LiveSessionEpoch).values(session_id=session_id).on_conflict_do_nothing(
        index_elements=[LiveSessionEpoch.session_id]))
    return db.execute(
        select(LiveSessionEpoch).where(LiveSessionEpoch.session_id == session_id)
        .with_for_update().execution_options(populate_existing=True)
    ).scalar_one()


def find_entry(db: DBSession, session_id: uuid.UUID, actor_id: uuid.UUID, command_id: uuid.UUID) -> LiveCommandLedger | None:
    return db.execute(
        select(LiveCommandLedger).where(
            LiveCommandLedger.session_id == session_id,
            LiveCommandLedger.actor_id == actor_id,
            LiveCommandLedger.command_id == command_id,
        ).execution_options(populate_existing=True)
    ).scalar_one_or_none()


def entry_to_result(entry: LiveCommandLedger, *, duplicate: bool) -> DurableResult:
    return DurableResult(
        command_id=entry.command_id, status=entry.status, code=entry.code, epoch=int(entry.epoch),
        revision=int(entry.revision), entity_version=None if entry.entity_version is None else int(entry.entity_version),
        result=dict(entry.result or {}), duplicate=duplicate, committed=True,
    )


def replay_or_conflict(entry: LiveCommandLedger, body_hash: str) -> DurableResult:
    if entry.body_hash != body_hash:
        return DurableResult(
            command_id=entry.command_id, status="rejected", code=IDEMPOTENCY_CONFLICT, epoch=int(entry.epoch),
            revision=int(entry.revision), entity_version=None, result={}, duplicate=True, committed=False,
        )
    return entry_to_result(entry, duplicate=True)


def lookup_result(db: DBSession, session_id: uuid.UUID, actor_id: uuid.UUID, command_id: uuid.UUID,
                  body_hash: str | None = None) -> DurableResult | None:
    """ACK 유실 후 결과 조회. 없으면 None(= 아직 commit 되지 않음 → 같은 ID 로 재시도)."""
    entry = find_entry(db, session_id, actor_id, command_id)
    if entry is None:
        return None
    if body_hash is not None:
        return replay_or_conflict(entry, body_hash)
    return entry_to_result(entry, duplicate=True)


def append_outbox(db: DBSession, epoch_row: LiveSessionEpoch, *, domain: str, event_type: str,
                  entity_id: str | None, entity_version: int | None, audience: list[str],
                  payload: dict[str, Any], command_id: uuid.UUID | None) -> LiveOutbox:
    """epoch 락을 쥔 상태에서만 호출한다. revision 은 회차 내 gap 없는 단조 증가."""
    epoch_row.revision = int(epoch_row.revision) + 1
    row = LiveOutbox(
        event_id=uuid.uuid4(), session_id=epoch_row.session_id, revision=epoch_row.revision, epoch=epoch_row.epoch,
        domain=domain, event_type=event_type, entity_id=entity_id, entity_version=entity_version,
        audience_policy=list(audience), payload=payload, command_id=command_id,
    )
    db.add(row)
    return row


def insert_entry(db: DBSession, *, session_id: uuid.UUID, actor_id: uuid.UUID, command_id: uuid.UUID, kind: str,
                 body_hash: str, status: str, code: str | None, epoch: int, revision: int,
                 entity_version: int | None, result: dict[str, Any], now: datetime | None = None) -> LiveCommandLedger:
    row = LiveCommandLedger(
        session_id=session_id, actor_id=actor_id, command_id=command_id, kind=kind, body_hash=body_hash,
        status=status, code=code, epoch=epoch, revision=revision, entity_version=entity_version, result=result,
    )
    if now is not None:
        row.created_at = now
    db.add(row)
    db.flush()
    return row
