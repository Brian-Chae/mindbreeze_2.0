"""SDD-246 T04 — Redis live 상태 읽기 계층: snapshot(scope) · replay(cursor) · heartbeat 와 상태 변환.

- snapshot: Redis 단일 Lua 한 번에 state + through vector + epoch + auth_revision 을 같은 시점에 읽는다
  (projector 의 state 갱신/seq 증가/stream append 도 같은 slot 의 원자 Lua 이므로 중간 상태가 보이지 않는다).
- scope: host 는 host+public, member 는 public+본인 member:<participant>. 그 밖 audience 는 읽지 않는다.
- Redis 불가/OOM 은 `LiveRedisUnavailable` 로 전파 → 호출자는 503/retryable·DEGRADED. 메모리 폴백 없음.
"""

from __future__ import annotations

import json
import time
import uuid
from dataclasses import dataclass
from typing import Any

from app.services.live_redis import keys
from app.services.live_redis.client import LiveNotReady, LiveRedis

PROTOCOL_VERSION = 2
SCHEMA_VERSION = 1
TERMINAL_SESSION_STATUSES = frozenset({"completed", "cancelled"})
# 삭제(tombstone)로 처리하는 event kind 접미사
_REMOVAL_SUFFIXES = (".removed", ".expired")

# snapshot 의 domain → wire 필드 (device 는 `devices`, aggregate 는 `aggregates`)
_WIRE_FIELD = {"session": "session", "participation": "participation", "waiting": "waiting", "speaking": "speaking",
               "signal": "signal", "audio": "audio", "device": "devices", "metrics": "metrics",
               "aggregate": "aggregates", "policy": "policy"}
_SINGLETON_DEFAULTS: dict[str, dict[str, Any]] = {
    "audio": {"track_id": None, "action": "stop", "position_ms": 0, "server_anchor_ms": 0, "rate": 1.0,
              "revision": "0"},
    "aggregate": {"revision": "0", "window_ms": 5000, "participant_count": 0, "metrics": {}},
    "policy": {"chat_enabled": False, "capabilities": [], "consent_revision": "0"},
}


class SnapshotIncomplete(Exception):
    """필수 상태(session)가 없다 — 불완전 snapshot 을 만들지 않는다."""


class ScopeStale(Exception):
    """snapshot 의 auth_revision 이 scope 가 평가된 revision 보다 앞선다(권한회수 가능). 재인가 후 재시도."""

    def __init__(self, scope_rev: int, current: int):
        super().__init__(f"auth_revision {current} > scope {scope_rev}")
        self.scope_rev, self.current = scope_rev, current


class ScopeViolation(Exception):
    """scope 밖 audience 요청."""


