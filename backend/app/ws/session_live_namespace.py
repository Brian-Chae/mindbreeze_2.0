"""클래스별 뇌파 실시간 Socket.IO 네임스페이스 `/session-live` (SDD-024)

밴드 착용 참가자의 1초 EEG feature 를 WS 로 받아
  (a) EEGFeatureWindow 저장 (SDD-023 ingestion 로직 재사용, 멱등)
  (b) 같은 세션 룸(`session:{id}`)의 호스트·게스트에게 실시간 브로드캐스트
한다. REST 5초 배치(`POST /sessions/{id}/features`)는 폴백/오프라인 큐로 유지된다.

클라이언트→서버: join(session_id), leave(session_id), feature(data)
서버→클라이언트: joined, eeg_feature
"""

import logging

logger = logging.getLogger(__name__)

_NAMESPACE = "/session-live"


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


def register_session_live_namespace(sio):
    """app.ws.__init__ 에서 sio 초기화 후 호출하여 `/session-live` 네임스페이스 등록"""

    @sio.event(namespace=_NAMESPACE)
    async def connect(sid, environ, auth):
        # record 네임스페이스와 동일한 정책: 토큰이 있으면 검증하고 user_id 를 세션에 보관.
        # 무토큰도 연결은 허용(게스트는 participant_id 로 식별) — 일관성 유지.
        user_id = None
        token = (auth or {}).get("token")
        if token:
            try:
                from app.core.security import decode_token
                payload = decode_token(token)
                user_id = payload.get("sub")
                if user_id:
                    logger.info("[WS /session-live] user %s connected (sid=%s)", user_id, sid)
            except Exception:
                pass
        await sio.save_session(sid, {"user_id": user_id}, namespace=_NAMESPACE)
        return True

    @sio.event(namespace=_NAMESPACE)
    async def disconnect(sid):
        pass

    @sio.on("join", namespace=_NAMESPACE)
    async def on_join(sid, data):
        session_id = (data or {}).get("session_id")
        if not session_id:
            return
        room = f"session:{session_id}"
        await sio.enter_room(sid, room, namespace=_NAMESPACE)
        logger.info("[WS /session-live] sid=%s joined %s", sid, room)
        await sio.emit("joined", {"session_id": session_id}, to=sid, namespace=_NAMESPACE)

    @sio.on("leave", namespace=_NAMESPACE)
    async def on_leave(sid, data):
        session_id = (data or {}).get("session_id")
        if not session_id:
            return
        room = f"session:{session_id}"
        await sio.leave_room(sid, room, namespace=_NAMESPACE)
        logger.info("[WS /session-live] sid=%s left %s", sid, room)

    @sio.on("feature", namespace=_NAMESPACE)
    async def on_feature(sid, data):
        """참가자가 보낸 1초 EEG feature → 저장 + 룸 브로드캐스트.

        data = {
            "session_id": str,
            "participant_id": str | None,   # 게스트 식별 (로그인 참가자는 connect 토큰의 user_id 사용)
            "feature": { second_offset, delta_power, ..., signal_quality }
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
            # 비참가자/미식별 등 저장 실패 시 브로드캐스트하지 않는다(잘못된 데이터 확산 방지)
            logger.warning("[WS /session-live] feature 저장 실패 (sid=%s, session=%s)", sid, session_id)
            return

        await broadcast_session_eeg(
            session_id,
            {
                "participant_id": resolved_participant_id,
                "feature": feature_out,
                "saved": saved,
            },
        )

    logger.info("[WS /session-live] namespace registered")


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


async def broadcast_session_eeg(session_id: str, feature: dict) -> None:
    """서버 내부에서 세션 룸에 실시간 EEG feature 를 브로드캐스트한다.

    다른 모듈(예: 별도 인제스트 경로)에서도 호출 가능한 헬퍼.

    Args:
        session_id: 세션 UUID(str)
        feature: 브로드캐스트 payload (participant_id, feature, saved 등)
    """
    sio = _get_sio()
    room = f"session:{session_id}"
    payload = {"session_id": str(session_id), **feature}
    await sio.emit("eeg_feature", payload, room=room, namespace=_NAMESPACE)
    logger.info("[WS /session-live] broadcast eeg_feature → %s", room)
