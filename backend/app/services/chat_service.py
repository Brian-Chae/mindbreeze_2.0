"""채팅 비즈니스 로직"""

from datetime import datetime
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session as DBSession

from app.models.chat import ChatRoom, ChatMessage, ChatMessageRead, ChatRoomParticipant
from app.models.session import Session, SessionParticipant
from app.models.client_counselor_link import ClientCounselorLink
from app.models.user import User


def _uuid(v: str) -> UUID:
    try:
        return UUID(str(v))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="잘못된 ID 형식입니다")


def _serialize_msg(m: ChatMessage) -> dict:
    return {
        "id": str(m.id),
        "room_id": str(m.room_id),
        "sender_id": str(m.sender_id) if m.sender_id else None,
        "type": m.type,
        "content": m.content,
        "file_url": m.file_url,
        "event_type": m.event_type,
        "created_at": m.created_at or datetime.utcnow(),
    }


def _ensure_member(room: ChatRoom, user_id: str, db: DBSession) -> Session | None:
    uid = _uuid(user_id)
    if room.room_type == "direct":
        if room.host_id == uid:
            return None
        link = (
            db.query(ClientCounselorLink)
            .filter(
                ClientCounselorLink.counselor_id == room.host_id,
                ClientCounselorLink.client_id == uid,
            )
            .first()
        )
        if not link:
            raise HTTPException(status_code=403, detail="채팅방 접근 권한이 없습니다")
        return None
    if room.room_type == "group":
        if room.host_id == uid:
            return None
        is_participant = (
            db.query(ChatRoomParticipant)
            .filter(
                ChatRoomParticipant.room_id == room.id,
                ChatRoomParticipant.user_id == uid,
            )
            .first()
        )
        if not is_participant:
            raise HTTPException(status_code=403, detail="채팅방 접근 권한이 없습니다")
        return None
    session = db.query(Session).filter(Session.id == room.session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")
    if session.host_id == uid:
        return session
    is_participant = (
        db.query(SessionParticipant)
        .filter(SessionParticipant.session_id == session.id, SessionParticipant.user_id == uid)
        .first()
    )
    if not is_participant:
        raise HTTPException(status_code=403, detail="채팅방 접근 권한이 없습니다")
    return session


def get_or_create_room_by_session(session_id: UUID, db: DBSession) -> ChatRoom:
    room = db.query(ChatRoom).filter(ChatRoom.session_id == session_id).first()
    if not room:
        room = ChatRoom(session_id=session_id, room_type="session")
        db.add(room)
        db.commit()
        db.refresh(room)
    return room


def get_or_create_direct_room(counselor_id: UUID, client_id: UUID, db: DBSession) -> ChatRoom:
    # 직접방의 상대 내담자 식별은 name 필드에 client_id를 저장하여 관리
    existing = (
        db.query(ChatRoom)
        .filter(
            ChatRoom.room_type == "direct",
            ChatRoom.host_id == counselor_id,
            ChatRoom.name == str(client_id),
        )
        .first()
    )
    if existing:
        return existing
    new_room = ChatRoom(
        session_id=None,
        room_type="direct",
        host_id=counselor_id,
        name=str(client_id),
    )
    db.add(new_room)
    db.commit()
    db.refresh(new_room)
    return new_room


def create_direct_room(counselor_id: str, client_id: str, name: str | None = None, db: DBSession = None) -> dict:
    return create_room(
        host_id=counselor_id,
        room_type="direct",
        client_id=client_id,
        participant_ids=None,
        name=name,
        db=db,
    )


def create_group_room(
    host_id: str,
    participant_ids: list[str],
    name: str | None,
    db: DBSession,
) -> dict:
    host_uuid = _uuid(host_id)
    if not participant_ids:
        raise HTTPException(status_code=422, detail="참여자를 1명 이상 선택해야 합니다")
    # 상담사-내담자 연결 확인 (각 참여자)
    participant_uuids: list[UUID] = []
    for pid in participant_ids:
        puid = _uuid(pid)
        if puid == host_uuid:
            continue
        link = (
            db.query(ClientCounselorLink)
            .filter(
                ClientCounselorLink.counselor_id == host_uuid,
                ClientCounselorLink.client_id == puid,
            )
            .first()
        )
        if not link:
            raise HTTPException(status_code=403, detail="연결되지 않은 내담자가 포함되어 있습니다")
        participant_uuids.append(puid)
    if not participant_uuids:
        raise HTTPException(status_code=422, detail="참여자를 1명 이상 선택해야 합니다")
    room = ChatRoom(
        session_id=None,
        room_type="group",
        host_id=host_uuid,
        name=name,
    )
    db.add(room)
    db.commit()
    db.refresh(room)
    for puid in participant_uuids:
        db.add(ChatRoomParticipant(room_id=room.id, user_id=puid))
    db.commit()
    return _serialize_room(room, host_id, db)


def create_room(
    host_id: str,
    room_type: str,
    client_id: str | None,
    participant_ids: list[str] | None,
    name: str | None,
    db: DBSession,
) -> dict:
    if room_type == "direct":
        if not client_id:
            raise HTTPException(status_code=422, detail="client_id가 필요합니다")
        counselor_uuid = _uuid(host_id)
        client_uuid = _uuid(client_id)
        link = (
            db.query(ClientCounselorLink)
            .filter(
                ClientCounselorLink.counselor_id == counselor_uuid,
                ClientCounselorLink.client_id == client_uuid,
            )
            .first()
        )
        if not link:
            raise HTTPException(status_code=403, detail="연결되지 않은 내담자입니다")
        room = get_or_create_direct_room(counselor_uuid, client_uuid, db)
        return _serialize_room(room, host_id, db)
    if room_type == "group":
        return create_group_room(host_id, participant_ids or [], name, db)
    raise HTTPException(status_code=400, detail="지원하지 않는 방 유형입니다")


def _peer_id_for_direct(room: ChatRoom, user_id: UUID) -> str | None:
    if room.room_type != "direct":
        return None
    if room.host_id == user_id:
        return room.name  # client id 저장 위치
    return str(room.host_id) if room.host_id else None


def _serialize_room(room: ChatRoom, user_id: str, db: DBSession) -> dict:
    uid = _uuid(user_id)
    # 참여자 수 계산
    count = _participant_count(room, db)
    return {
        "id": str(room.id),
        "session_id": str(room.session_id) if room.session_id else None,
        "room_type": room.room_type,
        "host_id": str(room.host_id) if room.host_id else None,
        "name": room.name,
        "peer_id": _peer_id_for_direct(room, uid),
        "participant_count": count,
        "created_at": room.created_at or datetime.utcnow(),
        "unread_count": _unread_count(room, user_id, db),
    }


def _participant_count(room: ChatRoom, db: DBSession) -> int:
    if room.room_type == "direct":
        return 2  # host + client
    if room.room_type == "group":
        pc = db.query(ChatRoomParticipant).filter(
            ChatRoomParticipant.room_id == room.id
        ).count()
        return pc + (1 if room.host_id else 0)
    if room.session_id:
        return db.query(SessionParticipant).filter(
            SessionParticipant.session_id == room.session_id
        ).count()
    return 0


def _unread_count(room: ChatRoom, user_id: str, db: DBSession) -> int:
    uid = _uuid(user_id)
    total = db.query(ChatMessage).filter(ChatMessage.room_id == room.id).count()
    read = (
        db.query(ChatMessageRead)
        .join(ChatMessage, ChatMessage.id == ChatMessageRead.message_id)
        .filter(ChatMessage.room_id == room.id, ChatMessageRead.user_id == uid)
        .count()
    )
    return max(total - read, 0)


def list_my_rooms(user_id: str, db: DBSession) -> list[dict]:
    uid = _uuid(user_id)
    hosted = db.query(Session).filter(Session.host_id == uid).all()
    participated = (
        db.query(Session)
        .join(SessionParticipant, SessionParticipant.session_id == Session.id)
        .filter(SessionParticipant.user_id == uid)
        .all()
    )
    sessions = {s.id: s for s in hosted + participated}
    result: list[dict] = []
    for s in sessions.values():
        room = get_or_create_room_by_session(s.id, db)
        result.append(_serialize_room(room, user_id, db))

    # 직접방: 본인이 host(상담사) 이거나, link 상대(내담자)인 경우
    as_host = (
        db.query(ChatRoom)
        .filter(ChatRoom.room_type == "direct", ChatRoom.host_id == uid)
        .all()
    )
    linked_counselor_ids = [
        l.counselor_id
        for l in db.query(ClientCounselorLink).filter(ClientCounselorLink.client_id == uid).all()
    ]
    as_client: list[ChatRoom] = []
    if linked_counselor_ids:
        as_client = (
            db.query(ChatRoom)
            .filter(
                ChatRoom.room_type == "direct",
                ChatRoom.host_id.in_(linked_counselor_ids),
                ChatRoom.name == str(uid),
            )
            .all()
        )
    direct_seen: dict[UUID, ChatRoom] = {}
    for r in as_host + as_client:
        direct_seen.setdefault(r.id, r)
    for r in direct_seen.values():
        result.append(_serialize_room(r, user_id, db))

    # 그룹방: 본인이 host(상담사) 이거나 ChatRoomParticipant 인 경우
    group_as_host = (
        db.query(ChatRoom)
        .filter(ChatRoom.room_type == "group", ChatRoom.host_id == uid)
        .all()
    )
    group_as_participant = (
        db.query(ChatRoom)
        .join(ChatRoomParticipant, ChatRoomParticipant.room_id == ChatRoom.id)
        .filter(ChatRoom.room_type == "group", ChatRoomParticipant.user_id == uid)
        .all()
    )
    group_seen: dict[UUID, ChatRoom] = {}
    for r in group_as_host + group_as_participant:
        group_seen.setdefault(r.id, r)
    for r in group_seen.values():
        result.append(_serialize_room(r, user_id, db))
    return result


def get_room(room_id: str, user_id: str, db: DBSession) -> dict:
    rid = _uuid(room_id)
    room = db.query(ChatRoom).filter(ChatRoom.id == rid).first()
    if not room:
        raise HTTPException(status_code=404, detail="채팅방을 찾을 수 없습니다")
    _ensure_member(room, user_id, db)
    return _serialize_room(room, user_id, db)


def list_messages(room_id: str, user_id: str, db: DBSession, limit: int = 50) -> list[dict]:
    rid = _uuid(room_id)
    room = db.query(ChatRoom).filter(ChatRoom.id == rid).first()
    if not room:
        raise HTTPException(status_code=404, detail="채팅방을 찾을 수 없습니다")
    _ensure_member(room, user_id, db)
    msgs = (
        db.query(ChatMessage)
        .filter(ChatMessage.room_id == rid)
        .order_by(ChatMessage.created_at.desc())
        .limit(limit)
        .all()
    )
    return [_serialize_msg(m) for m in msgs]


def post_message(room_id: str, user_id: str, content: str, msg_type: str, file_url: str | None, db: DBSession) -> dict:
    rid = _uuid(room_id)
    room = db.query(ChatRoom).filter(ChatRoom.id == rid).first()
    if not room:
        raise HTTPException(status_code=404, detail="채팅방을 찾을 수 없습니다")
    _ensure_member(room, user_id, db)
    if not content or not content.strip():
        raise HTTPException(status_code=422, detail="메시지 내용이 비어있습니다")
    msg = ChatMessage(
        room_id=rid,
        sender_id=_uuid(user_id),
        type=msg_type or "text",
        content=content,
        file_url=file_url,
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)
    # 본인 메시지는 자동 읽음
    db.add(ChatMessageRead(message_id=msg.id, user_id=_uuid(user_id)))
    db.commit()
    return _serialize_msg(msg)


def mark_read(room_id: str, user_id: str, db: DBSession) -> None:
    rid = _uuid(room_id)
    room = db.query(ChatRoom).filter(ChatRoom.id == rid).first()
    if not room:
        raise HTTPException(status_code=404, detail="채팅방을 찾을 수 없습니다")
    _ensure_member(room, user_id, db)
    uid = _uuid(user_id)
    msgs = db.query(ChatMessage).filter(ChatMessage.room_id == rid).all()
    existing = {
        r.message_id
        for r in db.query(ChatMessageRead)
        .filter(ChatMessageRead.user_id == uid)
        .all()
    }
    for m in msgs:
        if m.id not in existing:
            db.add(ChatMessageRead(message_id=m.id, user_id=uid))
    db.commit()
