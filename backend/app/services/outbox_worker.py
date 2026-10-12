"""outbox WS 채널 폴링 — WS 서버 이벤트 루프에서 실행 (동일 루프 emit 보장)"""

import logging
from datetime import datetime, timedelta, timezone

from app.models.notification_outbox import NotificationOutbox
from app.ws.chat_namespace import broadcast_notification

logger = logging.getLogger(__name__)

MAX_ATTEMPTS = 5


async def poll_and_deliver_ws(limit: int = 100) -> int:
    """pending ws outbox를 조회해 같은 이벤트 루프에서 emit.

    CEL-OUTBOX-03: 다중 웹 프로세스가 동시에 폴링하면 같은 행을 집어 WS 이벤트가 중복
    전달된다. PostgreSQL 에서 FOR UPDATE SKIP LOCKED 로 원자 선점하고(다른 프로세스는
    잠긴 행을 건너뜀), 행 단위로 커밋해 전달 사실을 즉시 durable 하게 남긴다.
    SQLite(테스트)는 FOR UPDATE 를 지원하지 않으므로 dialect 를 확인해 잠금 없이 조회한다.
    """
    from app.core.database import SessionLocal

    db = SessionLocal()
    delivered = 0
    try:
        now = datetime.now(timezone.utc)
        query = (
            db.query(NotificationOutbox)
            .filter(
                NotificationOutbox.status == "pending",
                NotificationOutbox.channel == "ws",
                NotificationOutbox.available_at <= now,
            )
        )
        # CEL-OUTBOX-03: 다중 프로세스 중복 전달 방지 — 원자적 행 선점.
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
                    "[OUTBOX-WS] delivery failed (id=%s, attempt=%s): %s",
                    item.id,
                    item.attempts,
                    e,
                )
            # CEL-OUTBOX-03: 행 단위 커밋 — 전달(또는 실패 마킹) 사실을 즉시 반영한다.
            try:
                db.commit()
            except Exception:  # noqa: BLE001
                logger.exception(
                    "[OUTBOX-WS] 행 단위 커밋 실패 (id=%s) — 롤백 후 다음 행 진행", item.id
                )
                db.rollback()
    finally:
        db.close()
    return delivered
