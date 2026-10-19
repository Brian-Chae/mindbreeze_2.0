"""명상 강사 자격·제거 규칙. 잠금과 커밋은 쓰기 진입점이 소유한다."""

from datetime import datetime, timezone

from fastapi import HTTPException
from app.models.class_program import ClassInstructor
from app.models.organization import Organization
from app.models.session import Session
from app.models.user import User
from app.models.user_org_membership import UserOrgMembership


def eligible_user(db, cls, user_id):
    user = db.query(User).filter(User.id == user_id).first()
    if user is None or user.status != "active" or user.role != "counselor":
        raise HTTPException(409, detail={"code": "instructor_inactive"})
    membership = (
        db.query(UserOrgMembership)
        .filter(
            UserOrgMembership.user_id == user_id,
            UserOrgMembership.org_id == cls.organization_id,
            UserOrgMembership.status == "active",
            UserOrgMembership.role == "counselor",
        )
        .first()
    )
    org = db.query(Organization).filter(Organization.id == cls.organization_id).first()
    if (
        not membership
        or not org
        or org.deactivated_at is not None
        or (org.kind == "individual" and org.owner_user_id != user_id)
    ):
        raise HTTPException(409, detail={"code": "instructor_organization_mismatch"})
    return user


def validate_instructor(db, cls, user_id, session_id=None):
    eligible_user(db, cls, user_id)
    instructor = (
        db.query(ClassInstructor)
        .filter(
            ClassInstructor.class_id == cls.id,
            ClassInstructor.user_id == user_id,
            ClassInstructor.status == "active",
        )
        .first()
    )
    if instructor is None or (
        instructor.role == "guest"
        and (session_id is None or instructor.scope_session_id != session_id)
    ):
        raise HTTPException(409, detail={"code": "instructor_unavailable"})
    return instructor


def add_instructor(db, cls, user_id, role, actor_id, session_id=None):
    eligible_user(db, cls, user_id)
    if role not in ("lead", "assistant", "guest") or (
        role == "guest" and not session_id
    ):
        raise HTTPException(422, detail={"code": "instructor_role_invalid"})
    if (
        session_id
        and not db.query(Session)
        .filter(Session.id == session_id, Session.class_id == cls.id)
        .first()
    ):
        raise HTTPException(404, detail={"code": "session_not_found"})
    row = (
        db.query(ClassInstructor)
        .filter(ClassInstructor.class_id == cls.id, ClassInstructor.user_id == user_id)
        .first()
    )
    if (
        role == "guest"
        and db.query(Session.id)
        .filter(
            Session.class_id == cls.id,
            Session.host_id == user_id,
            Session.id != session_id,
            Session.status.in_(("ready", "scheduled", "open", "in_progress")),
        )
        .first()
    ):
        raise HTTPException(409, detail={"code": "guest_scope_conflict"})
    if row:
        if (
            row.status == "active"
            and row.role == "guest"
            and role == "guest"
            and row.scope_session_id != session_id
        ):
            raise HTTPException(409, detail={"code": "guest_scope_conflict"})
        if row.role == "lead" and role != "lead":
            _require_other_lead(db, cls, user_id)
        row.role, row.status, row.removed_at, row.scope_session_id = (
            role,
            "active",
            None,
            session_id,
        )
    else:
        row = ClassInstructor(
            class_id=cls.id,
            user_id=user_id,
            role=role,
            status="active",
            added_by=actor_id,
            scope_session_id=session_id,
        )
        db.add(row)
    db.flush()
    return row


def _require_other_lead(db, cls, user_id):
    other = (
        db.query(ClassInstructor)
        .join(User, User.id == ClassInstructor.user_id)
        .filter(
            ClassInstructor.class_id == cls.id,
            ClassInstructor.user_id != user_id,
            ClassInstructor.role == "lead",
            ClassInstructor.status == "active",
            User.status == "active",
        )
        .first()
    )
    if other is None:
        raise HTTPException(409, detail={"code": "last_lead"})


def remove_instructor(db, cls, user_id):
    row = (
        db.query(ClassInstructor)
        .filter(ClassInstructor.class_id == cls.id, ClassInstructor.user_id == user_id)
        .first()
    )
    if not row or row.status == "removed":
        return
    if row.role == "lead":
        _require_other_lead(db, cls, user_id)
    assigned = (
        db.query(Session.id)
        .filter(
            Session.class_id == cls.id,
            Session.host_id == user_id,
            Session.status.in_(("ready", "scheduled", "open", "in_progress")),
        )
        .first()
    )
    if assigned:
        raise HTTPException(409, detail={"code": "instructor_has_sessions"})
    row.status = "removed"
    row.removed_at = datetime.now(timezone.utc)
    from app.services.class_access_service import queue_live_reconcile

    queue_live_reconcile(db, cls.id)
    db.flush()


