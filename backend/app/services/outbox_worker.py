"""outbox WS 채널 폴링 — WS 서버 이벤트 루프에서 실행 (동일 루프 emit 보장)"""

import logging
from datetime import datetime, timedelta, timezone

from app.models.notification_outbox import NotificationOutbox
from app.ws.chat_namespace import broadcast_notification

logger = logging.getLogger(__name__)

MAX_ATTEMPTS = 5


async def poll_and_deliver_ws(limit: int = 100) -> int:
    """pending ws outbox를 조회해 같은 이벤트 루프에서 emit."""
    from app.core.database import SessionLocal

    db = SessionLocal()
    delivered = 0
    try:
        now = datetime.now(timezone.utc)
        items = (
            db.query(NotificationOutbox)
            .filter(
                NotificationOutbox.status == "pending",
                NotificationOutbox.channel == "ws",
                NotificationOutbox.available_at <= now,
            )
            .order_by(NotificationOutbox.created_at)
            .limit(limit)
            .all()
        )
        for item in items:
            try:
                await broadcast_notification(str(item.user_id), item.payload)
                item.status = "sent"
                item.sent_at = now
                item.last_error = None
                delivered += 1
            except Exception as e:
                item.attempts += 1
                item.last_error = str(e)[:500]
                if item.attempts >= MAX_ATTEMPTS:
                    item.status = "failed"
                else:
                    item.status = "pending"
                    item.available_at = now + timedelta(seconds=2 ** item.attempts)
                logger.error(
                    f"[OUTBOX-WS] delivery failed (id={item.id}, attempt={item.attempts}): {e}"
                )
        db.commit()
    finally:
        db.close()
    return delivered
