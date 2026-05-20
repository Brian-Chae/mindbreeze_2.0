"""시스템 메시지 발송 — 예약/취소/리포트 자동 알림"""

from uuid import UUID

from sqlalchemy.orm import Session as DBSession

from app.models.chat import ChatMessage
from app.services.chat_service import get_or_create_room_by_session


def send_system_message(session_id: UUID, content: str, event_type: str, db: DBSession) -> ChatMessage:
    room = get_or_create_room_by_session(session_id, db)
    msg = ChatMessage(
        room_id=room.id,
        sender_id=None,
        type="system",
        content=content,
        event_type=event_type,
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)
    return msg
