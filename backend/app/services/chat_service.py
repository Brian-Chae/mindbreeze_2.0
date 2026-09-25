"""채팅 비즈니스 로직"""

import logging
from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session as DBSession

from app.models.chat import ChatRoom, ChatMessage, ChatMessageRead, ChatRoomParticipant
from app.models.session import Session, SessionParticipant
from app.models.client_counselor_link import ClientCounselorLink
from app.models.user_org_membership import UserOrgMembership
from app.models.user import User

logger = logging.getLogger(__name__)


def _uuid(v: str) -> UUID:
    try:
        return UUID(str(v))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="잘못된 ID 형식입니다")


def _share_org(counselor_id, client_id, db: DBSession) -> bool:
    """상담사와 내담자가 같은 기관(멤버십)에 소속되어 있는지 확인 (SDD-089).

    - 상담사 소속 기관 = UserOrgMembership(status='active')의 org_id 집합
    - 내담자 소속 기관 = User.org_id (단일)
    """
    client = db.query(User).filter(User.id == client_id).first()
    client_org = client.org_id if client else None
    if not client_org:
        return False
    counselor_org_ids = [
        m.org_id
        for m in db.query(UserOrgMembership)
        .filter(
            UserOrgMembership.user_id == counselor_id,
            UserOrgMembership.status == "active",
        )
        .all()
    ]
    return client_org in counselor_org_ids


def get_user_chat_room_ids(user_id: str, db: DBSession) -> list[str]:
    """사용자가 참여 중인 모든 채팅방 ID 목록 조회."""
    uid = _uuid(user_id)
    result: set[str] = set()

    # 직접방 — host (상담사)
    for r in db.query(ChatRoom).filter(
        ChatRoom.room_type == "direct", ChatRoom.host_id == uid
    ).all():
        result.add(str(r.id))

    # 직접방 — client (room.name = client_id)
    for r in db.query(ChatRoom).filter(
        ChatRoom.room_type == "direct", ChatRoom.name == str(uid)
    ).all():
        result.add(str(r.id))

    # 그룹방 — host
    for r in db.query(ChatRoom).filter(
        ChatRoom.room_type == "group", ChatRoom.host_id == uid
    ).all():
        result.add(str(r.id))

    # 그룹방 — participant
    for r in (
        db.query(ChatRoom)
        .join(ChatRoomParticipant, ChatRoomParticipant.room_id == ChatRoom.id)
        .filter(ChatRoom.room_type == "group", ChatRoomParticipant.user_id == uid)
        .all()
    ):
        result.add(str(r.id))

    return list(result)


