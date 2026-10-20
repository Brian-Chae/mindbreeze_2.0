"""채팅 신고·상호 차단 (SDD-220).

- 신고하면 같은 트랜잭션에서 ChatReport + ChatBlock(상호) + 운영 알림 outbox 를 만든다.
- 차단 판정은 모두 서버에서 한다. 프론트 숨김만으로 통과시키지 않는다(REST·WS·초대·미읽음·preview).
- 탈퇴(status=deleted) 사용자는 "탈퇴한 사용자"로 표시한다.
"""

import logging
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DBSession

from app.config import settings
from app.models.chat import (
    ChatBlock,
    ChatMessage,
    ChatReport,
    ChatRoom,
    ChatRoomParticipant,
)
from app.models.notification_outbox import NotificationOutbox
from app.models.session import Session, SessionParticipant
from app.models.user import User

logger = logging.getLogger(__name__)

DELETED_USER_NAME = "탈퇴한 사용자"
REPORT_REASONS = ("abuse", "spam", "sexual", "privacy", "other")
_EXCERPT_MAX = 500


def blocked_error() -> HTTPException:
    return HTTPException(
        status_code=403,
        detail={"code": "CHAT_BLOCKED", "message": "차단된 사용자와는 대화할 수 없습니다"},
    )


def display_user_name(name: str | None, status: str | None) -> str | None:
    """탈퇴한 사용자는 이름 대신 고정 문구를 보여준다."""
    if status == "deleted":
        return DELETED_USER_NAME
    return name


# ── 차단 조회 ──


def _uid(v) -> UUID:
    return v if isinstance(v, UUID) else UUID(str(v))


def pair_key(a, b) -> tuple[UUID, UUID]:
    """(작은 id, 큰 id) 로 정규화한다. PostgreSQL uuid 정렬 = 소문자 hex 문자열 정렬."""
    ua, ub = _uid(a), _uid(b)
    return (ua, ub) if str(ua) < str(ub) else (ub, ua)


def blocked_user_ids(user_id, db: DBSession) -> set[UUID]:
    """user 와 (어느 방향이든) 차단 관계인 모든 사용자 id."""
    uid = _uid(user_id)
    rows = (
        db.query(ChatBlock.user_low_id, ChatBlock.user_high_id)
        .filter(or_(ChatBlock.user_low_id == uid, ChatBlock.user_high_id == uid))
        .all()
    )
    result: set[UUID] = set()
    for low, high in rows:
        result.add(high if _uid(low) == uid else low)
    return result


def is_blocked(a, b, db: DBSession) -> bool:
    low, high = pair_key(a, b)
    return (
        db.query(ChatBlock.id)
        .filter(ChatBlock.user_low_id == low, ChatBlock.user_high_id == high)
        .first()
        is not None
    )


def ensure_not_blocked(a, b, db: DBSession) -> None:
    if is_blocked(a, b, db):
        raise blocked_error()


def ensure_no_block_with(user_id, others, db: DBSession) -> None:
    """user 가 others 중 누구와도 차단 관계가 아니어야 한다."""
    others_set = {_uid(o) for o in others if o}
    if others_set and blocked_user_ids(user_id, db) & others_set:
        raise blocked_error()


def ensure_no_block_among(user_ids, db: DBSession) -> None:
    """주어진 사용자 집합 안에 차단 pair 가 하나라도 있으면 403 CHAT_BLOCKED."""
    ids = {_uid(u) for u in user_ids if u}
    if len(ids) < 2:
        return
    rows = (
        db.query(ChatBlock.id)
        .filter(ChatBlock.user_low_id.in_(ids), ChatBlock.user_high_id.in_(ids))
        .first()
    )
    if rows is not None:
        raise blocked_error()


# ── 방 구성원 ──


def room_member_ids(room: ChatRoom, db: DBSession) -> set[UUID]:
    """방의 모든 구성원 id (host 포함)."""
    members: set[UUID] = set()
    if room.room_type == "direct":
        if room.host_id:
            members.add(room.host_id)
        if room.name:
            try:
                members.add(UUID(str(room.name)))
            except ValueError:
                pass
    elif room.room_type == "group":
        if room.host_id:
            members.add(room.host_id)
        for (uid,) in db.query(ChatRoomParticipant.user_id).filter(
            ChatRoomParticipant.room_id == room.id
        ):
            members.add(uid)
    elif room.session_id:
        session = db.query(Session).filter(Session.id == room.session_id).first()
        if session and session.host_id:
            members.add(session.host_id)
        for (uid,) in db.query(SessionParticipant.user_id).filter(
            SessionParticipant.session_id == room.session_id,
            SessionParticipant.user_id.isnot(None),
        ):
            members.add(uid)
    return members


def blocked_members_of(room: ChatRoom, user_id, db: DBSession) -> set[UUID]:
    """방 구성원 중 user 와 차단 관계인 사람."""
    blocked = blocked_user_ids(user_id, db)
    if not blocked:
        return set()
    return room_member_ids(room, db) & blocked


# ── 신고 ──


def _result(report: ChatReport) -> dict:
    return {"reported": True, "blocked": True, "report_id": str(report.id)}


