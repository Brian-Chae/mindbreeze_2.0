"""SDD-246 T10 — v1(구 REST·소켓) → v2 LiveCommand 호환 어댑터.

원칙
- 구 호출의 부작용은 오직 T03 `apply_command` 한 경로로만 일어난다(이 모듈은 별도 업무 쓰기를 하지 않는다).
- 응답만 구 형식으로 변환한다. 변환에 필요한 현재 상태는 commit 이후 DB 에서 읽는다(추측·fake 값 금지).
- v1 은 expected_epoch / client_generation / expected_entity_version / expected_grant_version / expected_revision /
  checkin_revision 을 알 수 없다. 이 값들을 만들어 채우지 않는다(= 무조건부 명령). 가짜 최신성 금지.
- 회차 protocol(v1/v2) 은 회차에 한 번 고정한다(변경 API 없음). 영속은 T03 ledger 의 시스템 행(kind=protocol.pin)이며
  회차 epoch 락 아래 first-writer-wins 다. (전용 컬럼은 소유권 밖 변경 요청 — progress/t10.md)
- T05 는 엔드포인트/소켓 핸들러에서 `execute_v1` / `admit_client` 만 호출한다. 이 모듈은 라우터를 건드리지 않는다.
"""

from __future__ import annotations

import math
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, Mapping

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DBSession

from app.models.live_state import LiveCommandLedger, LiveOutbox, LiveSessionEpoch
from app.models.session import Session as SessionModel, SessionParticipant
from app.services.session_live_commands import Actor, DurableResult, LiveCommand, apply_command
from app.services.session_live_ledger import (
    SYSTEM_ACTOR_ID,
    canonical_body_hash,
    find_entry,
    insert_entry,
    lock_epoch,
)

PROTOCOL_V1 = 1
PROTOCOL_V2 = 2
PIN_KIND = "protocol.pin"
ORIGIN_LEGACY_UNKNOWN = "legacy_unknown"  # 이 기능 도입 전부터 있던 회차(또는 pin 없이 구 경로로 첫 접촉)
ORIGIN_NEW_RUN = "new_run"  # 생성 시점에 고정된 회차

# 구 HTTP 클라이언트는 idempotency key 가 없다. 직전 같은 요청이 이 시간 안이면 재시도로 본다.
LEGACY_RETRY_WINDOW_SECONDS = 30

_NS_COMMAND = uuid.UUID("0c1c3a52-2460-4d1e-9e0a-7a9b2c5e1001")
_NS_PIN = uuid.UUID("0c1c3a52-2460-4d1e-9e0a-7a9b2c5e1002")

AUDIO_MAX_MS = 24 * 3600 * 1000
ALLOWED_SIGNALS = frozenset({"following", "difficult", "resting"})
TRANSITIONS = {"open": "session.open", "start": "session.start", "end": "session.end", "cancel": "session.cancel"}


# ---------------------------------------------------------------------------
# 오류
# ---------------------------------------------------------------------------

class LegacyError(Exception):
    """구 형식 오류. T05 는 `HTTPException(e.status_code, e.detail)` 로 옮긴다(소켓은 {"ok": False, "error": detail})."""

    def __init__(self, status_code: int, detail: str, *, code: str):
        super().__init__(detail)
        self.status_code, self.detail, self.code = status_code, detail, code


class UnsupportedLegacyOp(LegacyError):
    def __init__(self, op: str, why: str):
        super().__init__(400, f"command 로 변환할 수 없는 호출입니다: {op}", code="unsupported_legacy_op")
        self.why = why


