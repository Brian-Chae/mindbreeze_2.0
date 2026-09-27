"""outbox 이메일 채널 처리 — Celery beat 주기 태스크"""

import logging
from datetime import datetime, timedelta, timezone

from app.core.celery_app import celery_app
from app.core.database import SessionLocal
from app.models.notification_outbox import NotificationOutbox
from app.services.notification_service import send_email_notification

logger = logging.getLogger(__name__)

MAX_ATTEMPTS = 5


@celery_app.task(name="tasks.process_email_outbox")
def process_email_outbox(limit: int = 100) -> dict:
    """pending email outbox를 조회해 발송."""
    db = SessionLocal()
    processed = sent = failed = 0
    try:
        now = datetime.now(timezone.utc)
        items = (
            db.query(NotificationOutbox)
            .filter(
                NotificationOutbox.status == "pending",
                NotificationOutbox.channel == "email",
                NotificationOutbox.available_at <= now,
            )
            .order_by(NotificationOutbox.created_at)
            .limit(limit)
            .all()
        )
        for item in items:
            try:
                payload = item.payload or {}
                send_email_notification(
                    item.recipient or "",
                    payload.get("subject", ""),
                    payload.get("body", ""),
                )
                item.status = "sent"
                item.sent_at = now
                item.last_error = None
                sent += 1
            except Exception as e:
                item.attempts += 1
                item.last_error = str(e)[:500]
                if item.attempts >= MAX_ATTEMPTS:
                    item.status = "failed"
                else:
                    item.status = "pending"
                    item.available_at = now + timedelta(seconds=2 ** item.attempts)
                failed += 1
                logger.error(
                    f"[OUTBOX-EMAIL] delivery failed (id={item.id}, attempt={item.attempts}): {e}"
                )
            processed += 1
        db.commit()
    finally:
        db.close()
    return {"processed": processed, "sent": sent, "failed": failed}
