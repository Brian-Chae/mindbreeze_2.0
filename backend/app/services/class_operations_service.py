"""OS cron과 수동 실행이 공유하는 클래스 유지 작업."""

import logging
from datetime import datetime, timezone
from app.config import settings
from app.models.class_program import Class, ClassInstructor
from app.services.class_instructor_service import sweep_class_operations
from app.services.class_rolling_service import finish_class_if_due, roll_forward
from app.services.class_schedule_service import KST
from app.services.class_write_service import lock_users


def maintain_classes(db, now=None, class_ids=None):
    if not settings.class_scheduling_enabled:
        return {"processed": 0, "failed": 0}
    now = now or datetime.now(timezone.utc)
    query = db.query(Class.id).filter(Class.recurrence_rule.isnot(None))
    if class_ids is not None:
        query = query.filter(Class.id.in_(class_ids))
    ids = [r[0] for r in query.order_by(Class.id).all()]
    result = {"processed": 0, "failed": 0}
    for class_id in ids:
        try:
            sweep_class_operations(db, class_id, now)
            lock_users(
                db,
                [
                    r[0]
                    for r in db.query(ClassInstructor.user_id)
                    .filter_by(class_id=class_id)
                    .all()
                ],
            )
            cls = (
                db.query(Class)
                .filter_by(id=class_id)
                .populate_existing()
                .with_for_update()
                .first()
            )
            if cls:
                finish_class_if_due(db, cls, now)
                from app.models.session import Session
                from app.services.class_access_service import queue_live_reconcile

                if (
                    db.query(Session.id)
                    .filter(
                        Session.class_id == cls.id,
                        Session.status.in_(("open", "in_progress")),
                        Session.webrtc_room_id.isnot(None),
                    )
                    .first()
                ):
                    queue_live_reconcile(db, cls.id)
            db.commit()
            result["processed"] += 1
        except Exception:
            logging.getLogger(__name__).exception("클래스 유지 작업 실패: %s", class_id)
            db.rollback()
            result["failed"] += 1
    return result


def roll_classes(db, now=None):
    if not settings.class_scheduling_enabled or not settings.class_rolling_enabled:
        return {"processed": 0, "failed": 0}
    now = now or datetime.now(timezone.utc)
    # 서버 시간대와 무관하게 매시 실행 중 KST 02시에만 보충한다.
    if now.astimezone(KST).hour != 2:
        return {"processed": 0, "failed": 0}
    ids = [
        r[0]
        for r in db.query(Class.id)
        .filter_by(status="active", schedule_mode="rolling")
        .all()
    ]
    result = {"processed": 0, "failed": 0}
    for class_id in ids:
        try:
            roll_forward(db, class_id, now)
            result["processed"] += 1
        except Exception:
            logging.getLogger(__name__).exception("클래스 유지 작업 실패: %s", class_id)
            db.rollback()
            result["failed"] += 1
    return result
