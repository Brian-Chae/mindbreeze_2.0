"""active 멤버와 미래·즉시 열린 회차 expected 생성. 호출자가 클래스 잠금·커밋을 소유한다."""

from fastapi import HTTPException
from sqlalchemy import and_, or_, null
from app.models.class_program import ClassMember, ClassMemberEvent, ClassInstructor
from app.models.class_scheduling import ClassEffect
from app.models.session import Session, SessionParticipant
from app.models.user import User


def _occupied_seats(db, cls, participants, exclude_id=None):
    """출석 기록이 아닌 현재 입장 자격을 센다. 병합 alias는 canonical 자격을 따른다."""
    members = {
        member.id: member
        for member in db.query(ClassMember).filter(ClassMember.class_id == cls.id).all()
    }
    occupied = set()
    for participant in participants:
        if (
            participant.id == exclude_id
            or participant.attendance_status not in ("expected", "attended")
            or participant.removed_at
            or participant.waitlist_cancelled_at
            or participant.is_waitlisted
            or participant.superseded_by_participant_id is not None
        ):
            continue
        member = members.get(participant.member_id)
        if member is not None:
            canonical = members.get(member.canonical_member_id or member.id)
            if canonical is None:
                continue
            # 수료 후 개인 보강과 명시 취소 대체편성도 동일한 회차 좌석을 점유한다.
            if canonical.status != "active":
                from app.services.class_makeup_service import cancelled_replacement_eligible
                if canonical.status != "completed" or not (
                    participant.attendance_kind == "makeup"
                    or cancelled_replacement_eligible(db, participant, canonical, cls)
                ):
                    continue
            occupied.add(("member", canonical.id))
        else:
            # 부모 멤버 연결 전의 기존 참가행도 정원에서 사라지지 않는다.
            occupied.add(("participant", participant.id))
    return len(occupied)


def ensure_expected(db, cls, sessions, members=None):
    # 호출자가 Class 잠금을 소유한다. 기존 초대·편성 경로도 같은 잠금 순서를 쓴다.
    locked_members = (
        db.query(ClassMember).filter(ClassMember.class_id == cls.id)
        .order_by(ClassMember.id).populate_existing().with_for_update().all()
    )
    members = members if members is not None else [
        member for member in locked_members if member.status == "active"
    ]
    locked_sessions = (
        db.query(Session).filter(Session.class_id == cls.id, Session.id.in_([row.id for row in sessions]))
        .order_by(Session.id).populate_existing().with_for_update().all()
    )
    for session in locked_sessions:
        participants = (
            db.query(SessionParticipant).filter(SessionParticipant.session_id == session.id)
            .execution_options(include_removed=True).order_by(SessionParticipant.id)
            .populate_existing().with_for_update().all()
        )
        for member in members:
            existing = next((row for row in participants if row.member_id == member.id or (member.user_id is not None and row.member_id is None and row.user_id == member.user_id)), None)
            if existing and existing.attendance_status != "expected":
                continue
            if session.max_participants is not None and _occupied_seats(
                db, cls, participants, existing.id if existing else None
            ) >= session.max_participants:
                raise HTTPException(409, detail={"code": "session_capacity"})
            if existing:
                continue
            participant = SessionParticipant(
                session_id=session.id, user_id=member.user_id, member_id=member.id,
                attendance_status="expected", attendance_kind="regular",
                report_included=False, joined_at=null(),
            )
            db.add(participant)
            db.flush()
            from app.services.class_member_consent_service import copy_member_defaults
            copy_member_defaults(db,member,participant,pii=True)
            participants.append(participant)
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
    existing_rows = (
        db.query(ClassMember).filter(ClassMember.class_id == cls.id)
        .order_by(ClassMember.id).populate_existing().with_for_update().all()
    )
    existing = {m.user_id: m for m in existing_rows if m.user_id is not None}
    new_ids = ids - set(existing)
    reactivated = {
        uid for uid in ids & set(existing) if existing[uid].status != "active"
    }
    if (
        sum(m.status == "active" and m.canonical_member_id is None for m in existing_rows)
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
        .order_by(Session.id)
        .populate_existing()
        .with_for_update()
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
                .order_by(SessionParticipant.id)
                .populate_existing()
                .with_for_update()
                .all()
            ):
                participant.removed_at = None
                participant.waitlist_cancelled_at = None
                from app.services.class_attendance_service import require_source_preserved
                require_source_preserved(db, participant, "expected")
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


