"""active 멤버와 미래·즉시 열린 회차 expected 생성. 호출자가 클래스 잠금·커밋을 소유한다."""

from fastapi import HTTPException
from sqlalchemy import and_, or_, null
from app.models.class_program import ClassMember, ClassMemberEvent, ClassInstructor
from app.models.class_scheduling import ClassEffect
from app.models.session import Session, SessionParticipant
from app.models.user import User


def ensure_expected(db, cls, sessions, members=None):
    members = (
        members
        if members is not None
        else db.query(ClassMember)
        .filter(ClassMember.class_id == cls.id, ClassMember.status == "active")
        .all()
    )
    for session in sessions:
        for member in members:
            existing = (
                db.query(SessionParticipant)
                .filter(
                    SessionParticipant.session_id == session.id,
                    SessionParticipant.user_id == member.user_id,
                )
                .execution_options(include_removed=True)
                .first()
            )
            if existing:
                continue
            db.add(
                SessionParticipant(
                    session_id=session.id,
                    user_id=member.user_id,
                    member_id=member.id,
                    attendance_status="expected",
                    attendance_kind="regular",
                    report_included=False,
                    joined_at=null(),
                )
            )
    db.flush()


def invite_members(
    db, cls, user_ids, actor_id, now, via="host_invite", reactivate=False
):
    if cls.status != "active":
        raise HTTPException(409, detail={"code": "class_not_active"})
    ids = set(user_ids)
    users = (
        db.query(User)
        .filter(User.id.in_(ids), User.status == "active", User.role == "client")
        .all()
    )
    if len(users) != len(ids):
        raise HTTPException(422, detail={"code": "member_unavailable"})
    existing = {
        m.user_id: m
        for m in db.query(ClassMember).filter(ClassMember.class_id == cls.id).all()
    }
    new_ids = ids - set(existing)
    reactivated = {
        uid for uid in ids & set(existing) if existing[uid].status != "active"
    }
    if (
        sum(m.status == "active" for m in existing.values())
        + len(new_ids)
        + len(reactivated)
        > cls.capacity
    ):
        raise HTTPException(409, detail={"code": "class_capacity"})
    if reactivated and (not reactivate or via != "host_invite"):
        raise HTTPException(409, detail={"code": "member_reinvite_required"})
    sessions = (
        db.query(Session)
        .filter(
            Session.class_id == cls.id,
            or_(
                and_(
                    Session.status.in_(("ready", "scheduled")),
                    Session.scheduled_at >= now,
                ),
                and_(
                    bool((cls.recurrence_rule or {}).get("start_now")),
                    Session.status.in_(("open", "in_progress")),
                ),
            ),
            Session.session_kind == "regular",
        )
        .all()
    )
    result = []
    for uid in sorted(ids):
        member = existing.get(uid)
        if member is None:
            member = ClassMember(
                class_id=cls.id,
                user_id=uid,
                kind="member",
                status="active",
                joined_via=via,
                activated_at=now,
                joined_at=now,
            )
            db.add(member)
            db.flush()
            event = ClassMemberEvent(
                class_id=cls.id,
                member_id=member.id,
                from_status=None,
                to_status="active",
                actor_kind="host" if via == "host_invite" else "self",
                actor_user_id=actor_id,
            )
            db.add(event)
            db.flush()
            db.add(
                ClassEffect(
                    class_id=cls.id,
                    kind="class_invited",
                    effect_key=f"member:{member.id}:invited",
                    payload={"recipient_id": str(uid)},
                )
            )
        if uid in reactivated:
            previous = member.status
            member.status = "active"
            member.activated_at = now
            member.completed_at = None
            event = ClassMemberEvent(
                class_id=cls.id,
                member_id=member.id,
                from_status=previous,
                to_status="active",
                actor_kind="host",
                actor_user_id=actor_id,
            )
            db.add(event)
            db.flush()
            db.add(
                ClassEffect(
                    class_id=cls.id,
                    kind="class_invited",
                    effect_key=f"reinvite:{event.id}",
                    payload={"recipient_id": str(uid)},
                )
            )
        if uid in new_ids or uid in reactivated:
            for lead in (
                db.query(ClassInstructor)
                .filter_by(class_id=cls.id, role="lead", status="active")
                .all()
            ):
                db.add(
                    ClassEffect(
                        class_id=cls.id,
                        kind="class_member_joined",
                        effect_key=f"member-joined:{event.id}:{lead.user_id}",
                        payload={"recipient_id": str(lead.user_id)},
                    )
                )
        if uid in reactivated:
            for participant in (
                db.query(SessionParticipant)
                .filter(
                    SessionParticipant.session_id.in_([s.id for s in sessions]),
                    SessionParticipant.user_id == uid,
                )
                .execution_options(include_removed=True)
                .all()
            ):
                participant.removed_at = None
                participant.waitlist_cancelled_at = None
                participant.attendance_status = "expected"
                participant.member_id = member.id
        ensure_expected(db, cls, sessions, [member])
        result.append(member)
    db.flush()
    return result


def invite_emails(db, cls, emails, actor_id):
    from app.models.class_scheduling import ClassEmailInvite
    from app.services.session_email_invite_service import (
        normalize_email,
        is_valid_email,
    )

    normalized = sorted({normalize_email(e) for e in emails})
    if (
        not normalized
        or len(normalized) > 100
        or any(not is_valid_email(e) for e in normalized)
    ):
        raise HTTPException(422, detail={"code": "invalid_invite_emails"})
    if cls.status != "active":
        raise HTTPException(409, detail={"code": "class_not_active"})
    result = []
    for email in normalized:
        invite = (
            db.query(ClassEmailInvite)
            .filter(
                ClassEmailInvite.class_id == cls.id,
                ClassEmailInvite.email_norm == email,
                ClassEmailInvite.invite_version == 1,
            )
            .first()
        )
        if invite is None:
            invite = ClassEmailInvite(
                class_id=cls.id, email_norm=email, invited_by=actor_id, invite_version=1
            )
            db.add(invite)
            db.flush()
            db.add(
                ClassEffect(
                    class_id=cls.id,
                    kind="email_invite",
                    effect_key=f"email:{invite.id}",
                    payload={"invite_id": str(invite.id)},
                )
            )
        result.append(invite)
    db.flush()
    return result


def retry_email(db, cls, invite_id):
    from datetime import datetime, timezone
    from app.models.class_scheduling import ClassEmailInvite

    invite = (
        db.query(ClassEmailInvite)
        .filter(ClassEmailInvite.id == invite_id, ClassEmailInvite.class_id == cls.id)
        .first()
    )
    if not invite:
        raise HTTPException(404, detail={"code": "invite_not_found"})
    if invite.status != "failed":
        raise HTTPException(409, detail={"code": "invite_not_failed"})
    intent = (
        db.query(ClassEffect)
        .filter(ClassEffect.effect_key == f"email:{invite.id}")
        .with_for_update()
        .one()
    )
    invite.status = "pending"
    intent.status = "pending"
    intent.available_at = datetime.now(timezone.utc)
    db.flush()
    return invite
