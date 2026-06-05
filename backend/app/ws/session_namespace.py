"""세션 상태 WebSocket 네임스페이스 `/session`

세션 상태 변경 시 실시간 브로드캐스트
"""

from app.ws import sio


@sio.event(namespace="/session")
async def connect(sid, environ, auth):
    return True


@sio.event(namespace="/session")
async def disconnect(sid):
    pass


@sio.on("subscribe", namespace="/session")
async def on_subscribe(sid, data):
    session_id = data.get("session_id")
    if session_id:
        await sio.enter_room(sid, session_id, namespace="/session")
        await sio.emit("subscribed", {"session_id": session_id}, to=sid, namespace="/session")


@sio.on("unsubscribe", namespace="/session")
async def on_unsubscribe(sid, data):
    session_id = data.get("session_id")
    if session_id:
        await sio.leave_room(sid, session_id, namespace="/session")


async def broadcast_session_update(session_id: str, event: str, payload: dict) -> None:
    """서버 내부에서 세션 상태 변경 브로드캐스트"""
    await sio.emit(event, payload, room=session_id, namespace="/session")