# SDD-217: 아래 도메인 함수는 클래스→멤버 ID순 잠금을 가진 호출자 안에서 실행한다.
def member_dto(db, member, actor=None, cls=None):
    from app.services.class_access_service import class_role
    own = actor is not None and member.user_id == actor.id
    manager = bool(actor is not None and cls is not None and class_role(db, actor, cls) in ("lead", "assistant", "org_admin"))
    user = db.get(User, member.user_id) if member.user_id else None
    return {
        "id": str(member.id), "user_id": str(member.user_id) if member.user_id else None,
        "name": None if member.pii_scrubbed_at else (user.name if user else member.guest_name),
        "status": member.status, "kind": member.kind,
        "canonical_member_id": str(member.canonical_member_id or member.id),
        "waitlist_position": member.waitlist_position if member.status == "waitlisted" else None,
        **{key: getattr(member, key).isoformat() if getattr(member, key) else None for key in ("joined_at", "activated_at", "left_at", "removed_at", "completed_at")},
        "capabilities": {
            "manage_members": manager,
            "leave": own and member.status == "active", "cancel_waitlist": own and member.status == "waitlisted",
            "rejoin": own and member.status == "left" and cls is not None and cls.status == "active",
        },
    }


def _members(db, cls):
    return db.query(ClassMember).filter(ClassMember.class_id == cls.id, ClassMember.canonical_member_id.is_(None)).all()


def _queue(db, cls):
    return sorted((m for m in _members(db, cls) if m.status == "waitlisted"), key=lambda m: (m.waitlist_position or 0, str(m.id)))


def _has_seat(db, cls):
    return sum(m.status == "active" for m in _members(db, cls)) < cls.capacity


def _sessions_locked(db, cls):
    return db.query(Session).filter(Session.class_id == cls.id).order_by(Session.id).populate_existing().with_for_update().all()


def _member_event(db, cls, member, status, actor_id, now, reason=None, actor_kind="self"):
    previous = member.status
    member.status = status
    if status == "active":
        member.activated_at = now
        member.left_at = None
        member.removed_at = None
    elif status == "left":
        member.left_at = now
    elif status == "removed":
        member.removed_at = now
    if status == "waitlisted":
        member.waitlist_position = max((m.waitlist_position or 0 for m in _members(db, cls) if m.id != member.id), default=0) + 1
    else:
        member.waitlist_position = None
    event = ClassMemberEvent(class_id=cls.id, member_id=member.id, from_status=previous, to_status=status, actor_kind=actor_kind, actor_user_id=actor_id, reason=reason)
    db.add(event)
    db.flush()
    return event


def _activate_future(db, cls, member, sessions, now):
    from app.services.class_conflict_service import utc
    for session in sessions:
        future = session.status in ("ready", "scheduled") and session.scheduled_at and utc(session.scheduled_at) >= now and session.started_at is None
        instant = bool((cls.recurrence_rule or {}).get("start_now")) and session.status in ("open", "in_progress")
        if session.session_kind != "regular" or not (future or instant):
            continue
        participants = db.query(SessionParticipant).filter(SessionParticipant.session_id == session.id).execution_options(include_removed=True).order_by(SessionParticipant.id).populate_existing().with_for_update().all()
        existing = next((p for p in participants if p.member_id == member.id or (member.user_id is not None and p.user_id == member.user_id)), None)
        if existing and existing.entered_at is None and existing.attendance_status in ("absent", "excused"):
            continue
        occupied = _occupied_seats(db, cls, participants, existing.id if existing else None)
        if session.max_participants is not None and occupied >= session.max_participants:
            raise HTTPException(409, detail={"code": "session_capacity"})
        # 과거 입장 증거를 보존하되, 현재 멤버 자격을 되살리는 정원 검사는 생략하지 않는다.
        if existing and (existing.entered_at or existing.attendance_status == "attended"):
            continue
        if existing:
            existing.member_id = member.id
            existing.attendance_status = "expected"
            existing.removed_at = None
            existing.waitlist_cancelled_at = None
        else:
            existing = SessionParticipant(session_id=session.id, user_id=member.user_id, member_id=member.id, attendance_status="expected", attendance_kind="regular", report_included=False, joined_at=null())
            db.add(existing)
            db.flush()
        from app.services.class_member_consent_service import copy_member_defaults
        copy_member_defaults(db,member,existing,pii=True)
        session.participation_version += 1
    db.flush()


