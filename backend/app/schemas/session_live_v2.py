"""SDD-246 T05 — Socket.IO/REST v2 wire 검증·ACK 매핑 (순수 함수, DB·Redis 접근 없음).

계약 정본은 `contracts/session-live-v2/schema/*.json` 이다. 이 모듈은 서버가 받는 입력을 같은 규칙으로 좁게 검증한다
(unknown 필드·kind 거절, u64 는 십진 문자열). 권한 판정은 여기서 하지 않는다(인증 문맥에서 서버가 확정).
"""

from __future__ import annotations

import os
import re
import uuid
from dataclasses import dataclass
from typing import Any, Mapping

from app.services.session_live_commands import ALL_KINDS, LiveCommand
from app.services.session_live_ledger import DurableResult
from app.services.session_live_legacy import ClientHello

PROTOCOL_VERSION = 2
SCHEMA_VERSION = 1

_UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
_U64_RE = re.compile(r"^(0|[1-9][0-9]{0,19})$")
_U64_MAX = (1 << 64) - 1
_CAPS = frozenset({"native_background", "wasm_core", "ble_capture", "paint_ack", "http_fallback"})

# 서버가 광고하는 capability (hello 응답)
SERVER_CAPABILITIES = ("http_fallback", "paint_ack")


def live_protocol_v2_enabled() -> bool:
    """기능 플래그 `live_protocol_v2` (기본 off). off 면 v1 동작과 동일해야 한다(회귀 0).

    환경변수 LIVE_PROTOCOL_V2 가 우선, 없으면 settings.live_protocol_v2(필드가 생기면)를 본다. 호출 시점마다 읽는다.
    """
    raw = os.environ.get("LIVE_PROTOCOL_V2")
    if raw is None:
        from app.config import settings

        raw = getattr(settings, "live_protocol_v2", False)
    return str(raw).strip().lower() in ("1", "true", "yes", "on")


class WireError(Exception):
    """입력이 계약 위반. code 는 ReasonCode(snake_case)."""

    def __init__(self, code: str, field: str | None = None):
        super().__init__(code if field is None else f"{code}:{field}")
        self.code, self.field = code, field


# kind → (필수 payload 키, 허용 payload 키). contracts/session-live-v2/schema/command.schema.json 과 동일(시험이 대조).
_NONE: tuple[frozenset, frozenset] = (frozenset(), frozenset())
KIND_PAYLOAD: dict[str, tuple[frozenset, frozenset]] = {
    "entry.enter": _NONE,
    "entry.leave": (frozenset({"target_id"}), frozenset({"target_id"})),
    "waiting.set_ready": (frozenset({"ready", "checkin_revision"}), frozenset({"ready", "checkin_revision"})),
    "session.open": _NONE,
    "session.start": _NONE,
    "session.end": (frozenset({"reason"}), frozenset({"reason"})),
    "session.cancel": (frozenset({"reason"}), frozenset({"reason"})),
    "waiting.remind": (frozenset({"target_scope"}), frozenset({"target_scope"})),
    "waitlist.cancel": _NONE,
    "waitlist.promote": (frozenset({"target_id"}), frozenset({"target_id"})),
    "hand.set": (frozenset({"raised"}), frozenset({"raised"})),
    "hand.lower": (frozenset({"target_id"}), frozenset({"target_id"})),
    "speaking.set": (frozenset({"target_id", "can_publish", "expected_grant_version"}),
                     frozenset({"target_id", "can_publish", "expected_grant_version"})),
    "signal.send": (frozenset({"signal_type", "target_scope"}), frozenset({"signal_type", "target_scope", "ttl_ms"})),
    "signal.clear": (frozenset({"signal_id"}), frozenset({"signal_id"})),
    "audio.set": (frozenset({"track_id", "action", "position_ms", "expected_revision"}),
                  frozenset({"track_id", "action", "position_ms", "expected_revision"})),
    "chat.set_enabled": (frozenset({"enabled"}), frozenset({"enabled"})),
    "capture.start": (frozenset({"device_profile", "algorithm_version", "model_version"}),
                      frozenset({"device_profile", "algorithm_version", "model_version"})),
    "capture.close": (frozenset({"stream_id", "final_sequences", "reason"}),
                      frozenset({"stream_id", "final_sequences", "reason"})),
    "capture.renew": (frozenset({"stream_id", "owner_generation", "clock_anchor_id"}),
                      frozenset({"stream_id", "owner_generation", "clock_anchor_id"})),
    "capture.reanchor": (frozenset({"stream_id", "clock_probe_id", "device_ticks", "monotonic_us"}),
                         frozenset({"stream_id", "clock_probe_id", "device_ticks", "monotonic_us"})),
}
assert set(KIND_PAYLOAD) == set(ALL_KINDS), "KIND_PAYLOAD 와 T03 ALL_KINDS 가 어긋났다"

