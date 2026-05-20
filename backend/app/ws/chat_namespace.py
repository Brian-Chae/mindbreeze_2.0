"""채팅 Socket.IO 네임스페이스 `/chat`

클라이언트→서버: join, leave, message
서버→클라이언트: message, system, read
"""

from app.ws import sio


@sio.event(namespace="/chat")
async def connect(sid, environ, auth):
    # 인증 토큰 검증은 추후 확장. MVP1에서는 통과.
    return True


@sio.event(namespace="/chat")
async def disconnect(sid):
    pass


@sio.on("join", namespace="/chat")
async def on_join(sid, data):
    room_id = data.get("room_id")
    if not room_id:
        return
    await sio.enter_room(sid, room_id, namespace="/chat")
    await sio.emit("joined", {"room_id": room_id}, to=sid, namespace="/chat")


@sio.on("leave", namespace="/chat")
async def on_leave(sid, data):
    room_id = data.get("room_id")
    if room_id:
        await sio.leave_room(sid, room_id, namespace="/chat")


@sio.on("message", namespace="/chat")
async def on_message(sid, data):
    room_id = data.get("room_id")
    if not room_id:
        return
    await sio.emit("message", data, room=room_id, namespace="/chat")


async def broadcast_message(room_id: str, payload: dict) -> None:
    """서버 내부에서 메시지 브로드캐스트 시 사용."""
    await sio.emit("message", payload, room=room_id, namespace="/chat")