def _resolve_target_context(
    reporter: UUID,
    target: UUID,
    room_id: str | None,
    message_id: str | None,
    db: DBSession,
) -> tuple[ChatRoom | None, ChatMessage | None]:
    """신고 권한: 신고자가 속한 방에서 대상을 만난 경우만 허용한다. 아니면 404."""
    from app.services.chat_service import get_user_chat_room_ids

    not_found = HTTPException(status_code=404, detail="신고 대상을 찾을 수 없습니다")
    my_rooms = {UUID(r) for r in get_user_chat_room_ids(str(reporter), db)}

    message: ChatMessage | None = None
    room: ChatRoom | None = None
    if message_id:
        try:
            mid = UUID(str(message_id))
        except ValueError:
            raise not_found
        message = db.query(ChatMessage).filter(ChatMessage.id == mid).first()
        if message is None or message.room_id not in my_rooms or message.sender_id != target:
            raise not_found
        room = db.query(ChatRoom).filter(ChatRoom.id == message.room_id).first()
    elif room_id:
        try:
            rid = UUID(str(room_id))
        except ValueError:
            raise not_found
        if rid not in my_rooms:
            raise not_found
        room = db.query(ChatRoom).filter(ChatRoom.id == rid).first()
        if room is None or target not in room_member_ids(room, db):
            raise not_found
    else:
        # 상대 프로필에서 신고: 신고자의 어떤 방에든 대상이 있으면 된다.
        for r in db.query(ChatRoom).filter(ChatRoom.id.in_(my_rooms)).all() if my_rooms else []:
            if target in room_member_ids(r, db):
                room = r
                break
        if room is None:
            raise not_found
    return room, message


def report_user(
    reporter_id: str,
    target_user_id: str,
    *,
    room_id: str | None,
    message_id: str | None,
    reason: str | None,
    operation_key: str | None,
    db: DBSession,
) -> dict:
    """신고 + 상호 차단 + 운영 알림 outbox 를 한 트랜잭션으로 만든다."""
    try:
        reporter = UUID(str(reporter_id))
        target = UUID(str(target_user_id))
    except ValueError:
        raise HTTPException(status_code=404, detail="신고 대상을 찾을 수 없습니다")
    if reporter == target:
        raise HTTPException(
            status_code=422,
            detail={"code": "INVALID_REPORT_TARGET", "message": "본인은 신고할 수 없습니다"},
        )
    if reason is not None and reason not in REPORT_REASONS:
        raise HTTPException(status_code=422, detail="지원하지 않는 신고 사유입니다")

    key = (operation_key or "").strip() or f"auto:{uuid4()}"
    # 같은 operation 재전송: 새로 만들지 않고 이전 결과를 돌려준다.
    existing = (
        db.query(ChatReport)
        .filter(ChatReport.reporter_id == reporter, ChatReport.operation_key == key)
        .first()
    )
    if existing is not None:
        return _result(existing)

    room, message = _resolve_target_context(reporter, target, room_id, message_id, db)
    reported_user = db.query(User).filter(User.id == target).first()
    if reported_user is None:
        raise HTTPException(status_code=404, detail="신고 대상을 찾을 수 없습니다")

    try:
        report = ChatReport(
            reporter_id=reporter,
            reported_user_id=target,
            room_id=room.id if room else None,
            message_id=message.id if message else None,
            reason=reason,
            message_excerpt=(message.content or "")[:_EXCERPT_MAX] if message else None,
            operation_key=key,
        )
        db.add(report)
        db.flush()

        low, high = pair_key(reporter, target)
        if (
            db.query(ChatBlock.id)
            .filter(ChatBlock.user_low_id == low, ChatBlock.user_high_id == high)
            .first()
            is None
        ):
            try:
                with db.begin_nested():
                    db.add(
                        ChatBlock(
                            user_low_id=low,
                            user_high_id=high,
                            blocker_id=reporter,
                            report_id=report.id,
                        )
                    )
            except IntegrityError:
                # 동시 신고가 먼저 같은 pair 를 만들었다 — unique 가 지켜졌으므로 그대로 둔다.
                logger.info("chat_blocks pair already created concurrently (pair=%s,%s)", low, high)

        # 운영 알림: 본문에는 대화 내용을 싣지 않고 신고 ID 로 DB 를 조회하게 한다.
        db.add(
            NotificationOutbox(
                user_id=reporter,
                channel="email",
                recipient=settings.signup_notice_email,
                payload={
                    "subject": "[MIND BREEZE] 채팅 신고가 접수되었습니다",
                    "body": (
                        f"신고 ID: {report.id}\n"
                        f"신고자 ID: {reporter}\n"
                        f"대상 ID: {target}\n"
                        f"사유: {reason or '미선택'}\n"
                        f"방 ID: {room.id if room else '-'}\n"
                        f"메시지 ID: {message.id if message else '-'}\n"
                        "chat_reports 테이블에서 내용을 확인해 주세요."
                    ),
                    "kind": "chat_report",
                    "report_id": str(report.id),
                },
                status="pending",
            )
        )
        db.commit()
    except IntegrityError:
        # 같은 operation 이 동시에 들어온 경우 — 먼저 커밋된 신고를 돌려준다.
        db.rollback()
        existing = (
            db.query(ChatReport)
            .filter(ChatReport.reporter_id == reporter, ChatReport.operation_key == key)
            .first()
        )
        if existing is None:
            raise
        return _result(existing)
    except Exception:
        db.rollback()
        raise
    return _result(report)
