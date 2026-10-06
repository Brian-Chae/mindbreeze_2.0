"""채팅 비즈니스 로직"""

import logging
from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import and_, func, or_, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DBSession

from app.models.chat import ChatRoom, ChatMessage, ChatMessageRead, ChatRoomParticipant
from app.models.session import Session, SessionParticipant
from app.models.client_counselor_link import ClientCounselorLink
from app.models.organization import Organization
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


def _share_org_counselor(host_id, target_id, db: DBSession) -> bool:
    """host 상담사와 대상 상담사가 같은 기관에 소속되어 있는지 확인 (SDD-092).

    내담자용 _share_org 와 달리 양쪽 모두 active UserOrgMembership 의
    org_id 집합으로 비교한다 (교집합 존재 여부).
    """
    host_org_ids = {
        m.org_id
        for m in db.query(UserOrgMembership)
        .filter(
            UserOrgMembership.user_id == host_id,
            UserOrgMembership.status == "active",
        )
        .all()
    }
    if not host_org_ids:
        return False
    target_org_ids = {
        m.org_id
        for m in db.query(UserOrgMembership)
        .filter(
            UserOrgMembership.user_id == target_id,
            UserOrgMembership.status == "active",
        )
        .all()
    }
    return bool(host_org_ids & target_org_ids)


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

    # 세션(클래스) 채팅방 — 세션 host 이거나 SessionParticipant 인 경우.
    # SDD-091 로 개인(1:1) 방이 기본이 되었지만, 클래스 내 실시간 채팅은 여전히
    # 세션 방을 쓰므로 WS 멤버십(user:<id>/room join)에 반드시 포함해야 한다.
    for r in (
        db.query(ChatRoom)
        .join(Session, Session.id == ChatRoom.session_id)
        .filter(
            ChatRoom.room_type == "session",
            or_(
                Session.host_id == uid,
                Session.id.in_(
                    db.query(SessionParticipant.session_id).filter(
                        SessionParticipant.user_id == uid
                    )
                ),
            ),
        )
        .all()
    ):
        result.add(str(r.id))

    return list(result)


def _sender_names_for_messages(messages: list[ChatMessage], db: DBSession) -> dict[str, str]:
    """메시지 목록의 발신자 이름을 단일 IN 조회로 일괄 매핑한다 (MB2-ORM-N1-01).

    기존에는 `_serialize_msg` 가 메시지 1건마다 User 를 개별 조회해
    페이지 50건이면 ~50회의 N+1 이 발생했다.
    """
    sender_ids = {m.sender_id for m in messages if m.sender_id}
    if not sender_ids:
        return {}
    return {
        str(uid): name
        for uid, name in db.query(User.id, User.name).filter(User.id.in_(sender_ids)).all()
    }


def _serialize_msg(
    m: ChatMessage,
    db=None,
    *,
    sender_names: dict[str, str] | None = None,
    room: ChatRoom | None = None,
) -> dict:
    """메시지 1건 직렬화.

    MB2-ORM-N1-01: `sender_names`(발신자 id→이름 맵)·`room`(해당 방)을 배치 호출부가
    주입하면 메시지 단위 개별 조회를 하지 않는다. 전달되지 않은 경우에만 단건 조회로 폴백한다.
    """
    created = m.created_at or datetime.utcnow()
    sender_name = None
    if m.sender_id:
        if sender_names is not None:
            sender_name = sender_names.get(str(m.sender_id))
        elif db:
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
    else:
        resolved_room = room
        if resolved_room is None and db and m.room_id:
            resolved_room = db.query(ChatRoom).filter(ChatRoom.id == m.room_id).first()
        if resolved_room is not None and db is not None:
            unread_count = _message_unread_count(m, resolved_room, db)
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


def _ensure_session_chat_enabled(room: ChatRoom, user_id: str, db: DBSession) -> None:
    """클래스(세션) 채팅 on/off 게이트 — 발신 전용.

    세션 방에서 `Session.chat_enabled=False` 이면 참여자(비 host)의 발신을 막는다.
    host 상담사는 항상 발신 가능하고, 과거 메시지·시스템 공지 조회(읽기)는 막지 않는다.
    """
    if room.room_type != "session" or not room.session_id:
        return
    session = db.query(Session).filter(Session.id == room.session_id).first()
    if session is None or session.chat_enabled or session.host_id == _uuid(user_id):
        return
    raise HTTPException(status_code=403, detail="채팅이 꺼져 있는 클래스입니다")


def get_room_by_session(session_id: UUID, db: DBSession) -> ChatRoom | None:
    """세션 채팅방 조회(생성 없음) — 없으면 None."""
    return db.query(ChatRoom).filter(ChatRoom.session_id == session_id).first()