def _withdraw_future(db, cls, member, sessions, actor, data, now):
    from app.models.class_membership import ClassAttendanceEvent, ClassGuestCredential
    from app.services.class_conflict_service import utc
    member.entry_ver += 1
    aliases = [m.id for m in db.query(ClassMember).filter(ClassMember.class_id == cls.id, or_(ClassMember.id == member.id, ClassMember.canonical_member_id == member.id)).all()]
    rows = db.query(SessionParticipant).filter(SessionParticipant.session_id.in_([s.id for s in sessions]), SessionParticipant.member_id.in_(aliases)).execution_options(include_removed=True).order_by(SessionParticipant.id).populate_existing().with_for_update().all()
    by_id = {s.id: s for s in sessions}
    for participant in rows:
        participant.entry_ver += 1
        session = by_id[participant.session_id]
        future = session.status in ("ready", "scheduled") and session.scheduled_at and utc(session.scheduled_at) >= now and session.started_at is None
        if future and participant.entered_at is None and participant.attendance_status in ("expected", "excused"):
            from app.services.class_attendance_service import source_assignment
            # 이탈·제외의 자격 회수는 유지하면서 유효 보강의 원결석만 이력으로 보존한다.
            if participant.attendance_status == "excused" and source_assignment(db, participant):
                continue
            old = participant.attendance_status
            participant.attendance_status = "withdrawn"
            db.add(ClassAttendanceEvent(class_id=cls.id, session_id=session.id, participant_id=participant.id, member_id=participant.member_id, old_status=old, new_status="withdrawn", actor_kind="self" if member.user_id == actor.id else "host", actor_user_id=actor.id, reason=data.get("reason"), operation_key=data["operation_key"]))
            session.participation_version += 1
    for grant in db.query(ClassGuestCredential).filter(ClassGuestCredential.member_id.in_(aliases), ClassGuestCredential.revoked_at.is_(None)).all():
        grant.revoked_at = now
    db.flush()


def _promote_fifo(db, cls, sessions, actor_id, now):
    promoted = []
    while _has_seat(db, cls) and _queue(db, cls):
        member = _queue(db, cls)[0]
        event = _member_event(db, cls, member, "active", actor_id, now, actor_kind="system")
        member.joined_via = "waitlist_promotion"
        _activate_future(db, cls, member, sessions, now)
        db.add(ClassEffect(class_id=cls.id, kind="class_waitlist_promoted", effect_key=f"member-promoted:{event.id}", payload={"member_id": str(member.id), **({"recipient_id": str(member.user_id)} if member.user_id else {})}))
        promoted.append(str(member.id))
    db.flush()
    return promoted


def rejoin_member(db, cls, member, actor_id, now, reason=None):
    """코드·명시 rejoin 공용. 같은 멤버 행과 과거 참가자 FK를 보존한다."""
    if cls.status != "active" or member.status != "left":
        raise HTTPException(409, detail={"code": "member_transition_invalid"})
    sessions = _sessions_locked(db, cls)
    status = "active" if _has_seat(db, cls) and not _queue(db, cls) else "waitlisted"
    _member_event(db, cls, member, status, actor_id, now, reason)
    if status == "active":
        _activate_future(db, cls, member, sessions, now)
    return member


