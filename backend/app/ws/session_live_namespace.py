"""클래스별 뇌파 실시간 Socket.IO 네임스페이스 `/session-live` (SDD-024 · SDD-026)

밴드 착용 참가자의 1초 EEG feature 를 WS 로 받아
  (a) EEGFeatureWindow 저장 (SDD-023 ingestion 로직 재사용, 멱등)
  (b) 세션 룸의 호스트에게 실시간 브로드캐스트
한다. REST 5초 배치(`POST /sessions/{id}/features`)는 폴백/오프라인 큐로 유지된다.

SDD-026 P0 안전망:
- connect: 잘못된 토큰이면 연결 거부(예외 무시 금지).
- join: 신원·참여자 검증 후 role 별 room 분리.
    · 호스트 → 전체 수신 룸 `session:{id}`  (모든 참가자 feature 수신)
    · 게스트/회원 → 본인 전용 룸 `session:{id}:self:{participant_id}`  (본인만)
    · 상태 이벤트 공용 룸 `session:{id}:all`  (호스트+참가자 공통)
  게스트는 전체 수신 룸에 들어가지 못하므로 게스트 간 EEG 가 노출되지 않는다.
- join snapshot: status/state_version/started_at + (호스트)참가자 목록·집계 / (게스트)본인 상태.
- 서버 내부 이벤트: session_state_changed / participant_changed / device_status_changed.

클라이언트→서버: join(session_id[, participant_id]), leave(session_id), feature(data)
서버→클라이언트: joined, join_denied, eeg_feature,
                 session_state_changed, participant_changed, device_status_changed
"""

import asyncio
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

_NAMESPACE = "/session-live"

# sync(REST) 컨텍스트에서 async 브로드캐스트를 예약하기 위한 이벤트 루프 참조.
# connect 핸들러(루프 안에서 실행)에서 캡처한다. 캡처 전(테스트 등)에는 None → 발행 생략.
_loop: asyncio.AbstractEventLoop | None = None


def _get_sio():
    """circular import 회피용 lazy import (app.ws.__init__)"""
    from app.ws import sio
    return sio


def _open_db():
    """WS 핸들러용 DB 세션 팩토리.

    Socket.IO 핸들러는 FastAPI 의존성 주입을 쓸 수 없으므로 SessionLocal 로 직접 연다.
    테스트에서는 이 함수를 monkeypatch 하여 인메모리 세션을 주입한다.
    """
    from app.core.database import SessionLocal
    return SessionLocal()