_ERROR_MAP: dict[str, tuple[int, str]] = {
    "forbidden": (403, "권한이 없습니다"),
    "session_ended": (400, "종료된 세션입니다"),
    "participant_not_found": (404, "참여자를 찾을 수 없습니다"),
    "participant_waitlisted": (403, "대기 중인 참여자는 손을 들 수 없습니다"),
    "idempotency_conflict": (409, "같은 요청 식별자로 다른 내용이 전송되었습니다"),
    "entity_version_conflict": (409, "상태가 이미 변경되었습니다"),
    "session_not_found": (404, "세션을 찾을 수 없습니다"),
    "handler_not_registered": (503, "일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요"),
    "unknown_kind": (400, "지원하지 않는 요청입니다"),
    "upgrade_required": (426, "앱 또는 웹을 최신 버전으로 업데이트해 주세요"),
}


def map_error(code: str | None) -> LegacyError:
    status, detail = _ERROR_MAP.get(code or "", (400, "요청을 처리할 수 없습니다"))
    return LegacyError(status, detail, code=code or "rejected")


# ---------------------------------------------------------------------------
# 회차 protocol 고정
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ProtocolPin:
    session_id: uuid.UUID
    protocol: int
    origin: str  # new_run | legacy_unknown

    @property
    def legacy_unknown(self) -> bool:
        return self.origin == ORIGIN_LEGACY_UNKNOWN


def _pin_id(session_id: uuid.UUID) -> uuid.UUID:
    return uuid.uuid5(_NS_PIN, str(session_id))


def _pin_from_entry(session_id: uuid.UUID, entry: LiveCommandLedger) -> ProtocolPin:
    res = dict(entry.result or {})
    return ProtocolPin(session_id=session_id, protocol=int(res["protocol"]), origin=str(res.get("origin", ORIGIN_LEGACY_UNKNOWN)))


def get_session_protocol(db: DBSession, session_id: uuid.UUID) -> ProtocolPin | None:
    """읽기 전용. pin 이 없으면 None(= 구 회차, 아직 접촉 전)."""
    entry = find_entry(db, session_id, SYSTEM_ACTOR_ID, _pin_id(session_id))
    return None if entry is None else _pin_from_entry(session_id, entry)


def pin_session_protocol(db: DBSession, session_id: uuid.UUID, *, protocol: int | None = None,
                         commit: bool = True) -> ProtocolPin:
    """회차 protocol 을 고정한다. 이미 고정돼 있으면 **어떤 인자를 주어도 바꾸지 않고** 기존 값을 돌려준다.

    protocol=None  → 구 회차 첫 접촉: v1 / origin=legacy_unknown
    protocol=1|2   → 회차 생성 시점(T05 의 create/new-run)에서 호출. origin=new_run
    """
    if protocol not in (None, PROTOCOL_V1, PROTOCOL_V2):
        raise ValueError(f"unknown protocol: {protocol}")
    lock_epoch(db, session_id)  # 회차 직렬화 락 아래에서 first-writer-wins
    existing = find_entry(db, session_id, SYSTEM_ACTOR_ID, _pin_id(session_id))
    if existing is not None:
        pin = _pin_from_entry(session_id, existing)
        if commit:
            db.rollback()
        return pin
    chosen = PROTOCOL_V1 if protocol is None else protocol
    origin = ORIGIN_LEGACY_UNKNOWN if protocol is None else ORIGIN_NEW_RUN
    epoch_row = db.execute(select(LiveSessionEpoch).where(LiveSessionEpoch.session_id == session_id)).scalar_one()
    insert_entry(db, session_id=session_id, actor_id=SYSTEM_ACTOR_ID, command_id=_pin_id(session_id), kind=PIN_KIND,
                 body_hash=canonical_body_hash(session_id=session_id, kind=PIN_KIND, target_id=None,
                                               expected_entity_version=None, payload={}),
                 status="applied", code=None, epoch=int(epoch_row.epoch), revision=int(epoch_row.revision),
                 entity_version=None, result={"protocol": chosen, "origin": origin})
    if commit:
        db.commit()
    return ProtocolPin(session_id=session_id, protocol=chosen, origin=origin)