def get_or_create_room_by_session(session_id: UUID, db: DBSession) -> ChatRoom:
    """세션 채팅방 멱등 개설 — 이미 있으면 그대로 반환한다.

    방이 없으면 생성한다(host_id 는 세션 host). 세션 방 접근 권한은 ChatRoom.host_id 가
    아니라 Session.host_id / SessionParticipant 기반으로 판정한다(_ensure_member 참조).

    CHAT-DIRECT-ROOM-RACE: '조회 후 삽입'은 동시 개설 시 unique(session_id) 위반이
    IntegrityError(500) 로 새어나간다. savepoint 로 감싸 충돌 시 기존 행을 재사용한다.
    """
    room = db.query(ChatRoom).filter(ChatRoom.session_id == session_id).first()
    if room:
        return room
    session = db.query(Session).filter(Session.id == session_id).first()
    new_room = ChatRoom(
        session_id=session_id,
        room_type="session",
        host_id=session.host_id if session else None,
    )
    try:
        with db.begin_nested():
            db.add(new_room)
        db.commit()
        db.refresh(new_room)
        return new_room
    except IntegrityError:
        existing = db.query(ChatRoom).filter(ChatRoom.session_id == session_id).first()
        if existing is None:
            raise
        return existing


def _lock_direct_room_pair(counselor_id: UUID, client_id: UUID, db: DBSession) -> None:
    """direct 채팅방 개설을 (상담사, 내담자) 조합 단위로 직렬화한다(CHAT-DIRECT-ROOM-RACE).

    direct 방은 unique 제약이 없어 '조회 후 삽입' 경합 시 중복 방이 생긴다. PostgreSQL
    트랜잭션 스코프 advisory lock 으로 같은 조합의 동시 개설을 한 줄로 세운 뒤 재조회한다.
    SQLite(테스트) 등 미지원 dialect 는 no-op.
    """
    bind = db.get_bind()
    if bind is None or bind.dialect.name != "postgresql":
        return
    key = f"chat_direct:{counselor_id}:{client_id}"
    db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": key})


def get_or_create_direct_room(counselor_id: UUID, client_id: UUID, db: DBSession) -> ChatRoom:
    # 직접방의 상대 내담자 식별은 name 필드에 client_id를 저장하여 관리
    # CHAT-DIRECT-ROOM-RACE: (상담사, 내담자) 조합 잠금 후 재조회한다.
    _lock_direct_room_pair(counselor_id, client_id, db)
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
    try:
        with db.begin_nested():
            db.add(new_room)
        db.commit()
        db.refresh(new_room)
        return new_room
    except IntegrityError:
        existing = (
            db.query(ChatRoom)
            .filter(
                ChatRoom.room_type == "direct",
                ChatRoom.host_id == counselor_id,
                ChatRoom.name == str(client_id),
            )
            .first()
        )
        if existing is None:
            raise
        return existing


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
    # MB2-ORM-TXN-14: 방 생성과 참여자 등록을 단일 트랜잭션으로 커밋한다.
    # 분리 커밋이면 참여자 등록 중 실패 시 참여자 없는 고아 방이 영속된다.
    db.add(room)
    db.flush()  # commit 전에 room.id 확보
    for puid in participant_uuids:
        db.add(ChatRoomParticipant(room_id=room.id, user_id=puid))
    db.commit()
    db.refresh(room)
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


def _peer_ids_for_direct(room: ChatRoom, uid: UUID) -> str | None:
    """direct 방에서 uid 기준 상대방(peer)의 식별자 문자열을 반환한다.

    host(상담사)면 room.name(내담자 id), 내담자면 host_id. direct 가 아니면 None.
    """
    if room.room_type != "direct":
        return None
    if room.host_id == uid:
        return room.name
    return str(room.host_id) if room.host_id else None


