"""채팅 Socket.IO 네임스페이스 `/chat`

클라이언트→서버: join, join_room, leave, leave_room, message
서버→클라이언트: new_message, joined, new_notification
"""

import logging

from app.ws import sio

logger = logging.getLogger(__name__)

# ── 유저 ID → sid 매핑 (알림 브로드캐스트용) ──
_user_sids: dict[str, str] = {}  # user_id → latest sid


@sio.event(namespace="/chat")
async def connect(sid, environ, auth):
    """JWT 토큰으로 인증 → user:<user_id> room join"""
    token = (auth or {}).get("token")
    if not token:
        return True  # 토큰 없어도 연결 허용 (하위 호환)

    try:
        from app.core.security import decode_token
        payload = decode_token(token)
        user_id = payload.get("sub")
        if user_id:
            # user-specific room에 join (알림 수신용)
            room = f"user:{user_id}"
            await sio.enter_room(sid, room, namespace="/chat")
            _user_sids[user_id] = sid
            logger.info(f"[WS] user {user_id} joined notification room (sid={sid})")
    except Exception:
        pass  # 토큰 만료/위조여도 채팅 연결은 허용

    return True


@sio.event(namespace="/chat")
async def disconnect(sid):
    # sid로 등록된 user_id 정리
    for uid, s in list(_user_sids.items()):
        if s == sid:
            del _user_sids[uid]
            break


async def _enter_room(sid, data):
    room_id = data.get("room_id")
    if not room_id:
        return
    await sio.enter_room(sid, room_id, namespace="/chat")
    await sio.emit("joined", {"room_id": room_id}, to=sid, namespace="/chat")


@sio.on("join", namespace="/chat")
async def on_join(sid, data):
    await _enter_room(sid, data)


@sio.on("join_room", namespace="/chat")
async def on_join_room(sid, data):
    await _enter_room(sid, data)


async def _exit_room(sid, data):
    room_id = data.get("room_id")
    if room_id:
        await sio.leave_room(sid, room_id, namespace="/chat")


@sio.on("leave", namespace="/chat")
async def on_leave(sid, data):
    await _exit_room(sid, data)


@sio.on("leave_room", namespace="/chat")
async def on_leave_room(sid, data):
    await _exit_room(sid, data)


@sio.on("message", namespace="/chat")
async def on_message(sid, data):
    room_id = data.get("room_id")
    if not room_id:
        return
    await sio.emit("new_message", data, room=room_id, namespace="/chat")


async def broadcast_message(room_id: str, payload: dict) -> None:
    """서버 내부에서 REST API로 저장된 메시지 브로드캐스트."""
    await sio.emit("new_message", payload, room=room_id, namespace="/chat")


async def broadcast_profile_updated(user_id: str, new_name: str) -> None:
    """프로필(이름) 변경 시 연결된 모든 채팅방에 실시간 브로드캐스트."""
    from app.core.database import SessionLocal

    db = SessionLocal()
    try:
        from app.services.chat_service import get_user_chat_room_ids
        room_ids = get_user_chat_room_ids(user_id, db)
    finally:
        db.close()

    payload = {"type": "profile_updated", "user_id": user_id, "name": new_name}
    for rid in room_ids:
        await sio.emit("profile_updated", payload, room=rid, namespace="/chat")


async def broadcast_notification(user_id: str, notif_data: dict) -> None:
    """특정 사용자에게 실시간 알림 브로드캐스트."""
    room = f"user:{user_id}"
    await sio.emit("new_notification", notif_data, room=room, namespace="/chat")