_ENVELOPE_REQUIRED = ("protocol_version", "schema_version", "command_id", "session_id", "expected_epoch", "kind",
                      "client_generation", "payload")
_ENVELOPE_ALLOWED = frozenset(_ENVELOPE_REQUIRED) | {"target_id", "expected_entity_version"}


def is_uuid(value: Any) -> bool:
    return isinstance(value, str) and bool(_UUID_RE.match(value))


def parse_u64(value: Any, field: str) -> int:
    if not isinstance(value, str) or not _U64_RE.match(value) or int(value) > _U64_MAX:
        raise WireError("invalid_u64", field)
    return int(value)


def _require_dict(raw: Any) -> Mapping[str, Any]:
    if not isinstance(raw, Mapping):
        raise WireError("invalid_message")
    return raw


def _check_versions(raw: Mapping[str, Any]) -> None:
    pv = raw.get("protocol_version")
    if pv != PROTOCOL_VERSION or isinstance(pv, bool):
        raise WireError("upgrade_required", "protocol_version")
    if raw.get("schema_version") != SCHEMA_VERSION or isinstance(raw.get("schema_version"), bool):
        raise WireError("upgrade_required", "schema_version")


def parse_hello(raw: Any) -> ClientHello:
    raw = _require_dict(raw)
    _check_versions(raw)
    versions = raw.get("supported_protocol_versions")
    if not isinstance(versions, list) or not versions or not all(isinstance(v, int) and not isinstance(v, bool) for v in versions):
        raise WireError("invalid_message", "supported_protocol_versions")
    caps = raw.get("capabilities")
    if not isinstance(caps, list) or not all(isinstance(c, str) for c in caps) or not set(caps) <= _CAPS:
        raise WireError("invalid_message", "capabilities")
    if not is_uuid(raw.get("client_instance_id")):
        raise WireError("invalid_message", "client_instance_id")
    return ClientHello(frozenset(versions), frozenset(caps))


@dataclass(frozen=True)
class JoinRequest:
    session_id: uuid.UUID
    request_id: uuid.UUID
    generation: int
    last_cursors: tuple[tuple[str, str, int], ...]
    entry_credential: str | None


def parse_join(raw: Any) -> JoinRequest:
    raw = _require_dict(raw)
    _check_versions(raw)
    for f in ("session_id", "request_id"):
        if not is_uuid(raw.get(f)):
            raise WireError("invalid_message", f)
    cursors = raw.get("last_cursors", [])
    if not isinstance(cursors, list) or len(cursors) > 200:
        raise WireError("invalid_message", "last_cursors")
    parsed = []
    for c in cursors:
        if not isinstance(c, Mapping):
            raise WireError("invalid_message", "last_cursors")
        parsed.append((str(c.get("audience")), str(c.get("domain")), parse_u64(c.get("seq"), "last_cursors.seq")))
    cred = raw.get("entry_credential")
    if cred is not None and not isinstance(cred, str):
        raise WireError("invalid_message", "entry_credential")
    return JoinRequest(uuid.UUID(raw["session_id"]), uuid.UUID(raw["request_id"]), parse_u64(raw.get("generation", "0"), "generation"),
                       tuple(parsed), cred)


def parse_command(raw: Any) -> LiveCommand:
    """LiveCommand envelope + kind 별 payload 를 좁게 검증한다. 위반은 WireError."""
    raw = _require_dict(raw)
    extra = set(raw) - _ENVELOPE_ALLOWED
    if extra:
        raise WireError("unknown_field", sorted(extra)[0])
    missing = [f for f in _ENVELOPE_REQUIRED if f not in raw]
    if missing:
        raise WireError("missing_field", missing[0])
    _check_versions(raw)
    kind = raw["kind"]
    if kind not in KIND_PAYLOAD:
        raise WireError("unknown_kind", "kind")
    for f in ("command_id", "session_id"):
        if not is_uuid(raw[f]):
            raise WireError("invalid_message", f)
    payload = raw["payload"]
    if not isinstance(payload, Mapping):
        raise WireError("invalid_message", "payload")
    required, allowed = KIND_PAYLOAD[kind]
    unknown = set(payload) - allowed
    if unknown:
        raise WireError("unknown_field", f"payload.{sorted(unknown)[0]}")
    absent = required - set(payload)
    if absent:
        raise WireError("missing_field", f"payload.{sorted(absent)[0]}")
    target = raw.get("target_id")
    if target is not None and not is_uuid(target):
        raise WireError("invalid_message", "target_id")
    ev = raw.get("expected_entity_version")
    return LiveCommand(
        command_id=uuid.UUID(raw["command_id"]), session_id=uuid.UUID(raw["session_id"]), kind=kind,
        payload=dict(payload), expected_epoch=parse_u64(raw["expected_epoch"], "expected_epoch"), target_id=target,
        expected_entity_version=None if ev is None else parse_u64(ev, "expected_entity_version"),
        client_generation=parse_u64(raw["client_generation"], "client_generation"),
    )