def _build_room_serialize_cache(
    rooms: list[ChatRoom], user_id: str, db: DBSession
) -> dict:
    """방 목록을 `_serialize_room` 으로 일괄 직렬화하기 위한 배치 조회 캐시 (MB2-ORM-N1-03).

    방마다 개별 실행되던 상대 이름(User)·참여자 수·미읽음 수·세션 조회를 방 ID 집합 기준의
    단일 쿼리들로 한 번에 산출한다. 반환된 맵은 `_serialize_room(..., cache=...)` 에 주입한다.
    """
    uid = _uuid(user_id)
    room_ids = [r.id for r in rooms]
    peer_ids: set[UUID] = set()
    group_ids: list[UUID] = []
    session_ids: set[UUID] = set()
    for r in rooms:
        if r.room_type == "direct":
            pid = _peer_ids_for_direct(r, uid)
            if pid:
                peer_ids.add(_uuid(pid))
        elif r.room_type == "group":
            group_ids.append(r.id)
        elif r.session_id:
            session_ids.add(r.session_id)

    peer_names: dict[str, str] = {}
    if peer_ids:
        peer_names = {
            str(u.id): u.name
            for u in db.query(User).filter(User.id.in_(peer_ids)).all()
        }

    # 참여자 수 — 방 유형별(원 `_participant_count` 와 동일 의미)
    participant_counts: dict[str, int] = {}
    group_counts: dict = {}
    if group_ids:
        group_counts = {
            row[0]: row[1]
            for row in db.query(ChatRoomParticipant.room_id, func.count())
            .filter(ChatRoomParticipant.room_id.in_(group_ids))
            .group_by(ChatRoomParticipant.room_id)
            .all()
        }
    session_counts: dict = {}
    if session_ids:
        session_counts = {
            row[0]: row[1]
            for row in db.query(SessionParticipant.session_id, func.count())
            .filter(SessionParticipant.session_id.in_(session_ids))
            .group_by(SessionParticipant.session_id)
            .all()
        }
    for r in rooms:
        if r.room_type == "direct":
            participant_counts[str(r.id)] = 2  # host + client
        elif r.room_type == "group":
            participant_counts[str(r.id)] = int(group_counts.get(r.id, 0)) + (
                1 if r.host_id else 0
            )
        elif r.session_id:
            participant_counts[str(r.id)] = int(session_counts.get(r.session_id, 0))
        else:
            participant_counts[str(r.id)] = 0

    sessions: dict = {}
    if session_ids:
        sessions = {
            str(s.id): s for s in db.query(Session).filter(Session.id.in_(session_ids)).all()
        }

    # 미읽음 수 = 방 전체 메시지 수 − 사용자가 읽은 메시지 수 (원 `_unread_count` 와 동일)
    unread_counts: dict[str, int] = {}
    if room_ids:
        totals = {
            row[0]: row[1]
            for row in db.query(ChatMessage.room_id, func.count())
            .filter(ChatMessage.room_id.in_(room_ids))
            .group_by(ChatMessage.room_id)
            .all()
        }
        reads = {
            row[0]: row[1]
            for row in db.query(ChatMessage.room_id, func.count())
            .join(ChatMessageRead, ChatMessageRead.message_id == ChatMessage.id)
            .filter(
                ChatMessage.room_id.in_(room_ids),
                ChatMessageRead.user_id == uid,
            )
            .group_by(ChatMessage.room_id)
            .all()
        }
        for rid in room_ids:
            unread_counts[str(rid)] = max(
                int(totals.get(rid, 0)) - int(reads.get(rid, 0)), 0
            )

    return {
        "peer_names": peer_names,
        "participant_counts": participant_counts,
        "unread_counts": unread_counts,
        "sessions": sessions,
    }


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


def _serialize_room(
    room: ChatRoom,
    user_id: str,
    db: DBSession,
    last_msg=_LAST_MSG_UNSET,
    *,
    cache: dict | None = None,
) -> dict:
    """방 1건 직렬화.

    MB2-ORM-N1-03: `cache`(=`_build_room_serialize_cache` 결과)를 주입하면
    상대 이름·참여자 수·미읽음 수·세션 조회를 방 단위 개별 쿼리 없이 맵에서 꺼낸다.
    미주입 시(단건 경로) 기존과 동일하게 개별 조회로 폴백한다.
    """
    uid = _uuid(user_id)
    # 참여자 수 계산
    if cache is not None:
        count = cache["participant_counts"].get(str(room.id), 0)
    else:
        count = _participant_count(room, db)
    # 세션 방이면 세션 제목·일자 포함 (목록에서 세션 식별)
    session_title = None
    session_scheduled_at = None
    if room.session_id:
        if cache is not None:
            session = cache["sessions"].get(str(room.session_id))
        else:
            session = db.query(Session).filter(Session.id == room.session_id).first()
        if session:
            session_title = session.title
            session_scheduled_at = session.scheduled_at
    # ── SDD-090: 마지막 메시지 (목록은 일괄 조회 결과 주입, 단건 경로는 여기서 조회) ──
    if last_msg is _LAST_MSG_UNSET:
        last_msg = _last_messages_for_rooms([room.id], db).get(str(room.id))
    last_message, last_message_at = _last_message_preview(last_msg)
    # ── SDD-090: 표시 이름·이름 변경 권한 계산 ──
    if cache is not None:
        peer_name = cache["peer_names"].get(_peer_ids_for_direct(room, uid) or "")
    else:
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
    unread = (
        cache["unread_counts"].get(str(room.id), 0)
        if cache is not None
        else _unread_count(room, user_id, db)
    )
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
        "unread_count": unread,
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