def _can_manage(db, cls, actor):
    from app.services.class_access_service import class_role

    return class_role(db, actor, cls) in ("lead", "org_admin")


def _switch_host(db, cls, session, candidate, actor, reason, now):
    from app.models.session_parent import SessionHostHistory
    from app.models.chat import ChatRoom
    from app.models.class_scheduling import ClassEffect

    previous = session.host_id
    session.host_id = candidate
    session.host_state = "assigned"
    session.state_version = (session.state_version or 0) + 1
    history = SessionHostHistory(
        session_id=session.id,
        previous_host_id=previous,
        new_host_id=candidate,
        changed_by=actor.id,
        reason=reason,
    )
    db.add(history)
    for room in db.query(ChatRoom).filter(ChatRoom.session_id == session.id).all():
        room.host_id = candidate
    db.flush()
    db.add(
        ClassEffect(
            class_id=cls.id,
            session_id=session.id,
            effect_key=f"host:{history.id}",
            kind="session_host_changed",
            payload={
                "previous_host_id": str(previous),
                "new_host_id": str(candidate),
                "history_id": str(history.id),
            },
        )
    )
    db.flush()


def _validate_host_change(
    db,
    cls,
    session,
    candidate,
    now,
    force=False,
    fingerprint=None,
    *,
    conflicts_checked=False,
):
    from app.schemas.class_scheduling import ScheduleRow
    from app.services.class_conflict_service import (
        detect_conflicts_bulk,
        conflict_fingerprint,
    )

    if session.class_id != cls.id:
        raise HTTPException(404, detail={"code": "session_not_found"})
    if session.status not in ("ready", "scheduled"):
        raise HTTPException(409, detail={"code": "host_change_state"})
    validate_instructor(db, cls, candidate, session.id)
    if session.scheduled_at and not conflicts_checked:
        row = ScheduleRow.model_construct(
            client_key=str(session.id),
            session_id=session.id,
            seq=session.seq,
            scheduled_at=_utc(session.scheduled_at),
            duration_min=session.duration_min,
            host_id=candidate,
        )
        conflicts = detect_conflicts_bulk(
            db, [row], {session.id}, {"id": str(candidate), "role": "counselor"}
        )
        if conflicts and (not force or fingerprint != conflict_fingerprint(conflicts)):
            raise HTTPException(
                409,
                detail={
                    "code": "schedule_conflict",
                    "conflicts": [c.model_dump(mode="json") for c in conflicts],
                    "conflict_fingerprint": conflict_fingerprint(conflicts),
                },
            )


def _utc(value):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def apply_host_request(
    db, cls, session, command, actor, now, *, conflicts_checked=False
):
    from datetime import timedelta
    from uuid import UUID
    from app.models.class_scheduling import SessionHostRequest

    candidate = UUID(str(command["candidate_host_id"]))
    kind = command.get("request_kind", "change")
    manager = _can_manage(db, cls, actor)
    if not manager:
        validate_instructor(db, cls, actor.id, session.id)
    if not manager and not (kind == "transfer" and session.host_id == actor.id):
        raise HTTPException(403, detail={"code": "host_change_forbidden"})
    if actor.role == "org_admin" and not (command.get("reason") or "").strip():
        raise HTTPException(422, detail={"code": "reason_required"})
    if command.get("expected_state_version") != session.state_version:
        raise HTTPException(409, detail={"code": "stale_session"})
    _validate_host_change(
        db,
        cls,
        session,
        candidate,
        now,
        command.get("force", False),
        command.get("confirmed_conflict_fingerprint"),
        conflicts_checked=conflicts_checked,
    )
    if (
        db.query(SessionHostRequest)
        .filter(
            SessionHostRequest.session_id == session.id,
            SessionHostRequest.status.in_(("requested", "pending_ack")),
        )
        .first()
    ):
        raise HTTPException(409, detail={"code": "host_request_pending"})
    remaining = (
        (_utc(session.scheduled_at) - now)
        if session.scheduled_at
        else timedelta(days=1)
    )
    if remaining <= timedelta(minutes=15):
        raise HTTPException(409, detail={"code": "host_ack_deadline"})
    state = (
        "requested"
        if kind == "transfer"
        else ("pending_ack" if remaining <= timedelta(minutes=60) else "accepted")
    )
    request = SessionHostRequest(
        session_id=session.id,
        requested_by=actor.id,
        candidate_host_id=candidate,
        request_kind=kind,
        status=state,
        expected_state_version=session.state_version,
        reason=command.get("reason"),
        expires_at=(
            _utc(session.scheduled_at) - timedelta(minutes=15)
            if session.scheduled_at
            else None
        ),
    )
    db.add(request)
    if state == "accepted":
        _switch_host(db, cls, session, candidate, actor, request.reason, now)
        request.resolved_at = now
    elif state == "pending_ack":
        session.host_state = "pending_ack"
        session.state_version = (session.state_version or 0) + 1
        request.expected_state_version = session.state_version
    db.flush()
    if request.status in ("requested", "pending_ack"):
        _request_effect(db, cls, session, request)
    return request