def transition_membership(db, actor_id, class_id, member_id, command, now=None):
    from datetime import datetime, timezone
    from uuid import UUID
    from app.services.class_member_commands import execute_member_command
    from app.services.class_access_service import authorize_class_action
    now = now or datetime.now(timezone.utc)
    member_id = UUID(str(member_id))
    def target(cls):
        member = db.query(ClassMember).filter_by(id=member_id, class_id=cls.id).first()
        if member is None or member.canonical_member_id:
            raise HTTPException(404, detail={"code": "member_not_found"})
        return member
    def authorize(cls, actor, data):
        member = target(cls)
        action = data["action"]
        if action in ("leave", "cancel_waitlist", "rejoin"):
            if member.user_id != actor.id:
                raise HTTPException(403, detail={"code": "action_forbidden"})
        else:
            try:
                authorize_class_action(db, actor, cls, "invite")
            except HTTPException as exc:
                raise HTTPException(403 if member.user_id == actor.id else exc.status_code, detail={"code": "action_forbidden"}) from exc
    def apply(cls, actor, data):
        member = target(cls)
        action = data["action"]
        if cls.status != "active":
            raise HTTPException(409, detail={"code": "member_transition_invalid"})
        if action == "rejoin":
            rejoin_member(db, cls, member, actor.id, now, data.get("reason"))
            return {"member": member_dto(db, member, actor, cls), "promoted_member_ids": []}
        allowed = {"leave": ("active",), "cancel_waitlist": ("waitlisted",), "remove": ("active", "waitlisted"), "restore": ("removed",), "promote": ("waitlisted",)}
        if action not in allowed or member.status not in allowed[action]:
            raise HTTPException(409, detail={"code": "member_transition_invalid"})
        sessions = _sessions_locked(db, cls)
        if action == "promote":
            if _queue(db, cls)[0].id != member.id:
                raise HTTPException(409, detail={"code": "waitlist_precedes"})
            if not _has_seat(db, cls):
                raise HTTPException(409, detail={"code": "class_capacity"})
            promoted = _promote_fifo(db, cls, sessions, actor.id, now)
        elif action == "restore":
            status = "active" if _has_seat(db, cls) and not _queue(db, cls) else "waitlisted"
            _member_event(db, cls, member, status, actor.id, now, data.get("reason"), "host")
            if status == "active":
                _activate_future(db, cls, member, sessions, now)
            promoted = []
        else:
            status = "removed" if action == "remove" else "left"
            event = _member_event(db, cls, member, status, actor.id, now, data.get("reason"), "host" if action == "remove" else "self")
            recipients = {str(row.user_id) for row in db.query(ClassInstructor).filter_by(class_id=cls.id, role="lead", status="active").all()}
            if action == "remove" and member.user_id:
                recipients.add(str(member.user_id))
            db.add(ClassEffect(class_id=cls.id, kind=f"class_member_{status}", effect_key=f"member-transition:{event.id}", payload={"member_id": str(member.id), "recipient_ids": sorted(recipients)}))
            _withdraw_future(db, cls, member, sessions, actor, data, now)
            promoted = _promote_fifo(db, cls, sessions, actor.id, now)
            # 기존 미디어 회수 소비 경로가 커밋 후 처리한다.
            if any(s.status in ("open", "in_progress") for s in sessions):
                db.add(ClassEffect(class_id=cls.id, kind="live_access_reconcile", effect_key=f"member-revoke:{member.id}:{member.entry_ver}", payload={}))
        db.flush()
        return {"member": member_dto(db, member, actor, cls), "promoted_member_ids": promoted}
    return execute_member_command(db, actor_id, class_id, command, action="member_transition", target_id=member_id, authorize=authorize, apply=apply)


def request_waitlist(db, actor_id, class_id, command, now=None):
    from datetime import datetime, timezone
    from app.services.class_member_commands import execute_member_command
    from app.services.class_code_service import normalize_class_code
    now = now or datetime.now(timezone.utc)
    def authorize(cls, actor, data):
        if actor.role != "client":
            raise HTTPException(403, detail={"code": "action_forbidden"})
        if not normalize_class_code(data["code"]) or cls.access_code != normalize_class_code(data["code"]):
            raise HTTPException(404, detail={"code": "class_not_found"})
    def apply(cls, actor, data):
        if cls.status != "active":
            raise HTTPException(409, detail={"code": "member_transition_invalid"})
        member = db.query(ClassMember).filter_by(class_id=cls.id, user_id=actor.id).first()
        if member and member.status == "waitlisted":
            return {"member": member_dto(db, member, actor, cls)}
        if member and member.status != "left":
            raise HTTPException(409, detail={"code": "member_transition_invalid"})
        if _has_seat(db, cls) and not _queue(db, cls):
            raise HTTPException(409, detail={"code": "waitlist_not_required"})
        if member is None:
            member = ClassMember(class_id=cls.id, user_id=actor.id, kind="member", status="invited", joined_via="code", joined_at=now)
            db.add(member)
            db.flush()
        _member_event(db, cls, member, "waitlisted", actor.id, now, data.get("reason"))
        db.flush()
        return {"member": member_dto(db, member, actor, cls)}
    return execute_member_command(db, actor_id, class_id, command, action="waitlist", target_id="self", authorize=authorize, apply=apply)
