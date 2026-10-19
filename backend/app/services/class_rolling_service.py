"""정기형 미래 28일 보충. 읽기 API에서는 호출하지 않는다."""

from datetime import datetime, timedelta, timezone
from uuid import UUID
from fastapi import HTTPException
from sqlalchemy import func
from app.models.class_program import Class, ClassInstructor
from app.models.session import Session
from app.schemas.class_scheduling import ScheduleInput
from app.services.class_schedule_service import expand_schedule, KST
from app.services.class_write_service import lock_users, create_sessions
from app.services.class_membership_service import ensure_expected


def roll_forward(db, class_id, now=None):
    now = now or datetime.now(timezone.utc)
    class_id = UUID(str(class_id))
    try:
        ids = [
            r[0]
            for r in db.query(ClassInstructor.user_id)
            .filter(ClassInstructor.class_id == class_id)
            .all()
        ]
        lock_users(db, ids)
        cls = (
            db.query(Class)
            .filter(Class.id == class_id)
            .populate_existing()
            .with_for_update()
            .first()
        )
        if cls is None:
            raise HTTPException(404, detail={"code": "class_not_found"})
        if cls.status != "active" or cls.schedule_mode != "rolling":
            db.commit()
            return {"class_id": str(class_id), "session_ids": []}
        if finish_class_if_due(db, cls, now) or (
            cls.ends_on and now.astimezone(KST).date() > cls.ends_on
        ):
            db.commit()
            return {"class_id": str(class_id), "session_ids": []}
        payload = ScheduleInput(
            title=cls.title,
            location_type=cls.location_type,
            location_address=cls.location_address,
            capacity=cls.capacity,
            linkband_mode=cls.linkband_mode,
            record_audio=cls.record_audio,
            record_video=cls.record_video,
            duration_min=cls.default_duration_min,
            schedule_mode="rolling",
            recurrence_rule=cls.recurrence_rule,
            assignment_rule=cls.assignment_rule,
            ends_on=cls.ends_on,
        )
        candidates = expand_schedule(payload, now)
        candidates = [
            r
            for r in candidates
            if cls.generation_cursor is None
            or r.scheduled_at.astimezone(KST).date() > cls.generation_cursor
        ]
        # 이동된 정규 회차도 해당 날짜의 패턴을 이미 점유한다.
        occupied = {
            s.scheduled_at.astimezone(KST).date()
            for s in db.query(Session)
            .filter(
                Session.class_id == cls.id,
                Session.session_kind == "regular",
                Session.scheduled_at.isnot(None),
            )
            .execution_options(include_hidden=True)
            .all()
        }
        candidates = [
            r
            for r in candidates
            if r.scheduled_at.astimezone(KST).date() not in occupied
        ]
        seq = (
            db.query(func.max(Session.seq))
            .filter(Session.class_id == cls.id)
            .execution_options(include_hidden=True)
            .scalar()
            or 0
        )
        regular = (
            db.query(Session)
            .filter(Session.class_id == cls.id, Session.session_kind == "regular")
            .execution_options(include_hidden=True)
            .count()
        )
        rows = []
        for i, row in enumerate(candidates):
            host = row.host_id
            rule = payload.assignment_rule
            if rule.mode in ("rotate", "per_session") and rule.host_ids:
                host = rule.host_ids[(regular + i) % len(rule.host_ids)]
            if host is None:
                raise HTTPException(422, detail={"code": "host_required"})
            rows.append(row.model_copy(update={"seq": seq + i + 1, "host_id": host}))
        from app.models.user import User
        from app.schemas.class_scheduling import WriteCommand
        from app.services.class_write_service import check_conflicts

        actor = db.query(User).filter_by(id=cls.created_by).one()
        check_conflicts(
            db, rows, actor, WriteCommand(operation_key="rolling"), class_id=cls.id
        )
        sessions = create_sessions(db, cls, rows, allow_inactive=True)
        ensure_expected(db, cls, sessions)
        horizon = now.astimezone(KST).date() + timedelta(days=27)
        if cls.ends_on:
            horizon = min(horizon, cls.ends_on)
        cls.generation_cursor = (
            max(cls.generation_cursor, horizon) if cls.generation_cursor else horizon
        )
        if sessions:
            cls.revision += 1
        db.commit()
        return {"class_id": str(class_id), "session_ids": [str(s.id) for s in sessions]}
    except Exception:
        db.rollback()
        raise


def finish_class_if_due(db, cls, now):
    """호출자가 클래스 잠금을 소유한다. 회차 종료와 같은 커밋에 수료를 반영한다."""
    from app.models.class_program import ClassMember
    from app.services.class_write_service import effect

    if cls.status != "active":
        return False
    rows = (
        db.query(Session)
        .filter_by(class_id=cls.id)
        .order_by(Session.id)
        .with_for_update()
        .all()
    )
    regular = [r for r in rows if r.session_kind == "regular"]
    due = (
        cls.schedule_mode == "fixed"
        and bool(regular)
        and all(r.status in ("completed", "cancelled") for r in regular)
    )
    due = due or bool(
        cls.schedule_mode == "rolling"
        and cls.ends_on
        and now.astimezone(KST).date() > cls.ends_on
    )
    if not due or any(r.status in ("open", "in_progress") for r in rows):
        return False
    for row in rows:
        if cls.schedule_mode == "rolling" and row.status in ("ready", "scheduled"):
            row.status = "cancelled"
            row.state_version += 1
    cls.status = "completed"
    cls.revision += 1
    for member in (
        db.query(ClassMember).filter_by(class_id=cls.id, status="active").all()
    ):
        member.status = "completed"
        member.completed_at = now
        effect(
            db,
            cls,
            "class_completed",
            f"complete:{cls.id}:{cls.revision}:{member.id}",
            {"recipient_id": str(member.user_id)},
        )
    db.flush()
    return True