def _request_effect(db, cls, session, request):
    from app.models.class_scheduling import ClassEffect

    kind = (
        "session_host_transfer_requested"
        if request.status == "requested"
        else "session_host_change_requested"
    )
    db.flush()
    payload = {"request_id": str(request.id)}
    if request.status == "pending_ack":
        payload["recipient_id"] = str(request.candidate_host_id)
    db.add(
        ClassEffect(
            class_id=cls.id,
            session_id=session.id,
            kind=kind,
            effect_key=f"request:{request.id}:{request.status}",
            payload=payload,
        )
    )
    db.flush()


def resolve_host_request(
    db, cls, session, request, action, actor, now, *, force=False, fingerprint=None
):
    from datetime import timedelta

    if request.session_id != session.id or session.class_id != cls.id:
        raise HTTPException(404, detail={"code": "host_request_not_found"})
    manager = _can_manage(db, cls, actor)
    if action in ("accept", "reject"):
        validate_instructor(db, cls, actor.id, session.id)
    if action in ("accept", "reject") and actor.id != request.candidate_host_id:
        raise HTTPException(403, detail={"code": "candidate_only"})
    if action == "approve" and not manager:
        raise HTTPException(403, detail={"code": "manager_only"})
    if action == "cancel" and actor.id != request.requested_by and not manager:
        raise HTTPException(403, detail={"code": "requester_only"})
    if action not in ("accept", "reject", "approve", "cancel"):
        raise HTTPException(422, detail={"code": "invalid_resolution"})
    if request.status not in ("requested", "pending_ack") or session.status not in (
        "ready",
        "scheduled",
    ):
        raise HTTPException(409, detail={"code": "request_resolved"})
    if request.expires_at and _utc(request.expires_at) <= now:
        raise HTTPException(409, detail={"code": "host_ack_deadline"})
    if request.expected_state_version != session.state_version:
        raise HTTPException(409, detail={"code": "stale_session"})
    if action == "approve":
        if request.status != "requested":
            raise HTTPException(409, detail={"code": "request_state"})
        _validate_host_change(
            db, cls, session, request.candidate_host_id, now, force, fingerprint
        )
        if session.scheduled_at and _utc(session.scheduled_at) - now <= timedelta(
            minutes=60
        ):
            request.status = "pending_ack"
            session.host_state = "pending_ack"
            session.state_version += 1
            request.expected_state_version = session.state_version
            db.flush()
            _request_effect(db, cls, session, request)
            return request
    elif action == "accept" and request.status != "pending_ack":
        raise HTTPException(409, detail={"code": "request_state"})
    if action in ("accept", "approve"):
        _validate_host_change(
            db, cls, session, request.candidate_host_id, now, force, fingerprint
        )
        _switch_host(
            db, cls, session, request.candidate_host_id, actor, request.reason, now
        )
        request.status = "accepted"
    else:
        request.status = "rejected" if action == "reject" else "cancelled"
        try:
            validate_instructor(db, cls, session.host_id, session.id)
            session.host_state = "assigned"
        except HTTPException:
            session.host_state = "needs_reassign"
        session.state_version += 1
    request.resolved_at = now
    from app.models.class_scheduling import ClassEffect

    db.add(
        ClassEffect(
            class_id=cls.id,
            session_id=session.id,
            kind="session_host_change_resolved",
            effect_key=f"request:{request.id}:{request.status}",
            payload={
                "requester_id": str(request.requested_by),
                "resolution": request.status,
            },
        )
    )
    db.flush()
    return request


