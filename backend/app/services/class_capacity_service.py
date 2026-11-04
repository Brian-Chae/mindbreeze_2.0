"""SDD-289: 행사 중 클래스 정원 늘리기(클래스+비종료 회차 정원 동시 상향, 대기열 승격)."""

from datetime import datetime, timezone

from fastapi import HTTPException

from app.models.class_program import ClassMember
from app.models.class_scheduling import ClassCapacityEvent
from app.models.session import SessionParticipant
from app.services.class_membership_service import (
    _occupied_seats,
    _promote_fifo,
    _sessions_locked,
)
from app.services.class_write_service import mutate_class

OPEN_STATUSES = ("scheduled", "ready", "open", "in_progress")
ONLINE_MAX = 50


def increase_capacity(db, actor_id, class_id, command, now=None):
    now = now or datetime.now(timezone.utc)

    def apply(cls, actor, data):
        new = int(data["capacity"])
        old = cls.capacity
        if cls.status != "active":
            raise HTTPException(409, detail={"code": "class_not_active"})
        if cls.location_type == "online" and new > ONLINE_MAX:
            raise HTTPException(422, detail={"code": "online_capacity_exceeded"})
        # 클래스 잠금(mutate_class) → 회차 잠금 순서로 입장·취소와 직렬화한다.
        sessions = [
            s
            for s in _sessions_locked(db, cls)
            if s.status in OPEN_STATUSES and s.hidden_at is None
        ]
        active = (
            db.query(ClassMember)
            .filter(
                ClassMember.class_id == cls.id,
                ClassMember.status == "active",
                ClassMember.canonical_member_id.is_(None),
            )
            .count()
        )
        occupied = active
        for s in sessions:
            rows = (
                db.query(SessionParticipant)
                .filter(SessionParticipant.session_id == s.id)
                .execution_options(include_removed=True)
                .all()
            )
            occupied = max(occupied, _occupied_seats(db, cls, rows))
        if new < occupied:
            raise HTTPException(422, detail={"code": "capacity_below_occupied"})
        if new < old:
            raise HTTPException(422, detail={"code": "capacity_not_increase"})
        mismatched = [s for s in sessions if s.max_participants != new]
        if new == old and not mismatched:
            return {"capacity": new, "changed": False, "promoted_count": 0}
        cls.capacity = new
        for s in mismatched:
            s.max_participants = new
            s.participation_version += 1
        db.flush()
        promoted = _promote_fifo(db, cls, sessions, actor.id, now)
        db.add(
            ClassCapacityEvent(
                class_id=cls.id,
                actor_id=actor.id,
                old_capacity=old,
                new_capacity=new,
                promoted_count=len(promoted),
                reason=(data.get("reason") or "").strip() or None,
                operation_key=data["operation_key"],
            )
        )
        db.flush()
        return {
            "capacity": new,
            "changed": True,
            "promoted_count": len(promoted),
            "previous_capacity": old,
        }

    return mutate_class(db, actor_id, class_id, command, "capacity", apply)
