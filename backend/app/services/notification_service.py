"""알림 서비스 — 인앱 + 이메일 라우팅"""

import logging
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session as DBSession

from app.models.notification import Notification
from app.models.user import User, DEFAULT_NOTIFICATION_PREFERENCES
from app.tasks.email import _send_email

logger = logging.getLogger(__name__)


EVENT_TO_NOTIF_TYPE: dict[str, str] = {
    "session_booked": "session",
    "session_updated": "session",
    "session_cancelled": "session",
    "chat_message": "chat",
    "report_ready": "report",
    "verification_result": "verification",
}


def _to_uuid(value: str | UUID) -> UUID:
    try:
        return value if isinstance(value, UUID) else UUID(str(value))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="잘못된 ID 형식입니다")


def _get_pref_event_key(event_type: str) -> str:
    return event_type.replace("session_updated", "session_booked")


def get_user_preferences(user: User) -> dict[str, dict[str, bool]]:
    prefs = user.notification_preferences
    if not isinstance(prefs, dict):
        return {
            "email": dict(DEFAULT_NOTIFICATION_PREFERENCES["email"]),
            "in_app": dict(DEFAULT_NOTIFICATION_PREFERENCES["in_app"]),
        }
    return {
        "email": {**DEFAULT_NOTIFICATION_PREFERENCES["email"], **(prefs.get("email") or {})},
        "in_app": {**DEFAULT_NOTIFICATION_PREFERENCES["in_app"], **(prefs.get("in_app") or {})},
    }


def create_notification(
    user_id: str | UUID,
    notif_type: str,
    title: str,
    body: str | None,
    db: DBSession,
    extra: dict[str, Any] | None = None,
) -> Notification:
    notif = Notification(
        user_id=_to_uuid(user_id),
        type=notif_type,
        title=title,
        body=body,
        extra=extra,
    )
    db.add(notif)
    db.flush()
    return notif


def send_email_notification(to_email: str, subject: str, body: str) -> bool:
    for attempt in range(3):
        try:
            ok = _send_email(to_email, subject, body)
            if ok:
                return True
        except Exception as e:  # noqa: BLE001
            logger.warning(f"[NOTIF EMAIL] 발송 실패 (시도 {attempt + 1}/3): {e}")
    logger.error(f"[NOTIF EMAIL] 최종 실패 → {to_email}")
    return False


def _build_email_content(event_type: str, data: dict[str, Any]) -> tuple[str, str, str]:
    """(notif_type, subject, body) 반환"""
    title = data.get("title", "")
    body = data.get("body", "")
    notif_type = EVENT_TO_NOTIF_TYPE.get(event_type, "system")
    subject = f"[MIND BREEZE] {title}" if title else "[MIND BREEZE] 알림"
    return notif_type, subject, body


def notify_event(
    event_type: str,
    user_id: str | UUID,
    data: dict[str, Any],
    db: DBSession,
) -> Notification | None:
    """이벤트 → 인앱 알림 + (설정 시) 이메일 발송"""
    user = db.query(User).filter(User.id == _to_uuid(user_id)).first()
    if not user:
        return None

    prefs = get_user_preferences(user)
    pref_key = _get_pref_event_key(event_type)
    notif_type, subject, body_text = _build_email_content(event_type, data)
    title = data.get("title", "")
    body_message = data.get("body", "")
    extra = data.get("extra")

    notif: Notification | None = None
    if prefs["in_app"].get(pref_key, True):
        notif = create_notification(user.id, notif_type, title, body_message, db, extra=extra)

    if prefs["email"].get(pref_key, False) and user.email:
        send_email_notification(user.email, subject, body_text or body_message or title)

    return notif


def list_notifications(
    user_id: str,
    db: DBSession,
    only_unread: bool = False,
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:
    uid = _to_uuid(user_id)
    base = db.query(Notification).filter(Notification.user_id == uid)
    if only_unread:
        base = base.filter(Notification.is_read.is_(False))
    total = base.count()
    items = base.order_by(Notification.created_at.desc()).offset(offset).limit(limit).all()
    unread = (
        db.query(Notification)
        .filter(Notification.user_id == uid, Notification.is_read.is_(False))
        .count()
    )
    return {
        "notifications": [
            {
                "id": str(n.id),
                "type": n.type,
                "title": n.title,
                "body": n.body,
                "is_read": bool(n.is_read),
                "extra": n.extra,
                "created_at": n.created_at,
            }
            for n in items
        ],
        "total": total,
        "unread": unread,
    }


def unread_count(user_id: str, db: DBSession) -> int:
    uid = _to_uuid(user_id)
    return (
        db.query(Notification)
        .filter(Notification.user_id == uid, Notification.is_read.is_(False))
        .count()
    )


def mark_read(notification_id: str, user_id: str, db: DBSession) -> None:
    nid = _to_uuid(notification_id)
    uid = _to_uuid(user_id)
    notif = db.query(Notification).filter(Notification.id == nid).first()
    if not notif:
        raise HTTPException(status_code=404, detail="알림을 찾을 수 없습니다")
    if notif.user_id != uid:
        raise HTTPException(status_code=403, detail="접근 권한이 없습니다")
    notif.is_read = True
    db.commit()


def mark_all_read(user_id: str, db: DBSession) -> int:
    uid = _to_uuid(user_id)
    items = (
        db.query(Notification)
        .filter(Notification.user_id == uid, Notification.is_read.is_(False))
        .all()
    )
    count = 0
    for n in items:
        n.is_read = True
        count += 1
    db.commit()
    return count


def get_preferences(user_id: str, db: DBSession) -> dict[str, dict[str, bool]]:
    uid = _to_uuid(user_id)
    user = db.query(User).filter(User.id == uid).first()
    if not user:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")
    return get_user_preferences(user)


def update_preferences(
    user_id: str,
    email_prefs: dict[str, bool],
    in_app_prefs: dict[str, bool],
    db: DBSession,
) -> dict[str, dict[str, bool]]:
    uid = _to_uuid(user_id)
    user = db.query(User).filter(User.id == uid).first()
    if not user:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")
    user.notification_preferences = {
        "email": {**DEFAULT_NOTIFICATION_PREFERENCES["email"], **email_prefs},
        "in_app": {**DEFAULT_NOTIFICATION_PREFERENCES["in_app"], **in_app_prefs},
    }
    db.commit()
    db.refresh(user)
    return get_user_preferences(user)
