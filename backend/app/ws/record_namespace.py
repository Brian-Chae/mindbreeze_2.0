"""AI 기록지 처리 상태 Socket.IO 네임스페이스 `/record`

클라이언트→서버: subscribe(session_id), unsubscribe(session_id)
서버→클라이언트: record_status (merging→transcribing→diarizing→summarizing→completed/failed)
"""

import logging

logger = logging.getLogger(__name__)


def _get_sio():
    """Lazy import to avoid circular dependency with app.ws.__init__"""
    from app.ws import sio
    return sio


# Socket.IO 이벤트 핸들러 — sio.on 데코레이터를 모듈 레벨에서 사용할 수 없으므로
# app.ws.__init__.py에서 sio 생성 후 수동으로 등록한다.
# 대신 ASGI lifespan 또는 main.py의 startup에서 register_record_namespace(sio)를 호출한다.

def register_record_namespace(sio):
    """app.ws.__init__에서 sio 초기화 후 호출하여 /record 네임스페이스 등록"""

    @sio.event(namespace="/record")
    async def connect(sid, environ, auth):
        token = (auth or {}).get("token")
        if not token:
            return True
        try:
            from app.core.security import decode_token
            payload = decode_token(token)
            user_id = payload.get("sub")
            if user_id:
                logger.info("[WS /record] user %s connected (sid=%s)", user_id, sid)
        except Exception:
            pass
        return True

    @sio.event(namespace="/record")
    async def disconnect(sid):
        pass

    @sio.on("subscribe", namespace="/record")
    async def on_subscribe(sid, data):
        session_id = data.get("session_id")
        if not session_id:
            return
        room = f"session:{session_id}"
        await sio.enter_room(sid, room, namespace="/record")
        logger.info("[WS /record] sid=%s subscribed to %s", sid, room)
        await sio.emit("subscribed", {"session_id": session_id}, to=sid, namespace="/record")

    @sio.on("unsubscribe", namespace="/record")
    async def on_unsubscribe(sid, data):
        session_id = data.get("session_id")
        if not session_id:
            return
        room = f"session:{session_id}"
        await sio.leave_room(sid, room, namespace="/record")
        logger.info("[WS /record] sid=%s unsubscribed from %s", sid, room)

    logger.info("[WS /record] namespace registered")


async def broadcast_record_status(session_id: str, status: str, detail: dict | None = None) -> None:
    """서버 내부에서 처리 단계 변경 시 브로드캐스트.
    
    Args:
        session_id: 세션 UUID
        status: merging | transcribing | diarizing | summarizing | completed | failed
        detail: 추가 정보 (오류 메시지 등)
    """
    sio = _get_sio()
    payload = {"session_id": session_id, "status": status}
    if detail:
        payload["detail"] = detail  # type: ignore
    room = f"session:{session_id}"
    await sio.emit("record_status", payload, room=room, namespace="/record")  # type: ignore
    logger.info("[WS /record] broadcast %s → session:%s", status, session_id)