class ReplayUnavailable(Exception):
    """replay 불가(epoch 불일치·cursor 가 서버보다 앞섬·log 절단). 새 완전 snapshot 이 필요하다."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class Scope:
    role: str  # host | member
    participant_id: uuid.UUID | None = None
    auth_revision: int | None = None  # 이 scope 를 인가할 때 본 auth_revision. None 이면 검사 생략(테스트·내부용)

    def audiences(self) -> list[str]:
        if self.role == "host":
            return ["host", "public"]
        if self.role == "member" and self.participant_id is not None:
            return ["public", f"member:{self.participant_id}"]
        raise ScopeViolation(f"invalid scope role={self.role}")


@dataclass(frozen=True)
class Cursor:
    audience: str
    domain: str
    seq: int


@dataclass(frozen=True)
class ReplayResult:
    epoch: int
    auth_revision: int
    terminal: bool
    events: list[dict[str, Any]]  # wire LiveEvent 후보 (seq 오름차순, audience·domain 별)
    through: list[Cursor]


# --------------------------------------------------------------------------------------------
# 상태 변환 (projector·rebuild 공유)
# --------------------------------------------------------------------------------------------

def is_removal(event_type: str) -> bool:
    return event_type.endswith(_REMOVAL_SUFFIXES)


def entity_key(domain: str, entity_id: str | None, payload: dict[str, Any]) -> str:
    if domain in keys.SINGLETON_DOMAINS:
        return keys.SINGLETON_KEY
    return entity_id or str(payload.get("entity_id") or "")


def state_value(version: int, payload: dict[str, Any], removed: bool) -> str:
    """hash 값 JSON. `v`=entity_version(낮은 버전이 덮지 못함), `d`=DTO, `x`=tombstone."""
    body: dict[str, Any] = {"v": int(version)}
    if removed:
        body["x"] = 1
    else:
        body["d"] = payload
    return json.dumps(body, separators=(",", ":"), ensure_ascii=False)


def is_terminal_event(domain: str, payload: dict[str, Any]) -> bool:
    return domain == "session" and payload.get("status") in TERMINAL_SESSION_STATUSES


def _u64(n: int | str) -> str:
    return str(int(n))


# --------------------------------------------------------------------------------------------
# 서비스
# --------------------------------------------------------------------------------------------

class LiveStateService:
    def __init__(self, live: LiveRedis):
        self.live = live

    # ---- 내부 ----
    @staticmethod
    def _check_ok(res: list) -> list:
        if res[0] == "ok":
            return res
        if res[1] in ("no_meta", "not_ready"):
            raise LiveNotReady(res[1])
        raise RuntimeError(f"unexpected redis reply: {res}")

    @staticmethod
    def _check_scope_rev(scope: Scope, current: int) -> None:
        if scope.auth_revision is not None and current > scope.auth_revision:
            raise ScopeStale(scope.auth_revision, current)

    # ---- snapshot ----
    def snapshot(self, session_id: uuid.UUID, scope: Scope, *, request_id: uuid.UUID | None = None,
                 connection_generation: int = 0, now_ms: int | None = None) -> dict[str, Any]:
        """현재 전 상태 + through vector. 단일 Lua 원자 읽기. wire `LiveSnapshot` dict 를 돌려준다."""
        auds = scope.audiences()
        res = self._check_ok(self.live.snapshot_raw(session_id, auds, keys.DOMAINS, True))
        epoch, status, auth_rev, entries = int(res[1]), res[2], int(res[3]), res[5]
        self._check_scope_rev(scope, auth_rev)

        through: list[dict[str, str]] = []
        merged: dict[str, dict[str, tuple[int, dict[str, Any]]]] = {d: {} for d in keys.DOMAINS}
        for aud, dom, seq, flat in entries:
            through.append({"audience": aud, "domain": dom, "seq": _u64(seq)})
            for i in range(0, len(flat), 2):
                ent, raw = flat[i], json.loads(flat[i + 1])
                prev = merged[dom].get(ent)
                if prev is None or raw["v"] >= prev[0]:  # 같은 버전이면 더 나중 audience 가 같은 필드를 표현
                    merged[dom][ent] = (raw["v"], raw)

        out: dict[str, Any] = {
            "protocol_version": PROTOCOL_VERSION, "schema_version": SCHEMA_VERSION,
            "snapshot_id": str(uuid.uuid4()), "request_id": str(request_id or uuid.uuid4()),
            "connection_generation": _u64(connection_generation), "session_id": str(session_id),
            "epoch": _u64(epoch), "audiences": auds, "through": through,
            "server_time_ms": now_ms if now_ms is not None else int(time.time() * 1000),
            "auth_revision": _u64(auth_rev), "terminal": status == "terminal",
        }
        for dom in keys.DOMAINS:
            field = _WIRE_FIELD[dom]
            if dom in keys.SINGLETON_DOMAINS:
                cur = merged[dom].get(keys.SINGLETON_KEY)
                if cur is None or "d" not in cur[1]:
                    if dom == "session":
                        raise SnapshotIncomplete("session 상태 없음")
                    out[field] = {"version": "0", "data": dict(_SINGLETON_DEFAULTS[dom])}
                else:
                    out[field] = {"version": _u64(cur[0]), "data": cur[1]["d"]}
            else:
                entities, tombstones = {}, []
                for ent, (ver, raw) in sorted(merged[dom].items()):
                    if raw.get("x"):
                        tombstones.append({"entity_id": ent, "version": _u64(ver)})
                    else:
                        entities[ent] = {"version": _u64(ver), "data": raw["d"]}
                out[field] = {"entities": entities, "tombstones": tombstones}
        return out

    # ---- heartbeat ----
    def heartbeat(self, session_id: uuid.UUID, scope: Scope, *, now_ms: int | None = None) -> dict[str, Any]:
        auds = scope.audiences()
        res = self._check_ok(self.live.snapshot_raw(session_id, auds, keys.DOMAINS, False))
        epoch, auth_rev, entries = int(res[1]), int(res[3]), res[5]
        self._check_scope_rev(scope, auth_rev)
        through = [{"audience": a, "domain": d, "seq": _u64(s)} for a, d, s, _ in entries]
        return {"protocol_version": PROTOCOL_VERSION, "schema_version": SCHEMA_VERSION,
                "session_id": str(session_id), "epoch": _u64(epoch), "through": through,
                "auth_revision": _u64(auth_rev),
                "server_time_ms": now_ms if now_ms is not None else int(time.time() * 1000)}

    # ---- replay ----
    def replay(self, session_id: uuid.UUID, scope: Scope, cursors: list[Cursor], *,
               expected_epoch: int | None = None) -> ReplayResult:
        """cursor 이후 event. epoch 불일치·cursor 앞섬·log 절단은 ReplayUnavailable(→ 새 snapshot)."""
        allowed = set(scope.audiences())
        for c in cursors:
            if c.audience not in allowed:
                raise ScopeViolation(f"audience {c.audience} 는 scope 밖")
            if c.domain not in keys.DOMAINS:
                raise ScopeViolation(f"unknown domain {c.domain}")
        res = self.live.replay_raw(session_id, expected_epoch, [(c.audience, c.domain, c.seq) for c in cursors])
        if res[0] == "err":
            if res[1] == "epoch_mismatch":
                raise ReplayUnavailable("epoch_mismatch")
            raise LiveNotReady(res[1])
        epoch, status, auth_rev, entries = int(res[1]), res[2], int(res[3]), res[4]
        self._check_scope_rev(scope, auth_rev)
        events: list[dict[str, Any]] = []
        through: list[Cursor] = []
        for aud, dom, seq, flag, raw_events in entries:
            if flag != "ok":
                raise ReplayUnavailable("cursor_ahead" if flag == "ahead" else "log_truncated")
            through.append(Cursor(aud, dom, int(seq)))
            for entry_id, flat in raw_events:
                f = {flat[i]: flat[i + 1] for i in range(0, len(flat), 2)}
                events.append(self._wire_event(session_id, epoch, aud, dom, int(entry_id.split("-")[0]), f))
        return ReplayResult(epoch=epoch, auth_revision=auth_rev, terminal=status == "terminal", events=events,
                            through=through)

    @staticmethod
    def _wire_event(session_id: uuid.UUID, epoch: int, aud: str, dom: str, seq: int,
                    f: dict[str, str]) -> dict[str, Any]:
        ev: dict[str, Any] = {
            "protocol_version": PROTOCOL_VERSION, "schema_version": SCHEMA_VERSION, "event_id": f["event_id"],
            "session_id": str(session_id), "epoch": _u64(epoch), "audience": aud, "domain": dom,
            "seq": _u64(seq), "entity_id": f["entity_id"] or str(session_id),
            "entity_version": _u64(f["entity_version"]), "kind": f["kind"], "observed_at_ms": None,
            "received_at_server_ms": int(f["at"]), "payload": json.loads(f["payload"]),
        }
        if f.get("command_id"):
            ev["command_id"] = f["command_id"]
        return ev