def pin_new_run_if_enabled(db: DBSession, session_id: uuid.UUID) -> None:
    """회차 생성 시점 v2 고정 — 모든 생성 경로(단건·클래스 회차·복제·반복 생성)가 공유한다.

    플래그 off 면 아무것도 하지 않는다. 호출자의 트랜잭션 안에서 실행되므로 commit/rollback 하지 않는다
    (생성과 pin 이 같이 commit 되거나 같이 사라진다). PostgreSQL 이 아니면(시험용 SQLite) 건너뛴다.
    """
    from app.schemas.session_live_v2 import live_protocol_v2_enabled

    if not live_protocol_v2_enabled() or db.get_bind().dialect.name != "postgresql":
        return
    pin_session_protocol(db, uuid.UUID(str(session_id)), protocol=PROTOCOL_V2, commit=False)


# ---------------------------------------------------------------------------
# 클라이언트 capability 입장 규칙
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ClientHello:
    """live:hello 의 서버 내부 표현. 구 클라이언트는 hello 가 없으므로 None 을 넘긴다."""

    supported_protocol_versions: frozenset[int]
    capabilities: frozenset[str] = frozenset()

    @staticmethod
    def from_wire(msg: Mapping[str, Any] | None) -> "ClientHello | None":
        if not msg:
            return None
        versions = msg.get("supported_protocol_versions") or ([msg["protocol_version"]] if "protocol_version" in msg else [])
        return ClientHello(frozenset(int(v) for v in versions), frozenset(str(c) for c in (msg.get("capabilities") or [])))


# 흐름별 필수 capability. 입장/관람/손들기는 protocol 2 지원만 있으면 된다(밴드 미착용·BLE 없음이 이유가 되면 안 된다).
FLOW_REQUIRED_CAPABILITIES: dict[str, frozenset[str]] = {
    "entry": frozenset(),
    "capture": frozenset({"ble_capture"}),
}


@dataclass(frozen=True)
class Admission:
    action: str  # allow | upgrade_required
    effective_protocol: int  # 이 연결이 이 회차에서 쓸 protocol(회차 pin 과 항상 같다 — 전환 없음)
    http_status: int = 200
    code: str | None = None
    message: str | None = None  # 사용자에게 보여줄 한국어 안내
    capture_available: bool = True  # False 여도 입장은 허용(측정만 없음)
    missing_capabilities: tuple[str, ...] = ()
    notice: str | None = None  # 진행 중 v1 회차를 쓰는 신규 클라이언트에 대한 안내(재로드는 다음 회차)


def admit_client(pin: ProtocolPin, hello: ClientHello | None, *, flow: str = "entry") -> Admission:
    """회차 pin 과 클라이언트 능력으로 입장 여부를 정한다. 회차 도중 protocol 을 바꾸지 않는다.

    - v1 회차: 누구든 v1 로 입장(신규 웹도 진행 중 회차는 v1 유지, 다음 회차부터 v2 안내).
    - v2 회차: protocol 2 를 지원하지 않는 클라이언트(구 앱·hello 없음)는 입장 보류 + 업데이트 안내(426).
    - v2 회차 + 흐름 필수 capability 부족: 입장은 허용, 해당 흐름(측정)만 capture_available=False.
    """
    required = FLOW_REQUIRED_CAPABILITIES.get(flow)
    if required is None:
        raise ValueError(f"unknown flow: {flow}")
    if pin.protocol == PROTOCOL_V1:
        reloadable = hello is not None and PROTOCOL_V2 in hello.supported_protocol_versions
        return Admission(action="allow", effective_protocol=PROTOCOL_V1,
                         notice="진행 중인 수업은 기존 방식으로 유지됩니다. 새 버전은 다음 수업부터 적용됩니다." if reloadable else None)
    if hello is None or PROTOCOL_V2 not in hello.supported_protocol_versions:
        return Admission(action="upgrade_required", effective_protocol=PROTOCOL_V2, http_status=426, code="upgrade_required",
                         message=_ERROR_MAP["upgrade_required"][1])
    missing = tuple(sorted(required - hello.capabilities))
    return Admission(action="allow", effective_protocol=PROTOCOL_V2, capture_available=not missing, missing_capabilities=missing)