def _legacy_unread_counts(msgs: list[ChatMessage], room: ChatRoom, db: DBSession) -> dict[str, int]:
    """recipient_count==0 인 레거시 메시지의 미읽음 수를 배치 계산한다 (MB2-ORM-N1-04).

    기존 `_message_unread_count` 를 메시지마다 호출하면 메시지 1건당 ChatMessageRead
    count + (그룹/세션) 참여자 count 쿼리가 발생해 행 수에 비례한 N+1 이었다.
    message_id IN 1회 GROUP BY 로 읽음 수를, 참여자 수는 방 단위 1회로 산출해 공유한다.
    반환 맵은 원 함수와 동일한 의미(직접방 2 − 읽음, 그룹/세션 참여자 − 읽음)를 갖는다.
    """
    legacy = [m for m in msgs if not (m.recipient_count or 0)]
    if not legacy:
        return {}
    ids = [m.id for m in legacy]
    read_counts = {
        mid: int(cnt)
        for mid, cnt in db.query(ChatMessageRead.message_id, func.count())
        .filter(ChatMessageRead.message_id.in_(ids))
        .group_by(ChatMessageRead.message_id)
        .all()
    }
    if room.room_type == "direct":
        return {
            str(m.id): max(2 - read_counts.get(m.id, 0), 0) for m in legacy
        }
    total_participants = _participant_count(room, db)
    return {
        str(m.id): max(total_participants - read_counts.get(m.id, 0), 0)
        for m in legacy
    }


def _refresh_read_cache(msgs: list[ChatMessage], db: DBSession) -> None:
    """read_by(JSONB 캐시)를 chat_message_reads(단일 진실원)에서 재계산한다 (MB2-ORM-MODEL-16).

    읽음 상태의 단일 진실원은 chat_message_reads 테이블이며, chat_messages.read_by 는
    조회 성능을 위한 파생 캐시다. 기존에는 mark_read/mark_messages_read 가 read_by 를
    직접 append 하고 테이블에도 별도로 기록해 두 저장소가 어긋날 수 있었다. 모든 읽음
    갱신 경로가 이 함수 하나로 캐시를 재구성하므로 두 저장소가 항상 일치한다.
    """
    if not msgs:
        return
    ids = [m.id for m in msgs]
    rows = (
        db.query(ChatMessageRead.message_id, ChatMessageRead.user_id)
        .filter(ChatMessageRead.message_id.in_(ids))
        .all()
    )
    by_msg: dict = {}
    for mid, uid in rows:
        by_msg.setdefault(mid, []).append(str(uid))
    for m in msgs:
        m.read_by = by_msg.get(m.id, [])


