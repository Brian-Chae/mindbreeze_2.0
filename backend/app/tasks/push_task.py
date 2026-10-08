"""SDD-190: outbox push 채널 처리 — 매 1분 cron(celery beat 대체).

흐름: `channel="push"` & pending & available_at<=now 행을 행 선점으로 집어, 해당 사용자의
활성 디바이스 토큰 전체에 FCM 발송한다.

상태 규칙
- 24시간 넘은 pending → `expired` (자격증명 설정 여부와 무관. 잠금화면 알림은 늦으면 의미 없다)
- 활성 토큰 없음 → `skipped` (앱 미설치 사용자. 실패가 아니다)
- 1개 이상 발송 성공 → `sent` (다기기 중 일부 실패는 재시도하지 않는다 — 중복 푸시 방지)
- 전부 실패 → attempts+1 · 지수 백오프, MAX_ATTEMPTS 초과 시 `failed`
- FCM 미설정 → 행을 **건드리지 않고** 로그 1줄만 남긴다(설정 후 그대로 발송됨)

email/ws 채널 행은 `channel == "push"` 필터 때문에 이 태스크가 절대 건드리지 않는다
(역방향도 동일 — `tasks/outbox.py` 는 email, `services/outbox_worker.py` 는 ws 로 필터).
"""

import logging
from datetime import datetime, timedelta, timezone

from app.core.celery_app import celery_app
from app.models.notification_outbox import NotificationOutbox
from app.services import device_service, push_service

logger = logging.getLogger(__name__)

MAX_ATTEMPTS = 3
EXPIRE_AFTER_HOURS = 24


def _expire_stale(db, now: datetime) -> int:
    """24시간 넘은 pending push 행을 expired 로 마킹한다."""
    cutoff = now - timedelta(hours=EXPIRE_AFTER_HOURS)
    stale = (
        db.query(NotificationOutbox)
        .filter(
            NotificationOutbox.status == "pending",
            NotificationOutbox.channel == "push",
            NotificationOutbox.created_at < cutoff,
        )
        .all()
    )
    for item in stale:
        item.status = "expired"
        item.last_error = "24시간 초과 — 발송하지 않음"
    if stale:
        db.commit()
    return len(stale)


@celery_app.task(name="tasks.process_push_outbox")
def process_push_outbox(limit: int = 100) -> dict:
    """pending push outbox를 조회해 디바이스 토큰으로 발송."""
    from app.core.database import SessionLocal

    db = SessionLocal()
    processed = sent = failed = skipped = revoked = 0
    try:
        now = datetime.now(timezone.utc)
        expired = _expire_stale(db, now)

        if not push_service.is_configured():
            # 자격증명 미설정 — 행을 그대로 두고 설정 후 발송되게 한다.
            logger.info("[OUTBOX-PUSH] FCM 미설정 — 발송 건너뜀(행 유지)")
            return {
                "processed": 0,
                "sent": 0,
                "failed": 0,
                "skipped": 0,
                "expired": expired,
                "revoked": 0,
                "configured": False,
            }

        query = db.query(NotificationOutbox).filter(
            NotificationOutbox.status == "pending",
            NotificationOutbox.channel == "push",
            NotificationOutbox.available_at <= now,
        )
        bind = db.get_bind()
        # 동시 워커가 같은 행을 집어 푸시가 중복 발송되는 것을 막는다.
        # SQLite(테스트)는 FOR UPDATE 미지원 → dialect 확인 후 fallback(outbox.py 와 동일 규약).
        if bind is not None and bind.dialect.name == "postgresql":
            query = query.with_for_update(skip_locked=True)
        items = query.order_by(NotificationOutbox.created_at).limit(limit).all()

        for item in items:
            processed += 1
            payload = item.payload or {}
            tokens = device_service.list_active_tokens(db, item.user_id)

            if not tokens:
                item.status = "skipped"
                item.last_error = "활성 디바이스 토큰 없음"
                skipped += 1
                _commit_row(db, item)
                continue

            ok_count = 0
            reasons: list[str] = []
            for row in tokens:
                result = push_service.send_to_token(
                    row.token,
                    title=str(payload.get("title", "")),
                    body=str(payload.get("body", "")),
                    data={
                        "deeplink": str(payload.get("deeplink", "")),
                        "message_id": str(payload.get("message_id", "")),
                    },
                )
                if result.ok:
                    ok_count += 1
                    continue
                # 일부 토큰 실패가 나머지 토큰 발송을 막지 않는다 — 루프를 계속 돈다.
                reasons.append(f"{device_service.mask_token(row.token)}: {result.error}")
                if result.token_invalid:
                    row.revoked_at = now
                    revoked += 1
                    logger.info(
                        "[OUTBOX-PUSH] 무효 토큰 해지: %s", device_service.mask_token(row.token)
                    )

            if ok_count > 0:
                item.status = "sent"
                item.sent_at = now
                # 일부 기기 실패 사유는 남기되 성공으로 확정한다(재발송 시 중복 푸시).
                item.last_error = "; ".join(reasons)[:500] or None
                sent += 1
            else:
                item.attempts += 1
                item.last_error = "; ".join(reasons)[:500] or "발송 실패"
                if item.attempts >= MAX_ATTEMPTS:
                    item.status = "failed"
                else:
                    item.status = "pending"
                    item.available_at = now + timedelta(seconds=2 ** item.attempts)
                failed += 1
                logger.error(
                    "[OUTBOX-PUSH] delivery failed (id=%s, attempt=%s)", item.id, item.attempts
                )

            _commit_row(db, item)

    finally:
        db.close()
    return {
        "processed": processed,
        "sent": sent,
        "failed": failed,
        "skipped": skipped,
        "expired": expired,
        "revoked": revoked,
        "configured": True,
    }


def _commit_row(db, item: NotificationOutbox) -> None:
    """행 단위 커밋 — 배치 중간에 워커가 죽어도 발송 사실이 유실되지 않게 한다."""
    try:
        db.commit()
    except Exception:  # noqa: BLE001
        logger.exception("[OUTBOX-PUSH] 행 단위 커밋 실패 (id=%s) — 롤백 후 다음 행 진행", item.id)
        db.rollback()
