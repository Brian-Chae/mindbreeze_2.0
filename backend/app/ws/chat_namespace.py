"""채팅 Socket.IO 네임스페이스 `/chat`

클라이언트→서버: join, join_room, leave, leave_room, message
서버→클라이언트: new_message, joined, new_notification
"""

import logging

from app.ws import sio

logger = logging.getLogger(__name__)

# ── 유저 ID → sid 매핑 (알림 브로드캐스트용) ──
_user_sids: dict[str, str] = {}  # user_id → latest sid
# 멀티탭: sid → user_id 매핑. 한 사용자가 탭을 여러 개 열어도 각 소켓 sid 로 본인을
# 역추적할 수 있어야 한다. latest sid 만 남기면 먼저 연 탭의 sid 역추적이 불가해
# 방 입장/메시지 전송이 차단된다(탭 2개 이상).
_sid_users: dict[str, str] = {}


def _user_is_active(user_id: str) -> bool:
    """알림 room 입장 자격 — active 계정만 허용(정지/대기/삭제 계정 제외).

    WS-AUTHZ-06: Socket.IO connect 는 REST 의 get_current_user 상태 게이트를 우회하므로
    여기서 계정 상태를 직접 확인한다. 조회가 불가한 환경(테스트 스텁 등)에서는 알림
    수신을 임의로 막지 않도록 허용한다(best-effort).
    """
    from app.core.database import SessionLocal
    from app.models.user import User as UserModel

    db = SessionLocal()
    try:
        user = db.query(UserModel).filter(UserModel.id == user_id).first()
    except Exception as exc:  # noqa: BLE001
        logger.warning(f"[WS] account status check failed (user={user_id}): {exc}")
        return True
    finally:
        db.close()
    return user is not None and user.status == "active"


@sio.event(namespace="/chat")
async def connect(sid, environ, auth):
    """JWT 토큰으로 인증 → user:<user_id> room join"""
    token = (auth or {}).get("token")
    if not token:
        return True  # 토큰 없어도 연결 허용 (하위 호환)

    try:
        from app.core.security import decode_token
        payload = decode_token(token)
    except Exception:
        return True  # 토큰 만료/위조여도 채팅 연결은 허용 (하위 호환)

    user_id = payload.get("sub")
    # WS-AUTHZ-06: access 토큰만 인정 — refresh 등 비-access 토큰으로 알림 room(user:<id>)에
    #   무단 입장하는 것을 막는다(type 미표기 토큰은 레거시 호환으로 허용).
    token_type = payload.get("type")
    if token_type not in (None, "access"):
        logger.warning(f"[WS] blocked non-access token (sid={sid}, type={token_type})")
        return True
    if not user_id:
        return True

    # WS-AUTHZ-06: 정지(suspended)/대기(pending)/삭제 계정은 토큰이 유효해도 알림 room 에 입장하지 않는다.
    if not _user_is_active(user_id):
        logger.warning(f"[WS] blocked connect for non-active account (sid={sid}, user={user_id})")
        return True

    # user-specific room에 join (알림 수신용)
    room = f"user:{user_id}"
    await sio.enter_room(sid, room, namespace="/chat")
    _user_sids[user_id] = sid
    _sid_users[sid] = user_id
    logger.info(f"[WS] user {user_id} joined notification room (sid={sid})")
    return True


@sio.event(namespace="/chat")
async def disconnect(sid):
    # 멀티탭: 이 소켓의 sid→user 매핑을 먼저 정리한다(다른 탭 sid 매핑은 유지).
    _sid_users.pop(sid, None)
    # sid로 등록된 user_id 정리 (latest sid 일 때만 제거 — 다른 탭이 남아 있으면 유지)
    for uid, s in list(_user_sids.items()):
        if s == sid:
            del _user_sids[uid]
            break


async def _enter_room(sid, data):
    data = data if isinstance(data, dict) else {}
    room_id = data.get("room_id")
    if not room_id:
        return
    # 보안: 사용자 개인 알림 room(user:<id>)은 connect에서만 자동 가입. 임의 가입 차단
    if str(room_id).startswith("user:"):
        logger.warning(f"[WS] blocked join to user room (sid={sid}, room={room_id})")
        return
    # 보안: 채팅방 room은 본인이 멤버인 방만 가입 허용 (도청 방지)
    if not await _is_room_member(sid, str(room_id)):
        logger.warning(f"[WS] blocked join to non-member room (sid={sid}, room={room_id})")
        return
    await sio.enter_room(sid, room_id, namespace="/chat")
    await sio.emit("joined", {"room_id": room_id}, to=sid, namespace="/chat")