# ---------------------------------------------------------------------------
# ACK 매핑 (T03 DurableResult → wire CommandAck)
# ---------------------------------------------------------------------------

def ack_from_result(result: DurableResult, cursors: list[dict[str, str]] | None = None) -> dict[str, Any]:
    """`applied`=DB commit(+projection 은 호출자가 drain 한 뒤에만 이 함수를 쓴다). 일시 거절은 ledger 에 없으므로 committed=False."""
    cur = list(cursors or [])
    if result.status == "applied":
        ack: dict[str, Any] = {"command_id": str(result.command_id), "status": "duplicate" if result.duplicate else "applied",
                               "epoch": str(result.epoch), "cursors": cur, "committed": True}
    elif result.transient and result.code in ("epoch_mismatch",):
        ack = {"command_id": str(result.command_id), "status": "retryable", "epoch": str(result.epoch), "cursors": cur,
               "committed": False, "code": result.code, "retry_after_ms": 0}
    else:
        ack = {"command_id": str(result.command_id), "status": "rejected", "epoch": str(result.epoch), "cursors": cur,
               "committed": bool(result.committed), "code": result.code or "rejected"}
    if result.entity_version is not None:
        ack["entity_version"] = str(result.entity_version)
    return ack


def error_ack(command_id: str | None, code: str, *, status: str = "rejected", epoch: int | str = 0,
              retry_after_ms: int | None = None, committed: bool = False) -> dict[str, Any]:
    """명령이 commit 되기 전에 거절/보류된 경우(검증·상태·인증). 부작용 0."""
    ack: dict[str, Any] = {"command_id": command_id or str(uuid.UUID(int=0)), "status": status, "epoch": str(epoch),
                           "cursors": [], "committed": committed, "code": code}
    if status == "retryable":
        ack["retry_after_ms"] = int(retry_after_ms if retry_after_ms is not None else 500)
    return ack


# ---------------------------------------------------------------------------
# 도메인 payload (event/snapshot 이 공유하는 state.schema DTO)
# ---------------------------------------------------------------------------

def _ms(dt: Any) -> int | None:
    return None if dt is None else int(dt.timestamp() * 1000)


_PHASE = {"scheduled": "scheduled", "ready": "scheduled", "open": "open", "in_progress": "in_progress",
          "completed": "ended", "cancelled": "cancelled"}


def session_state_payload(status: str, started_at: Any, ended_at: Any, cutoff_at: Any = None) -> dict[str, Any]:
    """SessionState. 종료/취소는 payload.status 가 completed/cancelled → T04 가 terminal TTL 을 건다."""
    wire_status = status if status in ("in_progress", "completed", "cancelled") else "scheduled"
    return {"phase": _PHASE.get(status, "scheduled"), "status": wire_status, "started_at_ms": _ms(started_at),
            "ended_at_ms": _ms(ended_at), "cutoff_ms": _ms(cutoff_at if cutoff_at is not None else ended_at)}


def policy_payload(chat_enabled: bool) -> dict[str, Any]:
    return {"chat_enabled": bool(chat_enabled),
            "capabilities": ["raise_hand", "send_signal", "share_metrics", "capture_eeg"], "consent_revision": "0"}


def speaking_payload(participant_id: Any, hand_raised: bool, can_publish: bool, grant_version: int) -> dict[str, Any]:
    return {"participant_id": str(participant_id), "hand_raised": bool(hand_raised), "can_publish": bool(can_publish),
            "grant_version": str(int(grant_version))}


def participation_payload(participant_id: Any, attendance: str, connected: bool = False) -> dict[str, Any]:
    return {"participant_id": str(participant_id), "role": "member", "attendance": attendance, "connected": bool(connected)}


def waiting_payload(participant_id: Any, ready: bool, checkin_revision: int, waitlist_position: int | None) -> dict[str, Any]:
    return {"participant_id": str(participant_id), "ready": bool(ready), "checkin_revision": str(int(checkin_revision)),
            "waitlist_position": waitlist_position}


def tombstone_payload(entity_id: Any, version: int) -> dict[str, Any]:
    return {"entity_id": str(entity_id), "version": str(int(version))}