def _jsonify(value):
    """datetime 등을 JSON 직렬화 가능한 형태로 재귀 변환(WS emit 안전)."""
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, dict):
        return {k: _jsonify(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonify(v) for v in value]
    return value


def _room_all(session_id) -> str:
    """상태 이벤트 공용 룸(호스트+참가자)"""
    return f"session:{session_id}:all"


def _room_host(session_id) -> str:
    """호스트 전체 수신 룸(모든 참가자 EEG)"""
    return f"session:{session_id}"


def _room_self(session_id, participant_id) -> str:
    """참가자 본인 전용 룸"""
    return f"session:{session_id}:self:{participant_id}"


def register_session_live_namespace(sio):
    """app.ws.__init__ 에서 sio 초기화 후 호출하여 `/session-live` 네임스페이스 등록"""

    @sio.event(namespace=_NAMESPACE)
    async def connect(sid, environ, auth):
        # SDD-026: 무토큰은 게스트로 허용하되, 토큰이 있으면 반드시 유효해야 한다.
        # 잘못된 토큰은 예외를 무시하지 않고 연결을 거부(False)한다.
        global _loop
        try:
            _loop = asyncio.get_running_loop()
        except RuntimeError:
            _loop = None

        user_id = None
        token = (auth or {}).get("token")
        if token:
            try:
                from app.core.security import decode_token
                payload = decode_token(token)
                user_id = payload.get("sub")
            except Exception:
                logger.warning("[WS /session-live] 잘못된 토큰 — 연결 거부 (sid=%s)", sid)
                return False
            if not user_id:
                logger.warning("[WS /session-live] 토큰에 sub 없음 — 연결 거부 (sid=%s)", sid)
                return False
            logger.info("[WS /session-live] user %s connected (sid=%s)", user_id, sid)

        await sio.save_session(sid, {"user_id": user_id}, namespace=_NAMESPACE)
        return True

    @sio.event(namespace=_NAMESPACE)
    async def disconnect(sid):
        pass

    @sio.on("join", namespace=_NAMESPACE)
    async def on_join(sid, data):
        data = data or {}
        session_id = data.get("session_id")
        if not session_id:
            return
        participant_id = data.get("participant_id")
        session = await sio.get_session(sid, namespace=_NAMESPACE)
        current_user_id = (session or {}).get("user_id")

        resolved = _resolve_join(session_id, current_user_id, participant_id)
        if resolved is None:
            # SDD-026: 비인가 join — 어떤 room 에도 입장시키지 않고 거부를 통지한다.
            logger.warning("[WS /session-live] join 거부 (sid=%s, session=%s)", sid, session_id)
            await sio.emit(
                "join_denied", {"session_id": str(session_id)}, to=sid, namespace=_NAMESPACE
            )
            return

        role = resolved["role"]
        pid = resolved["participant_id"]
        snapshot = _jsonify(resolved["snapshot"])

        # leave/feature 판정에 쓰도록 세션 컨텍스트 갱신
        await sio.save_session(
            sid,
            {
                "user_id": current_user_id,
                "role": role,
                "participant_id": pid,
                "session_id": str(session_id),
            },
            namespace=_NAMESPACE,
        )

        # 상태 이벤트 공용 룸(호스트+참가자)
        await sio.enter_room(sid, _room_all(session_id), namespace=_NAMESPACE)
        if role == "host":
            await sio.enter_room(sid, _room_host(session_id), namespace=_NAMESPACE)
        else:
            await sio.enter_room(sid, _room_self(session_id, pid), namespace=_NAMESPACE)

        logger.info("[WS /session-live] sid=%s joined session=%s as %s", sid, session_id, role)
        await sio.emit(
            "joined",
            {
                "session_id": str(session_id),
                "role": role,
                "participant_id": pid,
                "snapshot": snapshot,
            },
            to=sid,
            namespace=_NAMESPACE,
        )

    @sio.on("leave", namespace=_NAMESPACE)
    async def on_leave(sid, data):
        data = data or {}
        session_id = data.get("session_id")
        if not session_id:
            return
        session = await sio.get_session(sid, namespace=_NAMESPACE)
        pid = (session or {}).get("participant_id")
        # 입장했을 수 있는 모든 룸에서 퇴장(멱등 — 없으면 무시)
        await sio.leave_room(sid, _room_host(session_id), namespace=_NAMESPACE)
        await sio.leave_room(sid, _room_all(session_id), namespace=_NAMESPACE)
        if pid:
            await sio.leave_room(sid, _room_self(session_id, pid), namespace=_NAMESPACE)
        logger.info("[WS /session-live] sid=%s left session=%s", sid, session_id)

    @sio.on("feature", namespace=_NAMESPACE)
    async def on_feature(sid, data):
        """참가자가 보낸 1초 EEG feature → 저장 + 호스트 룸 브로드캐스트.

        data = {
            "session_id": str,
            "participant_id": str | None,   # 게스트 식별 (로그인 참가자는 connect 토큰의 user_id 사용)
            "feature": { second_offset, delta_power, ..., signal_quality, play_group_id, band_battery }
        }
        """
        data = data or {}
        session_id = data.get("session_id")
        feature = data.get("feature")
        if not session_id or not feature:
            return
        participant_id = data.get("participant_id")
        session = await sio.get_session(sid, namespace=_NAMESPACE)
        current_user_id = (session or {}).get("user_id")

        try:
            saved, resolved_participant_id, feature_out = _store_feature(
                session_id, participant_id, current_user_id, feature
            )
        except Exception:
            # 비참가자/미식별/대리 업로드/미동의 등 저장 실패 시 브로드캐스트하지 않는다
            logger.warning("[WS /session-live] feature 저장 실패 (sid=%s, session=%s)", sid, session_id)
            return

        # SDD-026: 전체 참가자 EEG 는 호스트 전체 수신 룸으로만 브로드캐스트한다.
        # 게스트는 이 룸에 없으므로 타 참가자 EEG 가 노출되지 않는다(게스트 간 비노출).
        await broadcast_session_eeg(
            session_id,
            {
                "participant_id": resolved_participant_id,
                "feature": feature_out,
                "saved": saved,
            },
        )

    logger.info("[WS /session-live] namespace registered")


def _resolve_join(session_id, current_user_id, participant_id):
    """join 권한 판정을 서비스 레이어에 위임(전용 DB 세션)."""
    from app.services import session_service

    db = _open_db()
    try:
        return session_service.resolve_live_join(session_id, current_user_id, participant_id, db)
    finally:
        db.close()


def _store_feature(session_id, participant_id, current_user_id, feature):
    """단일 EEG feature 를 검증·저장한다(SDD-023 ingestion 로직 재사용).

    반환: (saved_count, resolved_participant_id(str), normalized_feature(dict))
    """
    from app.models.session import Session
    from app.schemas.session import EEGFeatureItem
    from app.services import session_service

    item = EEGFeatureItem.model_validate(feature)
    db = _open_db()
    try:
        sid = session_service._to_uuid(session_id)
        s = db.query(Session).filter(Session.id == sid).first()
        if not s:
            raise ValueError("세션을 찾을 수 없습니다")
        participant = session_service.resolve_upload_participant(sid, participant_id, current_user_id, db)
        saved = session_service.persist_feature_windows(sid, participant, [item], db)
        return saved, str(participant.id), item.model_dump()
    finally:
        db.close()


# ---------------------------------------------------------------------------
# 서버 내부 브로드캐스트 헬퍼 (다른 모듈에서도 호출 가능)
# ---------------------------------------------------------------------------


async def broadcast_session_eeg(session_id: str, feature: dict) -> None:
    """세션의 호스트 전체 수신 룸에 실시간 EEG feature 를 브로드캐스트한다.

    Args:
        session_id: 세션 UUID(str)
        feature: 브로드캐스트 payload (participant_id, feature, saved 등)
    """
    sio = _get_sio()
    room = _room_host(session_id)
    payload = {"session_id": str(session_id), **feature}
    await sio.emit("eeg_feature", payload, room=room, namespace=_NAMESPACE)
    logger.info("[WS /session-live] broadcast eeg_feature → %s", room)


async def broadcast_session_state(session_id: str, payload: dict) -> None:
    """세션 상태 변경(start/pause/resume/end/cancel)을 공용 룸에 브로드캐스트한다."""
    sio = _get_sio()
    room = _room_all(session_id)
    await sio.emit(
        "session_state_changed",
        {"session_id": str(session_id), **payload},
        room=room,
        namespace=_NAMESPACE,
    )
    logger.info("[WS /session-live] broadcast session_state_changed → %s", room)


async def broadcast_participant(session_id: str, payload: dict) -> None:
    """참가자 구성 변경(입장/퇴장/대기열)을 호스트 전체 수신 룸에 브로드캐스트한다."""
    sio = _get_sio()
    room = _room_host(session_id)
    await sio.emit(
        "participant_changed",
        {"session_id": str(session_id), **payload},
        room=room,
        namespace=_NAMESPACE,
    )
    logger.info("[WS /session-live] broadcast participant_changed → %s", room)


async def broadcast_device_status(session_id: str, payload: dict) -> None:
    """기기 상태 변경(연결/배터리)을 호스트 룸 + 해당 참가자 본인 룸에 브로드캐스트한다."""
    sio = _get_sio()
    body = {"session_id": str(session_id), **payload}
    await sio.emit("device_status_changed", body, room=_room_host(session_id), namespace=_NAMESPACE)
    pid = payload.get("participant_id")
    if pid:
        await sio.emit(
            "device_status_changed", body, room=_room_self(session_id, pid), namespace=_NAMESPACE
        )
    logger.info("[WS /session-live] broadcast device_status_changed → session:%s", session_id)


# ---------------------------------------------------------------------------
# sync → async 브리지 (REST/서비스 레이어에서 이벤트 발행)
# ---------------------------------------------------------------------------


def _schedule(coro) -> None:
    """캡처한 이벤트 루프에 코루틴을 예약한다. 루프가 없으면(테스트 등) 발행을 생략한다."""
    loop = _loop
    if loop is not None:
        try:
            asyncio.run_coroutine_threadsafe(coro, loop)
            return
        except Exception:
            pass
    # 실행 중 루프 없음 — "coroutine never awaited" 경고 방지 후 생략
    coro.close()


def notify_session_state_changed(session_id: str, payload: dict) -> None:
    _schedule(broadcast_session_state(session_id, _jsonify(payload)))


def notify_participant_changed(session_id: str, payload: dict) -> None:
    _schedule(broadcast_participant(session_id, _jsonify(payload)))


def notify_device_status_changed(session_id: str, payload: dict) -> None:
    _schedule(broadcast_device_status(session_id, _jsonify(payload)))