def mark_needs_reassign(db, user_id, class_ids, now):
    from app.models.class_program import Class
    from app.models.class_scheduling import ClassEffect, SessionHostRequest

    db.query(User).filter(User.id == user_id).with_for_update().all()
    query = (
        db.query(Class)
        .join(ClassInstructor, ClassInstructor.class_id == Class.id)
        .filter(ClassInstructor.user_id == user_id)
    )
    if class_ids is not None:
        query = query.filter(Class.id.in_(class_ids))
    parents = query.order_by(Class.id).with_for_update(of=Class).all()
    ids = [p.id for p in parents]
    from app.services.class_access_service import queue_live_reconcile

    for parent in parents:
        queue_live_reconcile(db, parent.id)
    rows = (
        db.query(Session)
        .filter(
            Session.class_id.in_(ids),
            Session.type == "meditation",
            Session.host_id == user_id,
            Session.status.in_(("ready", "scheduled")),
        )
        .order_by(Session.id)
        .with_for_update()
        .all()
    )
    changed = []
    for row in rows:
        if row.host_state == "needs_reassign":
            continue
        row.host_state = "needs_reassign"
        row.state_version = (row.state_version or 0) + 1
        for request in (
            db.query(SessionHostRequest)
            .filter(
                SessionHostRequest.session_id == row.id,
                SessionHostRequest.status.in_(("requested", "pending_ack")),
            )
            .all()
        ):
            request.status = "cancelled"
            request.resolved_at = now
        db.add(
            ClassEffect(
                class_id=row.class_id,
                session_id=row.id,
                kind="session_host_needed",
                effect_key=f"reassign:{row.id}:{row.state_version}",
                payload={"state_version": row.state_version, "stage": "initial"},
            )
        )
        changed.append(row)
    db.flush()
    return changed


def sweep_class_operations(db, class_id, now=None):
    """클래스별 요청 만료·대강 권한 만료·72h/24h 경고를 멱등 처리한다."""
    from datetime import timedelta
    from uuid import UUID
    from app.models.class_program import Class
    from app.models.class_scheduling import ClassEffect, SessionHostRequest
    from app.models.record import Report
    from app.services.class_write_service import lock_users

    now = now or datetime.now(timezone.utc)
    class_id = UUID(str(class_id))
    try:
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
        if not cls:
            db.commit()
            return
        rows = (
            db.query(Session)
            .filter_by(class_id=class_id)
            .order_by(Session.id)
            .populate_existing()
            .with_for_update()
            .all()
        )
        for session in rows:
            pending = (
                db.query(SessionHostRequest)
                .filter(
                    SessionHostRequest.session_id == session.id,
                    SessionHostRequest.status.in_(("requested", "pending_ack")),
                )
                .all()
            )
            for request in pending:
                if session.status not in ("ready", "scheduled") or (
                    request.expires_at and _utc(request.expires_at) <= now
                ):
                    request.status = "expired"
                    request.resolved_at = now
                    if session.status in ("ready", "scheduled"):
                        try:
                            validate_instructor(db, cls, session.host_id, session.id)
                            session.host_state = "assigned"
                        except HTTPException:
                            session.host_state = "needs_reassign"
                        session.state_version += 1
                    db.add(
                        ClassEffect(
                            class_id=cls.id,
                            session_id=session.id,
                            kind="session_host_change_resolved",
                            effect_key=f"request:{request.id}:expired",
                            payload={"recipient_id": str(request.requested_by)},
                        )
                    )
            if (
                session.host_state == "needs_reassign"
                and session.status in ("ready", "scheduled")
                and session.scheduled_at
            ):
                remaining = _utc(session.scheduled_at) - now
                stage = (
                    "24h"
                    if remaining <= timedelta(hours=24)
                    else ("72h" if remaining <= timedelta(hours=72) else None)
                )
                if stage:
                    key = f"reassign:{session.id}:{session.state_version}:{stage}"
                    if not db.query(ClassEffect.id).filter_by(effect_key=key).first():
                        db.add(
                            ClassEffect(
                                class_id=cls.id,
                                session_id=session.id,
                                kind="session_host_needed",
                                effect_key=key,
                                payload={
                                    "stage": stage,
                                    "state_version": session.state_version,
                                },
                            )
                        )
        for guest in (
            db.query(ClassInstructor)
            .filter_by(class_id=cls.id, role="guest", status="active")
            .all()
        ):
            session = (
                db.query(Session)
                .filter(Session.id == guest.scope_session_id)
                .execution_options(include_hidden=True)
                .first()
                if guest.scope_session_id
                else None
            )
            expired = session is None or session.hidden_at is not None
            if session and session.status == "completed":
                reports = db.query(Report).filter_by(session_id=session.id).all()
                approved = bool(reports) and all(
                    r.status == "completed" for r in reports
                )
                expired = (
                    expired
                    or approved
                    or bool(
                        session.ended_at
                        and _utc(session.ended_at) + timedelta(days=14) <= now
                    )
                )
            if expired:
                guest.status = "removed"
                guest.removed_at = now
        db.commit()
    except Exception:
        db.rollback()
        raise