def _serialize_msg(m: ChatMessage, db=None) -> dict:
    created = m.created_at or datetime.utcnow()
    sender_name = None
    if db and m.sender_id:
        from app.models.user import User as UserModel
        sender = db.query(UserModel).filter(UserModel.id == m.sender_id).first()
        if sender:
            sender_name = sender.name
    # ── 읽음 상태 추적 (Phase 3a): read_by / recipient_count 우선, 없으면 ChatMessageRead 하위호환 ──
    unread_count = 0
    read_by_list = m.read_by or []
    rc = m.recipient_count or 0
    if rc > 0:
        unread_count = max(rc - len(read_by_list), 0)
    elif db and m.room_id:
        room = db.query(ChatRoom).filter(ChatRoom.id == m.room_id).first()
        if room:
            unread_count = _message_unread_count(m, room, db)
    return {
        "id": str(m.id),
        "room_id": str(m.room_id),
        "sender_id": str(m.sender_id) if m.sender_id else None,
        "sender_name": sender_name,
        "type": m.type,
        "content": m.content,
        "file_url": m.file_url,
        "event_type": m.event_type,
        "created_at": created.isoformat() if hasattr(created, 'isoformat') else str(created),
        "unread_count": unread_count,
        "read_count": len(read_by_list),
        "read_by": read_by_list,
        "recipient_count": rc,
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
        if not link and not _share_org(room.host_id, uid, db):
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
        if not link and not _share_org(host_uuid, puid, db):
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
        if not link and not _share_org(counselor_uuid, client_uuid, db):
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


def _peer_name_for_direct(room: ChatRoom, user_id: UUID, db: DBSession) -> str | None:
    """direct 방에서 현재 사용자 기준 상대방 이름 조회"""
    if room.room_type != "direct":
        return None
    if room.host_id == user_id:
        # 현재 사용자가 상담사(host) → 상대는 내담자 (room.name = client_id)
        peer_id = room.name
    else:
        # 현재 사용자가 내담자 → 상대는 상담사(host)
        peer_id = str(room.host_id) if room.host_id else None
    if not peer_id:
        return None
    peer = db.query(User).filter(User.id == peer_id).first()
    return peer.name if peer else None


# _serialize_room의 last_msg 기본값 — 미전달 시 해당 방 1건만 단건 조회
_LAST_MSG_UNSET = object()


def _last_messages_for_rooms(room_ids: list[UUID], db: DBSession) -> dict[str, ChatMessage]:
    """방별 최신 메시지 1건 일괄 조회 (SDD-090).

    PostgreSQL은 DISTINCT ON 단일 쿼리, 그 외(테스트용 SQLite)는 조회 후 축약.
    """
    if not room_ids:
        return {}
    if db.get_bind().dialect.name == "postgresql":
        rows = (
            db.query(ChatMessage)
            .filter(ChatMessage.room_id.in_(room_ids))
            .order_by(ChatMessage.room_id, ChatMessage.created_at.desc())
            .distinct(ChatMessage.room_id)
            .all()
        )
        return {str(r.room_id): r for r in rows}
    # SQLite fallback: 오래된 순으로 순회하며 덮어쓰기 → 방별 마지막 값이 최신
    result: dict[str, ChatMessage] = {}
    for m in (
        db.query(ChatMessage)
        .filter(ChatMessage.room_id.in_(room_ids))
        .order_by(ChatMessage.created_at.asc())
        .all()
    ):
        result[str(m.room_id)] = m
    return result


def _last_message_preview(m: ChatMessage | None) -> tuple[dict | None, datetime | None]:
    """마지막 메시지 → 미리보기 dict + 시각. image/file은 대체 문구로 내려준다."""
    if not m:
        return None, None
    content = m.content
    if m.type == "image":
        content = "사진"
    elif m.type == "file":
        content = "파일"
    created = m.created_at or datetime.utcnow()
    return {"content": content, "created_at": created}, created


def _can_rename_room(room: ChatRoom, uid: UUID) -> tuple[bool, str | None]:
    """이름 변경 권한 계산 (SDD-090).

    - session 방은 이름이 세션 제목을 따르므로 항상 변경 불가 (세션 host 여부는
      Session.host_id 기준이지만, host라도 이 API로는 변경 금지).
    - direct/group은 실제 host(상담사)만 허용. 기관·플랫폼 관리자 우회 없음.
    """
    if room.room_type == "session" or room.session_id:
        return False, "session_managed"
    if not room.host_id:
        return False, "host_missing"
    if room.host_id != uid:
        return False, "not_host"
    return True, None


def _serialize_room(room: ChatRoom, user_id: str, db: DBSession, last_msg=_LAST_MSG_UNSET) -> dict:
    uid = _uuid(user_id)
    # 참여자 수 계산
    count = _participant_count(room, db)
    # 세션 방이면 세션 제목·일자 포함 (목록에서 세션 식별)
    session_title = None
    session_scheduled_at = None
    if room.session_id:
        session = db.query(Session).filter(Session.id == room.session_id).first()
        if session:
            session_title = session.title
            session_scheduled_at = session.scheduled_at
    # ── SDD-090: 마지막 메시지 (목록은 일괄 조회 결과 주입, 단건 경로는 여기서 조회) ──
    if last_msg is _LAST_MSG_UNSET:
        last_msg = _last_messages_for_rooms([room.id], db).get(str(room.id))
    last_message, last_message_at = _last_message_preview(last_msg)
    # ── SDD-090: 표시 이름·이름 변경 권한 계산 ──
    peer_name = _peer_name_for_direct(room, uid, db)
    can_rename, rename_disabled_reason = _can_rename_room(room, uid)
    if room.room_type == "direct":
        custom_name = room.display_name
        display_name = custom_name or peer_name or "1:1 채팅"
    elif room.room_type == "group":
        custom_name = room.name
        display_name = custom_name or "그룹 채팅"
    else:
        custom_name = None
        display_name = session_title or "세션"
    return {
        "id": str(room.id),
        "session_id": str(room.session_id) if room.session_id else None,
        "room_type": room.room_type,
        "host_id": str(room.host_id) if room.host_id else None,
        "name": room.name,
        "peer_name": peer_name,
        "peer_id": _peer_id_for_direct(room, uid),
        "session_title": session_title,
        "session_scheduled_at": session_scheduled_at,
        "participant_count": count,
        "created_at": room.created_at or datetime.utcnow(),
        "unread_count": _unread_count(room, user_id, db),
        "last_message": last_message,
        "last_message_at": last_message_at,
        "custom_name": custom_name,
        "display_name": display_name,
        "can_rename": can_rename,
        "rename_disabled_reason": rename_disabled_reason,
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


def _message_unread_count(msg: ChatMessage, room: ChatRoom, db: DBSession) -> int:
    """특정 메시지를 아직 읽지 않은 사람 수 계산."""
    if room.room_type == "direct":
        # 1:1 채팅: 발신자 제외 상대방 1명만 체크
        read_count = (
            db.query(ChatMessageRead)
            .filter(ChatMessageRead.message_id == msg.id)
            .count()
        )
        # 발신자가 자동 읽음 + 상대방이 읽으면 2, 발신자만 읽으면 1
        return max(2 - read_count, 0)
    # 그룹/세션 채팅: 전체 참여자 - 읽은 사람 수
    total_participants = _participant_count(room, db)
    read_count = (
        db.query(ChatMessageRead)
        .filter(ChatMessageRead.message_id == msg.id)
        .count()
    )
    return max(total_participants - read_count, 0)


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
    rooms: list[ChatRoom] = []
    for s in sessions.values():
        rooms.append(get_or_create_room_by_session(s.id, db))

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
    rooms.extend(direct_seen.values())

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
    rooms.extend(group_seen.values())

    # ── SDD-090: 방별 마지막 메시지 일괄 조회 후 주입 (방마다 개별 쿼리 금지) ──
    last_map = _last_messages_for_rooms([r.id for r in rooms], db)
    result = [
        _serialize_room(r, user_id, db, last_msg=last_map.get(str(r.id))) for r in rooms
    ]

    # ── SDD-090: 기본 정렬 — 최근 대화 시각(없으면 방 생성 시각) 내림차순 ──
    def _sort_ts(r: dict) -> datetime:
        ts = r["last_message_at"] or r["created_at"]
        # naive/aware 혼재 시 비교 오류 방지 (SQLite naive ↔ PostgreSQL aware)
        if ts.tzinfo is None:
            return ts.replace(tzinfo=timezone.utc)
        return ts

    result.sort(key=_sort_ts, reverse=True)
    return result


def get_room(room_id: str, user_id: str, db: DBSession) -> dict:
    rid = _uuid(room_id)
    room = db.query(ChatRoom).filter(ChatRoom.id == rid).first()
    if not room:
        raise HTTPException(status_code=404, detail="채팅방을 찾을 수 없습니다")
    _ensure_member(room, user_id, db)
    return _serialize_room(room, user_id, db)


_RENAME_DENY_DETAIL = {
    "session_managed": "세션 채팅방 이름은 세션 제목을 따릅니다",
    "host_missing": "이름을 변경할 수 있는 방장이 없습니다",
    "not_host": "방장만 채팅방 이름을 변경할 수 있습니다",
}


def update_room(room_id: str, user_id: str, name: str, db: DBSession) -> dict:
    """채팅방 이름 변경 (SDD-090).

    - direct: name(=내담자 ID 저장소)은 절대 덮어쓰지 않고 display_name에 저장
    - group: 기존 name 갱신
    - session: 403 (세션 제목을 따름)
    """
    rid = _uuid(room_id)
    room = db.query(ChatRoom).filter(ChatRoom.id == rid).first()
    if not room:
        raise HTTPException(status_code=404, detail="채팅방을 찾을 수 없습니다")
    _ensure_member(room, user_id, db)
    ok, reason = _can_rename_room(room, _uuid(user_id))
    if not ok:
        raise HTTPException(
            status_code=403,
            detail=_RENAME_DENY_DETAIL.get(reason, "이름 변경 권한이 없습니다"),
        )
    if room.room_type == "direct":
        room.display_name = name
    else:
        room.name = name
    db.commit()
    db.refresh(room)
    return _serialize_room(room, user_id, db)


def _ensure_group_host(room_id: str, user_id: str, db: DBSession) -> tuple[ChatRoom, UUID]:
    """그룹방 + host 검증 공통 처리 (참여자 관리 전용, SDD-090)."""
    rid = _uuid(room_id)
    room = db.query(ChatRoom).filter(ChatRoom.id == rid).first()
    if not room:
        raise HTTPException(status_code=404, detail="채팅방을 찾을 수 없습니다")
    if room.room_type != "group":
        raise HTTPException(status_code=403, detail="그룹 채팅방만 참여자를 관리할 수 있습니다")
    uid = _uuid(user_id)
    if room.host_id != uid:
        raise HTTPException(status_code=403, detail="방장만 참여자를 관리할 수 있습니다")
    return room, uid


def add_room_participants(room_id: str, user_id: str, participant_ids: list[str], db: DBSession) -> dict:
    """그룹방 참여자 추가 (SDD-090). 기존 생성 정책(Link OR 공유 기관) 재검증."""
    room, uid = _ensure_group_host(room_id, user_id, db)
    existing = {
        p.user_id
        for p in db.query(ChatRoomParticipant)
        .filter(ChatRoomParticipant.room_id == room.id)
        .all()
    }
    for pid in participant_ids:
        puid = _uuid(pid)
        if puid == uid or puid in existing:
            continue
        link = (
            db.query(ClientCounselorLink)
            .filter(
                ClientCounselorLink.counselor_id == uid,
                ClientCounselorLink.client_id == puid,
            )
            .first()
        )
        if not link and not _share_org(uid, puid, db):
            raise HTTPException(status_code=403, detail="연결되지 않은 내담자가 포함되어 있습니다")
        db.add(ChatRoomParticipant(room_id=room.id, user_id=puid))
        existing.add(puid)
    db.commit()
    return _serialize_room(room, user_id, db)


def remove_room_participant(room_id: str, user_id: str, target_user_id: str, db: DBSession) -> None:
    """그룹방 참여자 내보내기 (SDD-090). 제거 즉시 방 접근·메시지 수신에서 제외된다."""
    room, uid = _ensure_group_host(room_id, user_id, db)
    tuid = _uuid(target_user_id)
    if tuid == uid:
        raise HTTPException(status_code=422, detail="방장은 내보낼 수 없습니다")
    row = (
        db.query(ChatRoomParticipant)
        .filter(
            ChatRoomParticipant.room_id == room.id,
            ChatRoomParticipant.user_id == tuid,
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="참여자를 찾을 수 없습니다")
    db.delete(row)
    db.commit()


def get_room_participants(room_id: str, user_id: str, db: DBSession) -> list[dict]:
    """그룹방 참여자 명단 조회 (SDD-090). host 전용."""
    room, _uid = _ensure_group_host(room_id, user_id, db)
    rows = (
        db.query(ChatRoomParticipant, User)
        .join(User, User.id == ChatRoomParticipant.user_id)
        .filter(ChatRoomParticipant.room_id == room.id)
        .order_by(ChatRoomParticipant.joined_at)
        .all()
    )
    return [
        {
            "user_id": str(p.user_id),
            "name": u.name if u else "알 수 없음",
            "joined_at": p.joined_at,
        }
        for p, u in rows
    ]


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
    return [_serialize_msg(m, db) for m in msgs]


def _resolve_recipients(room: ChatRoom, sender_id: UUID, db: DBSession) -> list[str]:
    """채팅방에서 발신자를 제외한 모든 수신자 ID 목록 조회."""
    recipients: list[str] = []

    if room.room_type == "direct":
        # 발신자가 host(상담사) → 수신자는 client
        # 발신자가 client → 수신자는 host
        if room.host_id == sender_id:
            # room.name = client_id
            client_uid = room.name
            if client_uid:
                recipients.append(client_uid)
        else:
            recipients.append(str(room.host_id))
    elif room.room_type == "group":
        # host가 발신자가 아니면 추가
        if room.host_id and room.host_id != sender_id:
            recipients.append(str(room.host_id))
        # 참여자 목록
        participants = db.query(ChatRoomParticipant).filter(
            ChatRoomParticipant.room_id == room.id,
            ChatRoomParticipant.user_id != sender_id,
        ).all()
        for p in participants:
            recipients.append(str(p.user_id))
    else:
        # session 방: 세션 host + 참여자 중 발신자 제외
        if room.session_id:
            session = db.query(Session).filter(Session.id == room.session_id).first()
            if session:
                if session.host_id and session.host_id != sender_id:
                    recipients.append(str(session.host_id))
                participants = (
                    db.query(SessionParticipant)
                    .filter(
                        SessionParticipant.session_id == room.session_id,
                        SessionParticipant.user_id.isnot(None),
                        SessionParticipant.user_id != sender_id,
                    )
                    .all()
                )
                for p in participants:
                    recipients.append(str(p.user_id))

    return recipients


async def post_message(room_id: str, user_id: str, content: str, msg_type: str, file_url: str | None, db: DBSession) -> dict:
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
    # 본인 메시지는 자동 읽음 + recipient_count 설정
    sender_uid = _uuid(user_id)
    recipients = _resolve_recipients(room, sender_uid, db)
    msg.recipient_count = len(recipients) + 1  # 발신자 포함 전체 인원
    msg.read_by = [user_id]  # 발신자는 자동 읽음
    db.add(ChatMessageRead(message_id=msg.id, user_id=sender_uid))
    db.commit()

    # ── 수신자 알림 생성 ──
    try:
        from app.services.notification_service import notify_event
        sender = db.query(User).filter(User.id == sender_uid).first()
        sender_display = sender.name if sender else "사용자"
        for recipient_id in recipients:
            notif = notify_event(
                "chat_message",
                recipient_id,
                {
                    "title": f"{sender_display}님의 메시지",
                    "body": content[:100] if content else "새 메시지가 도착했습니다",
                    "extra": {"room_id": str(rid), "sender_id": user_id},
                },
                db,
            )
    except Exception as e:
        logger.error(f"Failed to create chat notification: {e}", exc_info=True)

    # 실시간 메시지 브로드캐스트
    serialized = _serialize_msg(msg, db)
    try:
        from app.ws.chat_namespace import broadcast_message
        await broadcast_message(str(rid), serialized)
    except Exception as e:
        logger.error(f"Failed to broadcast for room={room_id}: {e}")  # WS 실패해도 REST 응답은 정상
    return serialized


async def mark_read(room_id: str, user_id: str, db: DBSession) -> None:
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
            # ── Phase 3a: read_by 배열에도 추가 (중복 방지) ──
            current_read_by = m.read_by or []
            if user_id not in current_read_by:
                current_read_by.append(user_id)
                m.read_by = current_read_by
    db.commit()

    # 같은 방의 채팅 알림도 읽음 처리
    from app.models.notification import Notification
    db.query(Notification).filter(
        Notification.user_id == uid,
        Notification.type == "chat",
        Notification.is_read.is_(False),
        Notification.extra["room_id"].astext == str(rid),
    ).update({"is_read": True}, synchronize_session=False)
    db.commit()

    # 읽음 상태 실시간 브로드캐스트
    try:
        from app.ws.chat_namespace import broadcast_messages_read
        # 각 메시지의 read_count/unread_count 계산
        updates = []
        for m in msgs:
            read_by_list = m.read_by or []
            rc = m.recipient_count or 0
            uc = max(rc - len(read_by_list), 0) if rc > 0 else _message_unread_count(m, room, db)
            updates.append({"id": str(m.id), "unread_count": uc, "read_count": len(read_by_list), "read_by": read_by_list})
        await broadcast_messages_read(str(rid), str(uid), updates)
    except Exception as e:
        logger.error(f"Failed to broadcast for room={room_id}: {e}")  # WS 실패해도 REST 응답은 정상


async def mark_messages_read(room_id: str, user_id: str, message_ids: list[str], db: DBSession) -> None:
    """여러 메시지를 한 번에 읽음 처리 (Phase 3a).

    - message_ids에 해당하는 메시지들의 read_by 배열에 user_id 추가 (중복 방지)
    - ChatMessageRead 테이블에도 기록 (하위 호환)
    - Socket.IO로 messages_read 이벤트 broadcast
    """
    rid = _uuid(room_id)
    uid = _uuid(user_id)
    room = db.query(ChatRoom).filter(ChatRoom.id == rid).first()
    if not room:
        raise HTTPException(status_code=404, detail="채팅방을 찾을 수 없습니다")
    _ensure_member(room, user_id, db)

    # UUID로 변환
    try:
        msg_uuids = [_uuid(mid) for mid in message_ids]
    except HTTPException:
        raise HTTPException(status_code=400, detail="잘못된 메시지 ID 형식입니다")

    # 메시지 조회
    msgs = db.query(ChatMessage).filter(
        ChatMessage.id.in_(msg_uuids),
        ChatMessage.room_id == rid,
    ).all()

    if not msgs:
        return  # 읽음 처리할 메시지 없음

    # 중복 체크를 위한 기존 ChatMessageRead 조회
    existing = {
        r.message_id
        for r in db.query(ChatMessageRead)
        .filter(
            ChatMessageRead.user_id == uid,
            ChatMessageRead.message_id.in_(msg_uuids),
        )
        .all()
    }

    user_id_str = str(uid)
    updates = []
    for m in msgs:
        # ChatMessageRead 테이블에 기록
        if m.id not in existing:
            db.add(ChatMessageRead(message_id=m.id, user_id=uid))
            # read_by 배열 업데이트
            current_read_by = list(m.read_by or [])
            if user_id_str not in current_read_by:
                current_read_by.append(user_id_str)
                m.read_by = current_read_by

        # broadcast용 업데이트 데이터 계산
        read_by_list = m.read_by or []
        rc = m.recipient_count or 0
        uc = max(rc - len(read_by_list), 0) if rc > 0 else 0
        updates.append({
            "id": str(m.id),
            "unread_count": uc,
            "read_count": len(read_by_list),
            "read_by": read_by_list,
        })

    db.commit()

    # Socket.IO broadcast
    try:
        from app.ws.chat_namespace import broadcast_messages_read
        await broadcast_messages_read(str(rid), user_id_str, updates)
    except Exception as e:
        logger.error(f"Failed to broadcast messages_read for room={room_id}: {e}")


def get_unread_counts(room_id: str, user_id: str, db: DBSession) -> dict[str, int]:
    """채팅방의 각 메시지별 안읽은 수 반환 (Phase 3a).

    Returns:
        {message_id: unread_count}
    """
    rid = _uuid(room_id)
    room = db.query(ChatRoom).filter(ChatRoom.id == rid).first()
    if not room:
        raise HTTPException(status_code=404, detail="채팅방을 찾을 수 없습니다")
    _ensure_member(room, user_id, db)

    msgs = db.query(ChatMessage).filter(ChatMessage.room_id == rid).all()
    result: dict[str, int] = {}
    for m in msgs:
        read_by_list = m.read_by or []
        rc = m.recipient_count or 0
        if rc > 0:
            result[str(m.id)] = max(rc - len(read_by_list), 0)
        else:
            # 하위 호환: recipient_count가 0인 경우 ChatMessageRead 기반 계산
            unread = _message_unread_count(m, room, db)
            result[str(m.id)] = unread
    return result