def list_my_rooms(user_id: str, db: DBSession) -> list[dict]:
    uid = _uuid(user_id)
    rooms: list[ChatRoom] = []

    # ── SDD-091: 세션별 자동 채팅방 제거 → 회원별 1:1 개인방 기본 생성 ──
    # 상담사: 연결된 내담자마다 개인(1:1) 방
    linked_client_ids = [
        l.client_id
        for l in db.query(ClientCounselorLink)
        .filter(ClientCounselorLink.counselor_id == uid)
        .all()
    ]
    for cid in linked_client_ids:
        rooms.append(get_or_create_direct_room(uid, cid, db))

    # 내담자: 연결된 상담사마다 개인(1:1) 방
    linked_counselor_ids = [
        l.counselor_id
        for l in db.query(ClientCounselorLink)
        .filter(ClientCounselorLink.client_id == uid)
        .all()
    ]
    for cid in linked_counselor_ids:
        rooms.append(get_or_create_direct_room(cid, uid, db))

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

    # 중복 제거 (직접방이 양쪽 루프에서 겹치지 않지만 안전하게)
    seen: dict[UUID, ChatRoom] = {}
    for r in rooms:
        seen.setdefault(r.id, r)

    # ── SDD-090: 방별 마지막 메시지 일괄 조회 후 주입 (방마다 개별 쿼리 금지) ──
    # MB2-ORM-N1-03: 상대 이름·참여자 수·미읽음 수·세션도 캐시로 일괄 산출해
    # _serialize_room 이 방마다 개별 쿼리(N+1)를 하지 않게 한다.
    room_list = list(seen.values())
    last_map = _last_messages_for_rooms([r.id for r in room_list], db)
    cache = _build_room_serialize_cache(room_list, user_id, db)
    result = [
        _serialize_room(r, user_id, db, last_msg=last_map.get(str(r.id)), cache=cache)
        for r in room_list
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


def _can_invite_room(room: ChatRoom, uid: UUID, db: DBSession) -> bool:
    """초대 권한 판별 (SDD-092) — ① 방의 host ② 기관 관리자(org_admin).

    org_admin 은 host 와 같은 기관의 active 멤버십을 공유해야 한다.
    """
    if room.host_id == uid:
        return True
    if not room.host_id:
        return False
    actor = db.query(User).filter(User.id == uid).first()
    if not actor or actor.role != "org_admin" or actor.status != "active":
        return False
    return _share_org_counselor(room.host_id, uid, db)


def _ensure_invite_room(
    room_id: str, user_id: str, db: DBSession, *, allow_direct: bool = False
) -> tuple[ChatRoom, UUID]:
    """초대 계열(참여자 추가/fork) 방·권한 검증 (SDD-092).

    - allow_direct=False: group 방만 (기존 방에 추가)
    - allow_direct=True: direct 방도 허용 (fork 전용 — direct 는 새 방으로만)
    """
    rid = _uuid(room_id)
    room = db.query(ChatRoom).filter(ChatRoom.id == rid).first()
    if not room:
        raise HTTPException(status_code=404, detail="채팅방을 찾을 수 없습니다")
    if room.room_type != "group" and not (allow_direct and room.room_type == "direct"):
        raise HTTPException(status_code=403, detail="그룹 채팅방만 참여자를 관리할 수 있습니다")
    uid = _uuid(user_id)
    if not _can_invite_room(room, uid, db):
        raise HTTPException(status_code=403, detail="방장 또는 기관 관리자만 참여자를 초대할 수 있습니다")
    return room, uid


def _validate_invitee(host_uuid: UUID, target_uuid: UUID, db: DBSession) -> None:
    """초대 대상 검증 (SDD-092) — 서버가 User.role 로 분기.

    - client: 기존 정책(Link OR 공유 기관) 그대로 — 에러 메시지 하위 호환
    - counselor/org_admin: 계정 active + host 와 공유 기관 active 멤버십
    - 그 외(platform_admin 등): 403
    """
    target = db.query(User).filter(User.id == target_uuid).first()
    if not target:
        raise HTTPException(status_code=404, detail="초대할 사용자를 찾을 수 없습니다")
    if target.role == "client":
        link = (
            db.query(ClientCounselorLink)
            .filter(
                ClientCounselorLink.counselor_id == host_uuid,
                ClientCounselorLink.client_id == target_uuid,
            )
            .first()
        )
        if not link and not _share_org(host_uuid, target_uuid, db):
            raise HTTPException(status_code=403, detail="연결되지 않은 내담자가 포함되어 있습니다")
        return
    if target.role in ("counselor", "org_admin"):
        if target.status != "active" or not _share_org_counselor(host_uuid, target_uuid, db):
            raise HTTPException(status_code=403, detail="같은 기관에 소속된 상담사만 초대할 수 있습니다")
        return
    raise HTTPException(status_code=403, detail="초대할 수 없는 사용자입니다")


def add_room_participants(room_id: str, user_id: str, participant_ids: list[str], db: DBSession) -> dict:
    """그룹방 참여자 추가 (SDD-090, SDD-092 확장).

    - 권한: host OR 기관 관리자(org_admin)
    - 대상: 내담자(기존 경로 하위 호환) + 상담사(공유 기관 active)
    - 검증 기준은 항상 방의 host — org_admin 이 초대해도 host 기준으로 판정한다
    """
    room, uid = _ensure_invite_room(room_id, user_id, db)
    existing = {
        p.user_id
        for p in db.query(ChatRoomParticipant)
        .filter(ChatRoomParticipant.room_id == room.id)
        .all()
    }
    invited_ids: list[UUID] = []
    for pid in participant_ids:
        puid = _uuid(pid)
        if puid == uid or puid == room.host_id or puid in existing:
            continue
        _validate_invitee(room.host_id, puid, db)
        db.add(ChatRoomParticipant(room_id=room.id, user_id=puid))
        existing.add(puid)
        invited_ids.append(puid)
    db.commit()
    # SDD-093: 초대받은 회원에게 chat_room_invited 알림 발화 (best-effort)
    for puid in invited_ids:
        try:
            from app.services.notification_service import notify_event, build_standard_extra

            notify_event(
                "chat_room_invited",
                puid,
                {
                    "title": "채팅방에 초대되었습니다",
                    "body": f"{room.name or '채팅방'}에 초대되었습니다.",
                    "extra": build_standard_extra(
                        "chat_room_invited",
                        "chat_room",
                        str(room.id),
                        params={"inviter_id": str(uid)},
                    ),
                },
                db,
            )
        except Exception:  # noqa: BLE001
            # MB-ERR-004: 초대 알림 발화 실패를 삼키지 않고 로그로 남긴다.
            logger.exception(
                "[chat_service] 채팅방 초대 알림 발화 실패: room_id=%s user_id=%s",
                room.id,
                puid,
            )
    return _serialize_room(room, user_id, db)


def fork_group_room(
    room_id: str, user_id: str, participant_ids: list[str], name: str | None, db: DBSession
) -> dict:
    """"새 방으로 만들기" (SDD-092) — 기존 참여자 승계 + 새 참여자 → 새 group 방.

    - 대화 이력은 복사하지 않으며 기존 방은 그대로 유지한다
    - direct 방도 fork 허용: host + 기존 상대(room.name=client_id) + 새 참여자 → 새 group 방
    - 기존 참여자는 재검증 없이 승계 — 자격 상실 시에도 자동 제거하지 않는 현행 정책과 일관
    - 새 방의 host 는 원본 방의 host 를 승계한다 (org_admin 이 fork 해도 동일)
    """
    room, uid = _ensure_invite_room(room_id, user_id, db, allow_direct=True)
    host_uuid = room.host_id

    if room.room_type == "direct":
        # direct 방의 상대 내담자 식별자는 name 필드에 저장되어 있다
        inherited = [_uuid(room.name)] if room.name else []
    else:
        inherited = [
            p.user_id
            for p in db.query(ChatRoomParticipant)
            .filter(ChatRoomParticipant.room_id == room.id)
            .all()
        ]
    carried = set(inherited)

    new_uuids: list[UUID] = []
    for pid in participant_ids:
        puid = _uuid(pid)
        if puid == host_uuid or puid in carried:
            continue
        _validate_invitee(host_uuid, puid, db)
        new_uuids.append(puid)
        carried.add(puid)
    if not new_uuids:
        raise HTTPException(status_code=422, detail="새로 초대할 참여자를 1명 이상 선택해야 합니다")

    if not name:
        # 서버 기본 이름 — 원본 표시 이름 기반, name 컬럼 길이(120자) 내로 절단
        if room.room_type == "direct":
            base = room.display_name or _peer_name_for_direct(room, host_uuid, db) or "1:1 채팅"
        else:
            base = room.name or "그룹 채팅"
        suffix = " (새 채팅)"
        name = base[: 120 - len(suffix)] + suffix

    new_room = ChatRoom(
        session_id=None,
        room_type="group",
        host_id=host_uuid,
        name=name,
    )
    db.add(new_room)
    db.commit()
    db.refresh(new_room)
    for puid in inherited + new_uuids:
        db.add(ChatRoomParticipant(room_id=new_room.id, user_id=puid))
    db.commit()
    # SDD-093: 새 참여자에게 chat_room_invited 알림 발화 (best-effort)
    for puid in new_uuids:
        try:
            from app.services.notification_service import notify_event, build_standard_extra

            notify_event(
                "chat_room_invited",
                puid,
                {
                    "title": "채팅방에 초대되었습니다",
                    "body": f"{new_room.name or '채팅방'}에 초대되었습니다.",
                    "extra": build_standard_extra(
                        "chat_room_invited",
                        "chat_room",
                        str(new_room.id),
                        params={"inviter_id": str(uid)},
                    ),
                },
                db,
            )
        except Exception:  # noqa: BLE001
            # MB-ERR-004: 새 방 초대 알림 발화 실패를 삼키지 않고 로그로 남긴다.
            logger.exception(
                "[chat_service] 채팅방 초대 알림 발화 실패: room_id=%s user_id=%s",
                new_room.id,
                puid,
            )
    return _serialize_room(new_room, user_id, db)


def list_invitable_counselors(
    user_id: str, q: str | None, db: DBSession, page: int = 1, size: int = 50
) -> dict:
    """초대 후보 상담사 조회 (SDD-092) — 요청자와 공유 기관의 active 상담사.

    - 권한: counselor/org_admin (본인 멤버십 기반이라 org_id 파라미터 불필요)
    - 본인 제외, User.status='active' + active 멤버십만
    - org_names 는 요청자와 공유하는 기관 이름만 담는다 (타 기관 소속 정보 비노출)
    """
    uid = _uuid(user_id)
    me = db.query(User).filter(User.id == uid).first()
    if not me or me.role not in ("counselor", "org_admin"):
        raise HTTPException(status_code=403, detail="상담사만 초대 후보를 조회할 수 있습니다")
    my_org_ids = {
        m.org_id
        for m in db.query(UserOrgMembership)
        .filter(
            UserOrgMembership.user_id == uid,
            UserOrgMembership.status == "active",
        )
        .all()
    }
    if not my_org_ids:
        return {"counselors": [], "total": 0, "page": page}
    query = (
        db.query(User, Organization.name)
        .join(UserOrgMembership, UserOrgMembership.user_id == User.id)
        .join(Organization, Organization.id == UserOrgMembership.org_id)
        .filter(
            UserOrgMembership.org_id.in_(my_org_ids),
            UserOrgMembership.status == "active",
            User.status == "active",
            User.role.in_(("counselor", "org_admin")),
            User.id != uid,
        )
    )
    if q and q.strip():
        query = query.filter(User.name.ilike(f"%{q.strip()}%"))
    # VB-04: 필터된 전체를 .all() 로 메모리에 적재한 뒤 파이썬 슬라이스하던 것을
    # DB 레벨 LIMIT/OFFSET 페이징으로 이관한다. total 은 중복 제거된 사용자 수.
    total = query.with_entities(User.id).distinct().count()
    page = max(page, 1)
    size = max(size, 1)
    page_ids = [
        row[0]
        for row in (
            query.with_entities(User.id)
            .distinct()
            .order_by(User.name.asc(), User.id.asc())
            .offset((page - 1) * size)
            .limit(size)
            .all()
        )
    ]
    if not page_ids:
        return {"counselors": [], "total": total, "page": page}
    # 요청 페이지의 사용자만 대상으로 (사용자, 기관명) 행을 조회해 org_names 를 구성한다.
    rows = (
        db.query(User, Organization.name)
        .join(UserOrgMembership, UserOrgMembership.user_id == User.id)
        .join(Organization, Organization.id == UserOrgMembership.org_id)
        .filter(
            UserOrgMembership.org_id.in_(my_org_ids),
            UserOrgMembership.status == "active",
            User.id.in_(page_ids),
        )
        .all()
    )
    result: dict[str, dict] = {}
    for user, org_name in rows:
        entry = result.setdefault(
            str(user.id),
            {"user_id": str(user.id), "name": user.name, "role": user.role, "org_names": []},
        )
        if org_name not in entry["org_names"]:
            entry["org_names"].append(org_name)
    counselors = sorted(result.values(), key=lambda c: (c["name"], c["user_id"]))
    return {
        "counselors": counselors,
        "total": total,
        "page": page,
    }


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
    # SDD-093: 내보내진 회원에게 chat_room_removed 알림 발화 (best-effort)
    try:
        from app.services.notification_service import notify_event, build_standard_extra

        notify_event(
            "chat_room_removed",
            tuid,
            {
                "title": "채팅방에서 내보내졌습니다",
                "body": f"{room.name or '채팅방'}에서 내보내졌습니다.",
                "extra": build_standard_extra(
                    "chat_room_removed",
                    "notice",
                    str(room.id),
                    params={"removed_by": str(uid)},
                ),
            },
            db,
        )
    except Exception:  # noqa: BLE001
        # MB-ERR-004: 내보내기 알림 발화 실패를 삼키지 않고 로그로 남긴다.
        logger.exception(
            "[chat_service] 채팅방 내보내기 알림 발화 실패: room_id=%s user_id=%s",
            room.id,
            tuid,
        )


def get_room_participants(room_id: str, user_id: str, db: DBSession) -> list[dict]:
    """그룹방 참여자 명단 조회 (SDD-090/092). host 또는 기관 관리자."""
    room, _uid = _ensure_invite_room(room_id, user_id, db, allow_direct=True)
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
            # SDD-092: 상담사/내담자 구분 — 컬럼 추가 없이 User.role JOIN 값 노출
            "role": u.role if u else None,
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
    # MB2-ORM-N1-01: 발신자 이름을 1회 배치 조회하고 방 1건을 재사용해 N+1 을 제거한다.
    sender_names = _sender_names_for_messages(msgs, db)
    return [_serialize_msg(m, db, sender_names=sender_names, room=room) for m in msgs]


def get_message_context(
    room_id: str, message_id: str, user_id: str, db: DBSession,
    before: int = 20, after: int = 20,
) -> dict:
    """메시지 주변을 시간순으로 반환한다. 커서는 다음 조회의 앵커 메시지 ID다."""
    rid = _uuid(room_id)
    room = db.query(ChatRoom).filter(ChatRoom.id == rid).first()
    if not room:
        raise HTTPException(status_code=404, detail="채팅방을 찾을 수 없습니다")
    # 같은 상담사에게 연결된 다른 내담자는 이 1:1 방의 멤버가 아니다.
    if room.room_type == "direct" and str(_uuid(user_id)) not in (str(room.host_id), room.name):
        raise HTTPException(status_code=403, detail="채팅방 접근 권한이 없습니다")
    _ensure_member(room, user_id, db)
    # 메시지의 존재 여부를 확인하기 전에 방 접근 권한부터 검증한다.
    mid = _uuid(message_id)
    message = db.query(ChatMessage).filter(
        ChatMessage.room_id == rid, ChatMessage.id == mid,
    ).first()
    if not message:
        raise HTTPException(status_code=404, detail="메시지를 찾을 수 없습니다")
    if not 0 <= before <= 50 or not 0 <= after <= 50:
        raise HTTPException(status_code=422, detail="주변 메시지 개수는 0~50이어야 합니다")
    base = db.query(ChatMessage).filter(ChatMessage.room_id == rid)
    previous = base.filter(or_(
        ChatMessage.created_at < message.created_at,
        and_(ChatMessage.created_at == message.created_at, ChatMessage.id < mid),
    )).order_by(ChatMessage.created_at.desc(), ChatMessage.id.desc()).limit(before + 1).all()
    following = base.filter(or_(
        ChatMessage.created_at > message.created_at,
        and_(ChatMessage.created_at == message.created_at, ChatMessage.id > mid),
    )).order_by(ChatMessage.created_at.asc(), ChatMessage.id.asc()).limit(after + 1).all()
    previous_page = list(reversed(previous[:before]))
    following_page = following[:after]
    # MB2-ORM-N1-01: 응답 내 모든 메시지의 발신자 이름을 1회 배치 조회한다.
    all_msgs = [message, *previous_page, *following_page]
    sender_names = _sender_names_for_messages(all_msgs, db)
    return {
        "message": _serialize_msg(message, db, sender_names=sender_names, room=room),
        "before": [
            _serialize_msg(m, db, sender_names=sender_names, room=room) for m in previous_page
        ],
        "after": [
            _serialize_msg(m, db, sender_names=sender_names, room=room) for m in following_page
        ],
        "before_cursor": str(previous_page[0].id) if previous_page and len(previous) > before else None,
        "after_cursor": str(following_page[-1].id) if following_page and len(following) > after else None,
    }


def _mark_message_notifications_read(
    room_id: UUID, user_id: UUID, message_ids: list[UUID], db: DBSession,
) -> None:
    """실제로 읽은 메시지와 연결된 표준 알림만 갱신한다."""
    from app.models.notification import Notification

    if not message_ids:
        return
    db.query(Notification).filter(
        Notification.user_id == user_id,
        Notification.type == "chat",
        Notification.is_read.is_(False),
        Notification.extra["event_type"].astext == "chat_message",
        Notification.extra["target_type"].astext == "chat_room",
        Notification.extra["target_id"].astext == str(room_id),
        Notification.extra["params"]["message_id"].astext.in_([str(mid) for mid in message_ids]),
    ).update({"is_read": True}, synchronize_session=False)


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
    # 클래스 채팅 off 면 참여자 발신 차단 (host 는 예외)
    _ensure_session_chat_enabled(room, user_id, db)
    if not content or not content.strip():
        raise HTTPException(status_code=422, detail="메시지 내용이 비어있습니다")
    msg = ChatMessage(
        room_id=rid,
        sender_id=_uuid(user_id),
        type=msg_type or "text",
        content=content,
        file_url=file_url,
    )
    # MB2-ORM-TXN-13: 본문 저장과 읽음 메타(recipient_count/read_by/ChatMessageRead)를
    # 단일 트랜잭션으로 커밋한다. 분리 커밋이면 두 커밋 사이 실패 시
    # recipient_count=0·read_by=None 인 부분 상태 메시지가 남는다.
    db.add(msg)
    db.flush()  # commit 전에 msg.id 확보
    sender_uid = _uuid(user_id)
    recipients = _resolve_recipients(room, sender_uid, db)
    msg.recipient_count = len(recipients) + 1  # 발신자 포함 전체 인원
    # 읽음 상태의 단일 진실원은 chat_message_reads — 발신자 자동 읽음을 테이블에 기록하고
    # read_by 캐시를 여기서 파생한다 (MB2-ORM-MODEL-16).
    db.add(ChatMessageRead(message_id=msg.id, user_id=sender_uid))
    db.flush()
    _refresh_read_cache([msg], db)
    db.commit()
    db.refresh(msg)

    # ── 수신자 알림 생성 ──
    try:
        from app.services.notification_service import notify_event, build_standard_extra
        sender = db.query(User).filter(User.id == sender_uid).first()
        sender_display = sender.name if sender else "사용자"
        for recipient_id in recipients:
            notif = notify_event(
                "chat_message",
                recipient_id,
                {
                    "title": f"{sender_display}님의 메시지",
                    "body": content[:100] if content else "새 메시지가 도착했습니다",
                    "extra": build_standard_extra(
                        "chat_message",
                        "chat_room",
                        str(rid),
                        params={"message_id": str(msg.id)},
                        legacy={"room_id": str(rid), "sender_id": user_id},
                    ),
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
    # MB2-ORM-MODEL-16: read_by 캐시를 단일 진실원(chat_message_reads)에서 재구성한다.
    db.flush()
    _refresh_read_cache(msgs, db)
    _mark_message_notifications_read(rid, uid, [m.id for m in msgs], db)
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
    for m in msgs:
        # ChatMessageRead 테이블에 기록 (단일 진실원)
        if m.id not in existing:
            db.add(ChatMessageRead(message_id=m.id, user_id=uid))

    # MB2-ORM-MODEL-16: read_by 캐시를 단일 진실원(chat_message_reads)에서 재구성한다.
    db.flush()
    _refresh_read_cache(msgs, db)

    updates = []
    for m in msgs:
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

    _mark_message_notifications_read(rid, uid, [m.id for m in msgs], db)
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
    # MB2-ORM-N1-04: 레거시(recipient_count==0) 메시지 미읽음 수를 배치로 1회 계산한다.
    legacy_counts = _legacy_unread_counts(msgs, room, db)
    result: dict[str, int] = {}
    for m in msgs:
        read_by_list = m.read_by or []
        rc = m.recipient_count or 0
        if rc > 0:
            result[str(m.id)] = max(rc - len(read_by_list), 0)
        else:
            # 하위 호환: recipient_count가 0인 경우 ChatMessageRead 기반 계산(배치 맵)
            result[str(m.id)] = legacy_counts.get(str(m.id), 0)
    return result
