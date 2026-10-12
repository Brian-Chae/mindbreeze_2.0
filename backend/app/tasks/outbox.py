"""outbox 이메일 채널 처리 — Celery beat 주기 태스크"""

import logging
from datetime import datetime, timedelta, timezone

from app.core.celery_app import celery_app
from app.models.notification_outbox import NotificationOutbox
from app.services.notification_service import send_email_notification

logger = logging.getLogger(__name__)

MAX_ATTEMPTS = 5


@celery_app.task(name="tasks.process_email_outbox")
def process_email_outbox(limit: int = 100) -> dict:
    """pending email outbox를 조회해 발송."""
    from app.core.database import SessionLocal

    db = SessionLocal()
    processed = sent = failed = 0
    try:
        now = datetime.now(timezone.utc)
        # OUT-01: pending 조회 시 행 잠금 없이 읽으면 동시 워커가 같은 행을 집어
        # 이메일이 이중 발송될 수 있다. PostgreSQL은 FOR UPDATE SKIP LOCKED 로
        # 원자적으로 선점한다. SQLite(테스트)는 FOR UPDATE 를 지원하지 않으므로
        # dialect 를 확인해 테스트 환경에서는 잠금 없이 조회한다(fallback).
        query = (
            db.query(NotificationOutbox)
            .filter(
                NotificationOutbox.status == "pending",
                NotificationOutbox.channel == "email",
                NotificationOutbox.available_at <= now,
            )
        )
        bind = db.get_bind()
        if bind is not None and bind.dialect.name == "postgresql":
            query = query.with_for_update(skip_locked=True)
        items = (
            query.order_by(NotificationOutbox.created_at)
            .limit(limit)
            .all()
        )
        for item in items:
            try:
                payload = item.payload or {}
                # OUTBOX-002: send_email_notification 반환값(bool)을 확인한다.
                # 실패(False)를 sent 로 마킹하지 않고 예외로 올려 재시도·failed 처리한다.
                # payload['html'] 이 있으면 HTML 본문까지 전달한다(report_email_task 정합).
                ok = send_email_notification(
                    item.recipient or "",
                    payload.get("subject", ""),
                    payload.get("body", ""),
                    payload.get("html"),
                )
                if not ok:
                    raise RuntimeError("이메일 발송 실패")
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
            # CEL-OUTBOX-02: 배치 전체를 루프 종료 후 1회만 커밋하면, 중간에 워커가
            # 죽었을 때 이미 발송된 행의 status='sent'가 유실돼 다음 스윕에서 이중 발송된다.
            # 행 단위로 커밋해 발송 사실을 즉시 durable 하게 남긴다.
            try:
                db.commit()
            except Exception:  # noqa: BLE001
                logger.exception(
                    "[OUTBOX-EMAIL] 행 단위 커밋 실패 (id=%s) — 롤백 후 다음 행 진행", item.id
                )
                db.rollback()

    finally:
        db.close()
    return {"processed": processed, "sent": sent, "failed": failed}


@celery_app.task(name="tasks.cleanup_notifications")
def cleanup_notifications() -> dict:
    """알림 보관·파기 정책: 읽은 알림 30일, 전체 90일, outbox 정리 30일."""
    from app.core.database import SessionLocal
    from app.models.notification import Notification

    db = SessionLocal()
    deleted_read = deleted_created = deleted_outbox = 0
    try:
        now = datetime.now(timezone.utc)
        read_cutoff = now - timedelta(days=30)
        created_cutoff = now - timedelta(days=90)
        outbox_cutoff = now - timedelta(days=30)

        deleted_read = (
            db.query(Notification)
            .filter(Notification.read_at.is_not(None), Notification.read_at < read_cutoff)
            .delete(synchronize_session=False)
        )
        deleted_created = (
            db.query(Notification)
            .filter(Notification.created_at < created_cutoff)
            .delete(synchronize_session=False)
        )
        deleted_outbox = (
            db.query(NotificationOutbox)
            .filter(
                NotificationOutbox.status.in_(["sent", "failed"]),
                NotificationOutbox.created_at < outbox_cutoff,
            )
            .delete(synchronize_session=False)
        )
        db.commit()
    finally:
        db.close()
    logger.info(
        f"[NOTIF-CLEANUP] read={deleted_read} created={deleted_created} outbox={deleted_outbox}"
    )
    return {
        "deleted_read": deleted_read,
        "deleted_created": deleted_created,
        "deleted_outbox": deleted_outbox,
    }