# ---------------------------------------------------------------------------
# 구 호출 → LiveCommand 정규화 (순수 함수)
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class LegacyCall:
    kind: str
    target_id: str | None
    payload: dict[str, Any]
    op: str
    # command 본문에 못 담는 구 호출 부가정보(예: 리마인드 대상 목록). T05 가 구 소켓 emit 에 쓴다.
    extra: dict[str, Any] = field(default_factory=dict)


def _is_host(actor: Actor) -> bool:
    return actor.role in ("host", "system")


def _pid(params: Mapping[str, Any]) -> str:
    raw = params.get("participant_id")
    try:
        return str(uuid.UUID(str(raw)))
    except (ValueError, TypeError):
        raise LegacyError(404, "참여자를 찾을 수 없습니다", code="participant_not_found") from None


def _audio_ms(sec: Any) -> int:
    if isinstance(sec, bool) or not isinstance(sec, (int, float)) or not math.isfinite(sec):
        raise LegacyError(400, "재생 위치가 올바르지 않습니다", code="invalid_position")
    return min(max(int(math.floor(sec * 1000 + 0.5)), 0), AUDIO_MAX_MS)


def normalize(op: str, actor: Actor, params: Mapping[str, Any] | None = None) -> LegacyCall:
    """구 REST/소켓 호출 하나를 v2 command 본문(kind/target/payload)으로 바꾼다. DB 접근 없음."""
    p = params or {}
    if op == "raise_hand":
        pid = _pid(p)
        return LegacyCall("hand.set", pid, {"raised": True}, op)
    if op == "lower_hand":
        pid = _pid(p)
        if _is_host(actor):
            return LegacyCall("hand.lower", pid, {"target_id": pid}, op)
        return LegacyCall("hand.set", pid, {"raised": False}, op)
    if op == "set_speaking":
        pid = _pid(p)
        return LegacyCall("speaking.set", pid, {"target_id": pid, "can_publish": bool(p.get("granted"))}, op)
    if op == "transition":
        action = p.get("action")
        if action not in TRANSITIONS:
            raise UnsupportedLegacyOp(f"transition:{action}", "알 수 없는 전이")
        kind = TRANSITIONS[action]
        payload = {"reason": "legacy_v1"} if action in ("end", "cancel") else {}
        # 일정 겹침 확인 후 재요청(force + 지문)은 REST 어댑터 내부 payload 로만 싣는다(wire 계약 밖, 핸들러가 읽는다).
        if action in ("open", "start") and p.get("force"):
            payload = {"force": True, "confirmed_conflict_fingerprint": p.get("confirmed_conflict_fingerprint")}
        return LegacyCall(kind, None, payload, op)
    if op == "enter":
        return LegacyCall("entry.enter", _pid(p), {}, op)
    if op == "leave":
        pid = _pid(p)
        return LegacyCall("entry.leave", pid, {"target_id": pid}, op)
    if op == "waitlist_cancel":
        return LegacyCall("waitlist.cancel", None, {}, op)
    if op == "chat_enabled":
        return LegacyCall("chat.set_enabled", None, {"enabled": bool(p.get("enabled"))}, op)
    if op == "quiet_signal":
        sig = p.get("signal_type")
        if sig not in ALLOWED_SIGNALS:
            raise LegacyError(400, "신호 유형이 올바르지 않습니다", code="invalid_signal")
        return LegacyCall("signal.send", None, {"signal_type": sig, "target_scope": "host"}, op)
    if op == "waiting_room_remind":
        ids = [str(i) for i in (p.get("participant_ids") or [])]
        # v2 remind 는 대상 범위만 받는다. 구 호출의 명시 대상은 command 본문이 아니라 extra 로 T05 에 돌려준다.
        return LegacyCall("waiting.remind", None, {"target_scope": "not_ready"}, op, extra={"participant_ids": ids})
    if op == "audio_sync":
        action = p.get("action")
        if action not in ("play", "pause", "seek", "stop"):
            raise LegacyError(400, "재생 동작이 올바르지 않습니다", code="invalid_audio_action")
        track = p.get("track_id")
        if track is not None and not isinstance(track, str):
            raise LegacyError(400, "트랙이 올바르지 않습니다", code="invalid_track")
        return LegacyCall("audio.set", None, {"track_id": track, "action": action, "position_ms": _audio_ms(p.get("position_sec", 0))}, op)
    if op in ("features", "feature"):
        raise UnsupportedLegacyOp(op, "측정(metrics) 경로 — T04/T09 ingest. command 가 아니다")
    if op in ("waiting_room", "participation_heartbeat"):
        raise UnsupportedLegacyOp(op, "휘발성 presence 신호 — 상태가 아니므로 command/ledger 대상이 아니다")
    raise UnsupportedLegacyOp(op, "알 수 없는 호출")