async def _is_room_member(sid: str, room_id: str) -> bool:
    """sid → user_id 역추적 후, 해당 room의 멤버인지 확인. 미인증·비멤버면 False.

    멀티탭 대응: latest sid 만 담는 `_user_sids` 대신 sid→user_id 직접 매핑(`_sid_users`)으로
    역추적한다. 탭을 2개 이상 열어도 모든 sid 가 정확히 본인 user_id 로 해석된다.
    """
    user_id = _sid_users.get(sid)
    if user_id is None:
        return False
    from app.core.database import SessionLocal
    from app.services.chat_service import get_user_chat_room_ids

    db = SessionLocal()
    try:
        return room_id in get_user_chat_room_ids(user_id, db)
    finally:
        db.close()


@sio.on("join", namespace="/chat")
async def on_join(sid, data):
    await _enter_room(sid, data)


@sio.on("join_room", namespace="/chat")
async def on_join_room(sid, data):
    await _enter_room(sid, data)


async def _exit_room(sid, data):
    data = data if isinstance(data, dict) else {}
    room_id = data.get("room_id")
    if room_id:
        await sio.leave_room(sid, room_id, namespace="/chat")


@sio.on("leave", namespace="/chat")
async def on_leave(sid, data):
    await _exit_room(sid, data)


@sio.on("leave_room", namespace="/chat")
async def on_leave_room(sid, data):
    await _exit_room(sid, data)


_MAX_MESSAGE_LEN = 4000


@sio.on("message", namespace="/chat")
async def on_message(sid, data):
    data = data if isinstance(data, dict) else {}
    room_id = data.get("room_id")
    if not room_id:
        return
    # 보안: 사용자 개인 room(user:<id>)으로 임의 메시지 전송 차단
    if str(room_id).startswith("user:"):
        logger.warning(f"[WS] blocked message to user room (sid={sid}, room={room_id})")
        return
    # 보안: 채팅방 room 멤버십 검증 (임의 방으로 메시지 스푸핑 방지)
    if not await _is_room_member(sid, str(room_id)):
        logger.warning(f"[WS] blocked message to non-member room (sid={sid}, room={room_id})")
        return

    # CHAT-WS-MESSAGE-SPOOF: 렌더링/저장 가능한 payload 계약을 서버가 강제한다.
    #   (1) sender_id 는 클라이언트가 보낸 값을 신뢰하지 않고 인증된 소켓의 user_id 로 고정한다
    #       — 타인 명의 사칭(sender/created_at 위조) 차단.
    #   (2) content/type 을 검증한다 — 빈/비문자/과길이/비-text 메시지는 브로드캐스트하지 않는다.
    sender_id = _sid_users.get(sid)
    if not sender_id:
        logger.warning(f"[WS] blocked message from unauthenticated sid (sid={sid})")
        return
    content = data.get("content")
    if not isinstance(content, str) or not content.strip():
        logger.warning(f"[WS] blocked empty/invalid message content (sid={sid})")
        return
    content = content.strip()
    if len(content) > _MAX_MESSAGE_LEN:
        logger.warning(f"[WS] blocked oversized message (sid={sid}, len={len(content)})")
        return
    if data.get("type") not in (None, "text"):
        logger.warning(f"[WS] blocked unsupported message type (sid={sid}, type={data.get('type')})")
        return

    payload: dict = {
        "room_id": str(room_id),
        "sender_id": sender_id,
        "content": content,
        "type": "text",
    }
    # 클라이언트 임시 키(에코 매칭용)가 있으면 보존하되 서버 값으로 덮지 않는다.
    if data.get("client_id") is not None:
        payload["client_id"] = data.get("client_id")
    await sio.emit("new_message", payload, room=room_id, namespace="/chat")


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


async def broadcast_messages_read(room_id: str, reader_id: str, message_updates: list[dict] | None = None) -> None:
    """채팅방의 모든 메시지가 읽혔음을 브로드캐스트."""
    await sio.emit(
        "messages_read",
        {
            "room_id": room_id,
            "reader_id": reader_id,
            "messages": message_updates or [],
        },
        room=room_id,
        namespace="/chat",
    )
