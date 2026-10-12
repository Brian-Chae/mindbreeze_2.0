"""SDD-097: 예약 클래스 사전 안내(리마인더) Celery 태스크.

- send_session_reminder_task: ETA 로 예약된 개별 리마인더 발송(시작 N분 전).
- sweep_session_reminders: beat 주기 실행 안전망 — 워커 중단 등으로 누락된 리마인더를 보정한다.

발송 로직은 app.services.reminder_service.run_reminder 가 담당하고, 여기서는
DB 세션 수명과 태스크 등록만 책임진다(테스트에서 직접 호출 가능).
"""

import logging
from datetime import datetime, timedelta, timezone

from app.core.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="tasks.send_session_reminder")
def send_session_reminder_task(session_id: str, offset_min: int) -> dict:
    """ETA 예약된 리마인더 1건 발송 — 시작 offset_min 분 전 시점."""
    from app.core.database import SessionLocal
    from app.services import reminder_service

    with SessionLocal() as db:
        return reminder_service.run_reminder(session_id, int(offset_min), db)


@celery_app.task(name="tasks.sweep_session_reminders")
def sweep_session_reminders(lookahead_hours: int = 48, limit: int = 200) -> dict:
    """누락된 리마인더 스윕 — 가까운 예약 클래스에서 아직 안 보낸 시점을 찾아 발송한다.

    ETA 예약이 브로커 장애·워커 재시작으로 유실돼도, 그 시각이 지난 뒤 이 태스크가
    같은 시점을 발송한다(run_reminder 의 발송 로그로 중복은 차단된다).
    """
    from app.core.database import SessionLocal
    from app.models.session import Session, SessionReminderLog
    from app.services import reminder_service

    now = datetime.now(timezone.utc)
    horizon = now + timedelta(hours=lookahead_hours)
    scanned = dispatched = 0

    with SessionLocal() as db:
        candidates = (
            db.query(Session)
            .filter(
                Session.is_template.is_(False),
                Session.scheduled_at.is_not(None),
                Session.scheduled_at <= horizon,
                Session.scheduled_at >= now - timedelta(hours=1),
                Session.status.in_(["scheduled", "ready", "open"]),
            )
            .limit(limit)
            .all()
        )
        for session in candidates:
            scanned += 1
            for offset in reminder_service.due_offsets(session, now):
                already = (
                    db.query(SessionReminderLog.id)
                    .filter(
                        SessionReminderLog.session_id == session.id,
                        SessionReminderLog.offset_min == offset,
                        SessionReminderLog.channel == "email",
                        SessionReminderLog.status == "sent",
                    )
                    .first()
                )
                if already:
                    continue
                result = reminder_service.run_reminder(session.id, offset, db)
                if result.get("status") == "sent":
                    dispatched += 1

    summary = {"scanned": scanned, "dispatched": dispatched}
    if dispatched:
        logger.info("[REMINDER-SWEEP] %s", summary)
    return summary