# ---------------------------------------------------------------------------
# legacy command_id 정규화(재시도 멱등)
# ---------------------------------------------------------------------------

def derive_command_id(db: DBSession, *, session_id: uuid.UUID, actor: Actor, call: LegacyCall,
                      idempotency_key: str | None = None, now: datetime | None = None,
                      retry_window_s: int = LEGACY_RETRY_WINDOW_SECONDS) -> uuid.UUID:
    """구 호출에 command_id 를 부여한다(읽기 전용).

    1) 클라이언트 key(Idempotency-Key 등)가 있으면 그것으로 결정적 ID — 같은 key 재시도는 같은 ID.
    2) 없으면: 이 actor 의 **가장 최근** ledger 행이 같은 kind·본문이고 retry window 안이면 그 ID 재사용(= ACK 유실 재시도는
       원 결과 재생). 그 사이 다른 명령이 끼었거나 window 를 넘기면 새 ID(손들기→내리기→다시 들기가 막히지 않는다).
    """
    body_hash = canonical_body_hash(session_id=session_id, kind=call.kind, target_id=call.target_id,
                                    expected_entity_version=None, payload=call.payload)
    if idempotency_key:
        return uuid.uuid5(_NS_COMMAND, f"{session_id}|{actor.actor_id}|key|{idempotency_key}")
    now = now or datetime.now(timezone.utc)
    latest = db.execute(
        select(LiveCommandLedger).where(LiveCommandLedger.session_id == session_id,
                                        LiveCommandLedger.actor_id == actor.actor_id,
                                        LiveCommandLedger.kind != PIN_KIND)
        .order_by(LiveCommandLedger.created_at.desc(), LiveCommandLedger.id.desc()).limit(1)
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()
    if (latest is not None and latest.kind == call.kind and latest.body_hash == body_hash
            and now - latest.created_at <= timedelta(seconds=retry_window_s)):
        return latest.command_id
    n = int(db.execute(
        select(func.count()).select_from(LiveCommandLedger).where(
            LiveCommandLedger.session_id == session_id, LiveCommandLedger.actor_id == actor.actor_id,
            LiveCommandLedger.kind == call.kind, LiveCommandLedger.body_hash == body_hash)
    ).scalar_one())
    return uuid.uuid5(_NS_COMMAND, f"{session_id}|{actor.actor_id}|{body_hash}|{n}")


def to_live_command(session_id: uuid.UUID, call: LegacyCall, command_id: uuid.UUID) -> LiveCommand:
    """무조건부 명령: epoch/세대/entity_version 을 만들지 않는다."""
    return LiveCommand(command_id=command_id, session_id=session_id, kind=call.kind, payload=dict(call.payload),
                       expected_epoch=None, target_id=call.target_id, expected_entity_version=None, client_generation=None)


# ---------------------------------------------------------------------------
# 응답 변환 (v2 결과 → 구 형식)
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class LegacyOutcome:
    """T05 가 그대로 반환/송신한다.

    body      : 구 응답 dict. 대형 응답(SessionResponse 등)은 None 이고 refetch 에 종류를 적는다(T05 가 기존 직렬화로 조회).
    refetch   : None | "session" | "chat_room" | "entry"
    duplicate : 재시도로 원 결과를 재생한 경우
    command_id: 로그·추적용
    extra     : normalize 의 부가정보
    """

    body: dict[str, Any] | None
    refetch: str | None
    duplicate: bool
    command_id: uuid.UUID
    kind: str
    extra: dict[str, Any] = field(default_factory=dict)


def _participant_state(db: DBSession, session_id: uuid.UUID, participant_id: str) -> dict[str, Any]:
    from app.services import session_service  # 지연 import: 순환 방지

    s = db.execute(select(SessionModel).where(SessionModel.id == session_id).execution_options(populate_existing=True)).scalar_one()
    part = db.execute(
        select(SessionParticipant).where(SessionParticipant.id == uuid.UUID(participant_id), SessionParticipant.session_id == session_id)
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()
    if part is None:
        raise map_error("participant_not_found")
    return {"participant_id": str(part.id), "raise_hand": bool(part.raise_hand), "speaking": bool(part.speaking),
            "can_publish": bool(session_service._compute_can_publish(s, part))}


def to_legacy_response(db: DBSession, call: LegacyCall, session_id: uuid.UUID, result: DurableResult, *,
                       actor: Actor | None = None) -> LegacyOutcome:
    """DurableResult → 구 응답. 거절은 LegacyError. 상태 값은 commit 후 DB 에서 읽는다."""
    if result.status == "rejected" or result.code is not None:
        raise map_error(result.code)
    base = dict(duplicate=result.duplicate, command_id=result.command_id, kind=call.kind, extra=dict(call.extra))
    k = call.kind
    if k in ("hand.set", "hand.lower", "speaking.set"):
        body = _participant_state(db, session_id, str(call.target_id))
        if k == "hand.set" and call.payload.get("raised") is False:
            body["lowered_by"] = "self"
        elif k == "hand.lower":
            body["lowered_by"] = "host"
        return LegacyOutcome(body=body, refetch=None, **base)
    if k == "waitlist.cancel":
        r = result.result
        pid = str(r.get("participant_id") or (actor.participant_id if actor and actor.participant_id else ""))
        return LegacyOutcome(body={"participant_id": pid, "cancelled": True, "changed": bool(r.get("changed", not result.duplicate))},
                             refetch=None, **base)
    if k.startswith("session."):
        return LegacyOutcome(body=None, refetch="session", **base)
    if k == "chat.set_enabled":
        return LegacyOutcome(body=None, refetch="chat_room", **base)
    if k in ("entry.enter", "entry.leave"):
        return LegacyOutcome(body=None, refetch="entry", **base)
    if k == "waiting.remind":
        return LegacyOutcome(body={"ok": True, "sent": len(call.extra.get("participant_ids", []))}, refetch=None, **base)
    # signal.send / audio.set: 소켓 이벤트는 구 프로토콜에서 응답이 없다
    return LegacyOutcome(body=None, refetch=None, **base)


# ---------------------------------------------------------------------------
# T05 가 호출하는 단일 진입점
# ---------------------------------------------------------------------------

def execute_v1(db: DBSession, actor: Actor, op: str, session_id: uuid.UUID, params: Mapping[str, Any] | None = None, *,
               idempotency_key: str | None = None, now: datetime | None = None,
               hello: ClientHello | None = None, flow: str = "entry") -> LegacyOutcome:
    """구 호출 한 건을 처리한다. 부작용은 apply_command 한 번뿐.

    v2 회차에 구 클라이언트(hello 없음/ v2 미지원)가 오면 부작용 없이 426(LegacyError) 로 입장·조작을 보류한다.
    """
    call = normalize(op, actor, params)  # 변환 불가/입력 오류는 DB 접근 전에 거절
    if db.execute(select(SessionModel.id).where(SessionModel.id == session_id)).first() is None:
        raise map_error("session_not_found")
    pin = pin_session_protocol(db, session_id)  # 기존 pin 유지, 없으면 legacy_unknown v1
    adm = admit_client(pin, hello, flow=flow)
    if adm.action != "allow":
        raise LegacyError(adm.http_status, adm.message or "업데이트가 필요합니다", code=adm.code or "upgrade_required")
    command_id = derive_command_id(db, session_id=session_id, actor=actor, call=call, idempotency_key=idempotency_key, now=now)
    result = apply_command(db, actor, to_legacy_command(session_id, call, command_id), now=now)
    return to_legacy_response(db, call, session_id, result, actor=actor)


to_legacy_command = to_live_command


# ---------------------------------------------------------------------------
# 구행 legacy_unknown 메타 · seq 없는 최신성 금지
# ---------------------------------------------------------------------------

def legacy_unknown_meta() -> dict[str, Any]:
    """기존 scalar/manifest/raw 행을 v2 reader 가 해석할 때 붙이는 메타. device time/seq 를 만들어 채우지 않는다."""
    return {"provenance": ORIGIN_LEGACY_UNKNOWN, "device_time_us": None, "sequence": None, "cursor": None, "freshness": "unknown"}


def annotate_legacy_rows(rows: Iterable[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """원본 행을 복사해 `_meta` 만 추가한다(원본 필드·값 변경 0, 입력 불변). 행에 seq 류 값이 있어도 meta 에 옮기지 않는다."""
    out: list[dict[str, Any]] = []
    for row in rows:
        copy = dict(row)
        copy["_meta"] = legacy_unknown_meta()
        out.append(copy)
    return out


def legacy_snapshot_cursor(pin: ProtocolPin | None) -> dict[str, Any] | None:
    """v1/미고정 회차에는 domain seq 가 없다 → None. 가짜 cursor 를 만들지 않는다."""
    if pin is None or pin.protocol == PROTOCOL_V1:
        return None
    raise ValueError("v2 회차의 cursor 는 T04 snapshot 이 만든다(이 어댑터 소관 아님)")


# ---------------------------------------------------------------------------
# shadow 비교 (읽기 전용)
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ShadowReport:
    match: bool
    diffs: dict[str, tuple[Any, Any]]  # key -> (legacy 값, v2 쪽 값)
    pin: ProtocolPin | None
    v2_revision: int | None


def shadow_compare_participant(db: DBSession, session_id: uuid.UUID, participant_id: uuid.UUID,
                               legacy_body: Mapping[str, Any]) -> ShadowReport:
    """구 응답 body 와 현재 저장 상태를 비교한다. SELECT 만 수행한다(쓰기·락·flush 없음)."""
    pin = get_session_protocol(db, session_id)
    rev = db.execute(select(LiveSessionEpoch.revision).where(LiveSessionEpoch.session_id == session_id)).scalar_one_or_none()
    part = db.execute(
        select(SessionParticipant).where(SessionParticipant.id == participant_id, SessionParticipant.session_id == session_id)
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()
    diffs: dict[str, tuple[Any, Any]] = {}
    if part is None:
        diffs["participant"] = (legacy_body.get("participant_id"), None)
    else:
        for key in ("raise_hand", "speaking"):
            if key in legacy_body and bool(legacy_body[key]) != bool(getattr(part, key)):
                diffs[key] = (legacy_body[key], bool(getattr(part, key)))
    return ShadowReport(match=not diffs, diffs=diffs, pin=pin, v2_revision=None if rev is None else int(rev))
