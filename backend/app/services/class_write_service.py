"""편성 쓰기 진입점. 한 요청의 도메인·멱등 결과·전달 의도를 함께 커밋한다."""

import hashlib
import json
from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import HTTPException
from app.models.class_program import Class
from app.models.class_scheduling import ClassOperation, ClassEffect
from app.models.session import Session
from app.models.user import User
from app.models.user_org_membership import UserOrgMembership
from app.schemas.class_scheduling import CreateClassCommand, ScheduleInput
from app.services.class_code_service import (
    generate_class_code,
    ClassCodeExhausted,
    exhausted_http_error,
)
from app.services.class_schedule_service import expand_schedule
from app.services.class_conflict_service import (
    detect_conflicts_bulk,
    conflict_fingerprint,
)
from app.services.class_instructor_service import add_instructor, validate_instructor


def request_hash(command) -> str:
    return hashlib.sha256(
        json.dumps(
            command.model_dump(mode="json"), sort_keys=True, ensure_ascii=False
        ).encode()
    ).hexdigest()


def lock_users(db, ids):
    return (
        db.query(User)
        .filter(User.id.in_(set(ids)))
        .order_by(User.id)
        .populate_existing()
        .with_for_update()
        .all()
    )


def effect(db, cls, kind, key, payload, session_id=None):
    row = ClassEffect(
        class_id=cls.id,
        session_id=session_id,
        kind=kind,
        effect_key=key,
        payload=payload,
    )
    db.add(row)
    return row


def check_conflicts(
    db, rows, actor, command, exclude_ids=None, *, class_id=None, member_ids=None
):
    conflicts = detect_conflicts_bulk(
        db,
        rows,
        exclude_ids or set(),
        {"id": str(actor.id), "role": actor.role},
        class_id=class_id,
        member_ids=member_ids,
    )
    fingerprint = conflict_fingerprint(conflicts)
    if any(c.kind != "place" for c in conflicts) and (
        not command.force or command.confirmed_conflict_fingerprint != fingerprint
    ):
        raise HTTPException(
            409,
            detail={
                "code": "schedule_conflict",
                "conflicts": [c.model_dump(mode="json") for c in conflicts],
                "conflict_fingerprint": fingerprint,
            },
        )
    return conflicts


def validate_row_settings(cls, row):
    if row.location_type == "online" and cls.capacity > 50:
        raise HTTPException(422, detail={"code": "online_capacity_exceeded"})
    if row.location_type == "offline" and (
        cls.record_video or not (row.location_address or "").strip()
    ):
        raise HTTPException(422, detail={"code": "offline_settings_invalid"})


def create_sessions(db, cls, rows, *, allow_inactive=False, open_now=False):
    sessions = []
    for row in rows:
        validate_row_settings(cls, row)
        host_state = "assigned"
        try:
            validate_instructor(db, cls, row.host_id)
        except HTTPException:
            if not allow_inactive:
                raise
            host_state = "needs_reassign"
        sid = uuid4()
        session = Session(
            id=sid,
            run_id=sid,
            type="meditation",
            class_id=cls.id,
            organization_id=cls.organization_id,
            organization_attribution_known=True,
            title=cls.title,
            host_id=row.host_id,
            host_state=host_state,
            seq=row.seq,
            session_kind=row.session_kind,
            status="open" if open_now else "scheduled",
            opened_at=row.scheduled_at if open_now else None,
            scheduled_at=row.scheduled_at,
            duration_min=row.duration_min,
            participant_mode="group",
            max_participants=cls.capacity,
            linkband_mode=cls.linkband_mode,
            location_type=row.location_type,
            location_address=row.location_address,
            record_audio=cls.record_audio,
            record_video=cls.record_video,
            chat_enabled=cls.chat_enabled,
            sfu_enabled=cls.sfu_enabled,
            webrtc_room_id=uuid4(),
            reminder_offsets=cls.reminder_offsets,
            access_code=None,
            assignment_override=row.assignment_override,
            is_template=False,
        )
        db.add(session)
        db.flush()
        effect(db, cls, "session_prepare", f"prepare:{sid}", {}, sid)
        sessions.append(session)
    for host_id in {
        session.host_id for session in sessions if session.host_state == "assigned"
    }:
        assigned = [
            str(session.id) for session in sessions if session.host_id == host_id
        ]
        effect(
            db,
            cls,
            "session_host_assigned",
            f"assigned:{assigned[0]}:{host_id}",
            {"recipient_id": str(host_id), "session_ids": assigned},
            UUID(assigned[0]),
        )
    return sessions


def _new_class(db, actor, schedule, status):
    membership = (
        db.query(UserOrgMembership)
        .filter(
            UserOrgMembership.user_id == actor.id,
            UserOrgMembership.org_id == actor.org_id,
            UserOrgMembership.status == "active",
        )
        .first()
    )
    if membership is None:
        raise HTTPException(409, detail={"code": "active_membership_required"})
    cls = Class(
        created_by=actor.id,
        title=schedule.title,
        organization_id=membership.org_id,
        organization_attribution_known=True,
        default_duration_min=schedule.duration_min,
        status=status,
        schedule_mode=schedule.schedule_mode,
        planned_session_count=(
            schedule.planned_session_count
            if schedule.schedule_mode == "fixed"
            else None
        ),
        capacity=schedule.capacity,
        participant_mode="group",
        linkband_mode=schedule.linkband_mode,
        location_type=schedule.location_type,
        location_address=schedule.location_address,
        record_audio=schedule.record_audio,
        record_video=schedule.record_video,
        chat_enabled=schedule.chat_enabled,
        reminder_offsets=schedule.reminder_offsets,
        recurrence_rule=schedule.recurrence_rule.model_dump(mode="json"),
        assignment_rule=schedule.assignment_rule.model_dump(mode="json"),
        ends_on=schedule.ends_on,
        revision=1,
        draft_schedule=schedule.model_dump(mode="json") if status == "draft" else None,
    )
    db.add(cls)
    db.flush()
    roles = {row.user_id: row.role for row in schedule.instructors}
    if actor.role == "counselor":
        roles[actor.id] = "lead"
    if "lead" not in roles.values():
        raise HTTPException(422, detail={"code": "lead_required"})
    for user_id, role in roles.items():
        add_instructor(db, cls, user_id, role, actor.id)
    return cls


def create_class(
    db, actor_id, command: CreateClassCommand, now=None, *, operation_digest=None
):
    now = now or datetime.now(timezone.utc)
    actor_id = UUID(str(actor_id))
    schedule = command.schedule
    try:
        ids = {
            actor_id,
            *[r.user_id for r in schedule.instructors],
            *[h for h in schedule.assignment_rule.host_ids if h],
            *[h for h in schedule.assignment_rule.weekday_hosts.values() if h],
            *[r.host_id for r in schedule.rows if r.host_id],
        }
        locked = lock_users(db, ids)
        actor = next((u for u in locked if u.id == actor_id), None)
        if (
            actor is None
            or actor.status != "active"
            or actor.role not in ("counselor", "org_admin")
        ):
            raise HTTPException(403, detail={"code": "class_creation_forbidden"})
        digest = (
            operation_digest
            or hashlib.sha256(f"create:{request_hash(command)}".encode()).hexdigest()
        )
        prior = (
            db.query(ClassOperation)
            .filter(
                ClassOperation.actor_id == actor_id,
                ClassOperation.operation_key == command.operation_key,
            )
            .first()
        )
        if prior:
            if prior.request_hash != digest:
                raise HTTPException(409, detail={"code": "operation_key_reused"})
            result = prior.result
            db.commit()
            return result
        cls = _new_class(db, actor, schedule, command.status)
        sessions = []
        if command.status == "active":
            rows = expand_schedule(schedule, now)
            if not rows or any(r.host_id is None for r in rows):
                raise HTTPException(422, detail={"code": "host_required"})
            check_conflicts(
                db,
                rows,
                actor,
                command,
                class_id=cls.id,
                member_ids=schedule.member_ids,
            )
            cls.access_code = generate_class_code(db)
            sessions = create_sessions(
                db, cls, rows, open_now=schedule.recurrence_rule.start_now
            )
            from app.services.class_membership_service import invite_members

            invite_members(db, cls, schedule.member_ids, actor.id, now)
            if cls.schedule_mode == "rolling":
                from datetime import timedelta
                from app.services.class_schedule_service import KST

                cls.generation_cursor = (
                    min(now.astimezone(KST).date() + timedelta(days=27), cls.ends_on)
                    if cls.ends_on
                    else now.astimezone(KST).date() + timedelta(days=27)
                )
        result = {
            "class_id": str(cls.id),
            "revision": cls.revision,
            "session_ids": [str(s.id) for s in sessions],
            "effects_pending": len(sessions),
            "invitation_results": [],
        }
        db.add(
            ClassOperation(
                actor_id=actor.id,
                operation_key=command.operation_key,
                request_hash=digest,
                class_id=cls.id,
                result=result,
            )
        )
        db.commit()
        return result
    except ClassCodeExhausted:
        db.rollback()
        raise exhausted_http_error()
    except Exception:
        db.rollback()
        raise


def mutate_class(
    db, actor_id, class_id, command, action, callback, permission="manage"
):
    """재시도·역할·버전·잠금을 모든 클래스 쓰기에 동일 적용한다."""
    from app.models.class_program import ClassInstructor
    from app.services.class_access_service import authorize_class_action

    actor_id, class_id = UUID(str(actor_id)), UUID(str(class_id))
    data = (
        command.model_dump(mode="json") if hasattr(command, "model_dump") else command
    )
    try:
        user_ids = {
            actor_id,
            *[
                r[0]
                for r in db.query(ClassInstructor.user_id)
                .filter(ClassInstructor.class_id == class_id)
                .all()
            ],
        }
        for key in ("candidate_host_id", "user_id", "host_id"):
            if data.get(key):
                user_ids.add(UUID(str(data[key])))
        for row in data.get("rows", []):
            if row.get("host_id"):
                user_ids.add(UUID(str(row["host_id"])))
        schedule = data.get("schedule") or {}
        for instructor in schedule.get("instructors", []):
            user_ids.add(UUID(str(instructor["user_id"])))
        users = lock_users(db, user_ids)
        actor = next((u for u in users if u.id == actor_id), None)
        cls = (
            db.query(Class)
            .filter(Class.id == class_id)
            .populate_existing()
            .with_for_update()
            .first()
        )
        if cls is None:
            raise HTTPException(404, detail={"code": "class_not_found"})
        authorize_class_action(db, actor, cls, permission)
        if actor.role == "org_admin" and not (data.get("reason") or "").strip():
            raise HTTPException(422, detail={"code": "reason_required"})
        digest = hashlib.sha256(
            json.dumps(
                {"action": action, "class_id": str(class_id), "body": data},
                sort_keys=True,
                default=str,
            ).encode()
        ).hexdigest()
        prior = (
            db.query(ClassOperation)
            .filter(
                ClassOperation.actor_id == actor_id,
                ClassOperation.operation_key == data["operation_key"],
            )
            .first()
        )
        if prior:
            if prior.request_hash != digest:
                raise HTTPException(409, detail={"code": "operation_key_reused"})
            result = prior.result
            db.commit()
            return result
        if data.get("expected_revision") != cls.revision:
            raise HTTPException(
                409, detail={"code": "stale_class", "revision": cls.revision}
            )
        result = callback(cls, actor, data) or {}
        from app.services.class_access_service import queue_live_reconcile

        if (
            db.query(Session.id)
            .filter(
                Session.class_id == cls.id, Session.status.in_(("open", "in_progress"))
            )
            .first()
        ):
            queue_live_reconcile(db, cls.id)
        cls.revision += 1
        result = {"class_id": str(cls.id), "revision": cls.revision, **result}
        db.add(
            ClassOperation(
                actor_id=actor_id,
                operation_key=data["operation_key"],
                request_hash=digest,
                class_id=cls.id,
                result=result,
            )
        )
        db.commit()
        return result
    except ClassCodeExhausted:
        db.rollback()
        raise exhausted_http_error()
    except Exception:
        db.rollback()
        raise


def publish_class(db, actor_id, class_id, command, now=None):
    now = now or datetime.now(timezone.utc)

    def apply(cls, actor, data):
        from app.services.class_membership_service import invite_members

        if cls.status != "draft" or not cls.draft_schedule:
            raise HTTPException(409, detail={"code": "class_not_draft"})
        schedule = ScheduleInput.model_validate(cls.draft_schedule)
        rows = expand_schedule(schedule, now)
        if not rows or any(r.host_id is None for r in rows):
            raise HTTPException(422, detail={"code": "host_required"})
        check_conflicts(
            db, rows, actor, command, class_id=cls.id, member_ids=schedule.member_ids
        )
        cls.status = "active"
        cls.access_code = generate_class_code(db)
        sessions = create_sessions(
            db, cls, rows, open_now=schedule.recurrence_rule.start_now
        )
        invite_members(db, cls, schedule.member_ids, actor.id, now)
        cls.draft_schedule = None
        if cls.schedule_mode == "rolling":
            from datetime import timedelta
            from app.services.class_schedule_service import KST

            cls.generation_cursor = now.astimezone(KST).date() + timedelta(days=27)
        return {"session_ids": [str(s.id) for s in sessions]}

    return mutate_class(db, actor_id, class_id, command, "publish", apply)


def bulk_update(db, actor_id, class_id, command, now=None, *, preview=False):
    from datetime import timedelta
    from app.schemas.class_scheduling import ScheduleRow, WriteCommand
    from app.services.class_schedule_service import KST

    now = now or datetime.now(timezone.utc)

    def apply(cls, actor, data):
        if cls.status != "active":
            raise HTTPException(409, detail={"code": "class_not_active"})
        ids = {UUID(str(sid)) for sid in data["session_ids"]}
        if not ids or len(ids) != len(data["session_ids"]):
            raise HTTPException(422, detail={"code": "invalid_session_selection"})
        sessions = (
            db.query(Session)
            .filter(Session.class_id == cls.id, Session.id.in_(ids))
            .order_by(Session.id)
            .populate_existing()
            .with_for_update()
            .all()
        )
        if len(sessions) != len(ids):
            raise HTTPException(404, detail={"code": "session_not_found"})
        for session in sessions:
            if (
                session.status not in ("ready", "scheduled")
                or data.get("expected_state_versions", {}).get(str(session.id))
                != session.state_version
            ):
                raise HTTPException(409, detail={"code": "stale_or_uneditable_session"})
        from app.models.class_scheduling import SessionHostRequest

        if (
            db.query(SessionHostRequest)
            .filter(
                SessionHostRequest.session_id.in_(ids),
                SessionHostRequest.status.in_(("requested", "pending_ack")),
            )
            .first()
        ):
            raise HTTPException(409, detail={"code": "host_request_pending"})
        action = data.get("action")
        proposed = []
        replacements = {
            UUID(str(row["session_id"])): ScheduleRow.model_validate(row)
            for row in data.get("rows", [])
        }
        if action == "replace" and set(replacements) != ids:
            raise HTTPException(422, detail={"code": "missing_replacement_rows"})
        old_days = []
        for session in sessions:
            if action == "cancel":
                continue
            if action == "shift_week":
                from app.services.class_conflict_service import utc

                if not session.scheduled_at:
                    raise HTTPException(422, detail={"code": "schedule_required"})
                old_days.append(
                    utc(session.scheduled_at).astimezone(KST).date().isoformat()
                )
                row = ScheduleRow(
                    client_key=str(session.id),
                    session_id=session.id,
                    seq=session.seq,
                    scheduled_at=utc(session.scheduled_at) + timedelta(days=7),
                    duration_min=session.duration_min,
                    host_id=session.host_id,
                    location_type=session.location_type,
                    location_address=session.location_address,
                )
            elif action == "replace":
                row = replacements[session.id]
                if row.seq != session.seq or row.session_kind != session.session_kind:
                    raise HTTPException(422, detail={"code": "sequence_immutable"})
            else:
                raise HTTPException(422, detail={"code": "bulk_action_invalid"})
            if row.scheduled_at <= now or row.host_id is None:
                raise HTTPException(422, detail={"code": "invalid_schedule_row"})
            validate_instructor(db, cls, row.host_id, session.id)
            validate_row_settings(cls, row)
            proposed.append(row)
        common = WriteCommand.model_validate(
            {k: v for k, v in data.items() if k in WriteCommand.model_fields}
        )
        if preview:
            conflicts = detect_conflicts_bulk(
                db,
                proposed,
                ids,
                {"id": str(actor.id), "role": actor.role},
                class_id=cls.id,
            )
            return {
                "rows": [row.model_dump(mode="json") for row in proposed],
                "conflicts": [c.model_dump(mode="json") for c in conflicts],
                "conflict_fingerprint": conflict_fingerprint(conflicts),
                "class_revision": cls.revision,
            }
        check_conflicts(db, proposed, actor, common, ids, class_id=cls.id)
        by_id = {row.session_id: row for row in proposed}
        for session in sessions:
            if action == "cancel":
                session.status = "cancelled"
            else:
                row = by_id[session.id]
                session.scheduled_at = row.scheduled_at
                session.duration_min = row.duration_min
                session.location_type = row.location_type
                session.location_address = row.location_address
                session.assignment_override = True
                if session.host_id != row.host_id:
                    from app.services.class_instructor_service import apply_host_request

                    apply_host_request(
                        db,
                        cls,
                        session,
                        {
                            "candidate_host_id": row.host_id,
                            "expected_state_version": session.state_version,
                            "reason": data.get("reason"),
                        },
                        actor,
                        now,
                        conflicts_checked=True,
                    )
                else:
                    session.state_version += 1
            if action == "cancel":
                session.state_version += 1
        effect(
            db,
            cls,
            "session_updated" if action != "cancel" else "session_cancelled",
            f"schedule:{cls.id}:{cls.revision}",
            {"session_ids": [str(s.id) for s in sessions]},
            sessions[0].id,
        )
        if old_days:
            rule = dict(cls.recurrence_rule or {})
            rule["skip_dates"] = sorted(set(rule.get("skip_dates", [])) | set(old_days))
            cls.recurrence_rule = rule
        return {"session_ids": [str(s.id) for s in sessions]}

    if preview:
        from app.services.class_access_service import authorize_class_action

        actor = db.query(User).filter(User.id == UUID(str(actor_id))).first()
        cls = db.query(Class).filter(Class.id == UUID(str(class_id))).first()
        if cls is None:
            raise HTTPException(404, detail={"code": "class_not_found"})
        authorize_class_action(db, actor, cls, "manage")
        data = (
            command.model_dump(mode="json")
            if hasattr(command, "model_dump")
            else command
        )
        if data.get("expected_revision") != cls.revision:
            raise HTTPException(409, detail={"code": "stale_class"})
        return apply(cls, actor, data)
    return mutate_class(db, actor_id, class_id, command, "bulk", apply)


def preview_bulk(db, actor_id, class_id, command, now=None):
    return bulk_update(db, actor_id, class_id, command, now, preview=True)


def duplicate_class(db, actor_id, class_id, command, now=None):
    from app.models.class_program import ClassInstructor, ClassMember
    from app.services.class_access_service import authorize_class_action

    actor = db.query(User).filter(User.id == UUID(str(actor_id))).first()
    source = db.query(Class).filter(Class.id == UUID(str(class_id))).first()
    if source is None:
        raise HTTPException(404, detail={"code": "class_not_found"})
    authorize_class_action(db, actor, source, "manage")
    # 재시도는 바뀔 수 있는 원본 스냅샷 대신 실제 요청과 원본 ID로 판정한다.
    digest = hashlib.sha256(
        json.dumps(
            {"action": "duplicate", "source_id": str(source.id), "body": command},
            sort_keys=True,
            default=str,
        ).encode()
    ).hexdigest()
    prior = (
        db.query(ClassOperation)
        .filter_by(actor_id=actor.id, operation_key=command["operation_key"])
        .first()
    )
    if prior:
        if prior.request_hash != digest:
            raise HTTPException(409, detail={"code": "operation_key_reused"})
        result = prior.result
        db.commit()
        return result
    if not source.recurrence_rule:
        raise HTTPException(422, detail={"code": "original_pattern_unknown"})
    instructors = (
        db.query(ClassInstructor)
        .join(User, User.id == ClassInstructor.user_id)
        .filter(
            ClassInstructor.class_id == source.id,
            ClassInstructor.status == "active",
            ClassInstructor.role.in_(("lead", "assistant")),
            User.status == "active",
        )
        .all()
    )
    valid_ids = {str(i.user_id) for i in instructors}
    assignment = dict(source.assignment_rule or {})
    assignment["host_ids"] = [
        h if h in valid_ids else None for h in assignment.get("host_ids", [])
    ]
    assignment["weekday_hosts"] = {
        k: v if v in valid_ids else None
        for k, v in assignment.get("weekday_hosts", {}).items()
    }
    recurrence = {
        **source.recurrence_rule,
        "start_date": command["start_date"],
        "skip_dates": [],
        "start_now": False,
    }
    schedule = ScheduleInput(
        title=source.title,
        location_type=source.location_type,
        location_address=source.location_address,
        capacity=source.capacity,
        linkband_mode=source.linkband_mode,
        record_audio=source.record_audio,
        record_video=source.record_video,
        chat_enabled=source.chat_enabled,
        schedule_mode=source.schedule_mode,
        planned_session_count=max(source.planned_session_count or 8, 2),
        duration_min=source.default_duration_min,
        recurrence_rule=recurrence,
        assignment_rule=assignment,
        instructors=[{"user_id": i.user_id, "role": i.role} for i in instructors],
        reminder_offsets=source.reminder_offsets,
        member_ids=(
            [
                m.user_id
                for m in db.query(ClassMember)
                .filter(
                    ClassMember.class_id == source.id,
                    ClassMember.status.in_(("active", "completed")),
                )
                .all()
                if m.user_id
            ]
            if command.get("invite_members")
            else []
        ),
    )
    return create_class(
        db,
        actor_id,
        CreateClassCommand(
            operation_key=command["operation_key"], status="draft", schedule=schedule
        ),
        now=now,
        operation_digest=digest,
    )


def add_session(db, actor_id, class_id, command, now=None):
    from sqlalchemy import func
    from app.schemas.class_scheduling import ScheduleRow, WriteCommand
    from app.models.class_program import ClassMember
    from app.services.class_membership_service import ensure_expected

    now = now or datetime.now(timezone.utc)

    def apply(cls, actor, data):
        row = ScheduleRow.model_validate(data["row"])
        if cls.status not in ("active", "completed") or (
            cls.status == "completed" and cls.schedule_mode != "fixed"
        ):
            raise HTTPException(409, detail={"code": "class_not_active"})
        if row.scheduled_at <= now or row.host_id is None:
            raise HTTPException(422, detail={"code": "invalid_schedule_row"})
        members = None
        if row.session_kind == "makeup":
            source = (
                db.query(Session)
                .filter(
                    Session.id == UUID(str(data.get("makeup_for_session_id"))),
                    Session.class_id == cls.id,
                )
                .first()
            )
            if (
                not source
                or source.status not in ("completed", "cancelled")
                or source.session_kind != "regular"
            ):
                raise HTTPException(409, detail={"code": "makeup_source_invalid"})
            wanted = {UUID(str(uid)) for uid in data.get("member_ids", [])}
            members = (
                db.query(ClassMember)
                .filter(
                    ClassMember.class_id == cls.id,
                    ClassMember.status.in_(
                        ("active", "completed")
                        if cls.status == "completed"
                        else ("active",)
                    ),
                    ClassMember.user_id.in_(wanted),
                )
                .all()
            )
            if len(members) != len(wanted):
                raise HTTPException(422, detail={"code": "makeup_member_invalid"})
        else:
            cls.planned_session_count = (
                (cls.planned_session_count or 0) + 1
                if cls.schedule_mode == "fixed"
                else None
            )
            if cls.status == "completed":
                cls.status = "active"
                cls.access_code = generate_class_code(db)
        seq = (
            db.query(func.max(Session.seq))
            .filter(Session.class_id == cls.id)
            .execution_options(include_hidden=True)
            .scalar()
            or 0
        )
        row = row.model_copy(update={"seq": seq + 1, "assignment_override": True})
        common = WriteCommand.model_validate(
            {k: v for k, v in data.items() if k in WriteCommand.model_fields}
        )
        check_conflicts(db, [row], actor, common, class_id=cls.id)
        sessions = create_sessions(db, cls, [row])
        ensure_expected(db, cls, sessions, members)
        if row.session_kind == "makeup":
            from app.models.session import SessionParticipant

            for participant in (
                db.query(SessionParticipant)
                .filter(SessionParticipant.session_id == sessions[0].id)
                .all()
            ):
                participant.attendance_kind = "makeup"
                participant.makeup_for_session_id = source.id
        recipients = (
            members
            if members is not None
            else db.query(ClassMember).filter_by(class_id=cls.id, status="active").all()
        )
        effect(
            db,
            cls,
            "class_session_added",
            f"added:{sessions[0].id}",
            {
                "recipient_ids": [
                    str(member.user_id) for member in recipients if member.user_id
                ]
            },
            sessions[0].id,
        )
        return {"session_ids": [str(s.id) for s in sessions]}

    return mutate_class(db, actor_id, class_id, command, "add_session", apply)


def transition_class(db, actor_id, class_id, command, now=None):
    from app.models.class_program import ClassMember

    now = now or datetime.now(timezone.utc)

    def apply(cls, actor, data):
        action = data["action"]
        rows = (
            db.query(Session)
            .filter(Session.class_id == cls.id)
            .order_by(Session.id)
            .with_for_update()
            .all()
        )
        if action in ("complete", "cancel"):
            if cls.status != "active" or any(
                s.status in ("open", "in_progress") for s in rows
            ):
                raise HTTPException(409, detail={"code": "class_transition_conflict"})
            if (
                action == "complete"
                and cls.schedule_mode == "fixed"
                and any(
                    s.session_kind == "regular"
                    and s.status not in ("completed", "cancelled")
                    for s in rows
                )
            ):
                raise HTTPException(409, detail={"code": "regular_sessions_remaining"})
            cls.status = "completed" if action == "complete" else "cancelled"
            for session in rows:
                if session.status in ("ready", "scheduled"):
                    session.status = "cancelled"
                    session.state_version += 1
                    effect(
                        db,
                        cls,
                        "session_cancelled",
                        f"close:{cls.id}:{cls.revision}:{session.id}",
                        {},
                        session.id,
                    )
            for member in (
                db.query(ClassMember)
                .filter(ClassMember.class_id == cls.id, ClassMember.status == "active")
                .all()
            ):
                member.status = "completed"
                member.completed_at = now
                effect(
                    db,
                    cls,
                    "class_completed" if action == "complete" else "class_cancelled",
                    f"close:{cls.id}:{cls.revision}:{member.id}",
                    {"recipient_id": str(member.user_id)},
                )
        elif action == "archive" and cls.status in ("completed", "cancelled"):
            cls.archived_from_status = cls.status
            cls.status = "archived"
        elif (
            action == "restore"
            and cls.status == "archived"
            and cls.archived_from_status in ("completed", "cancelled")
        ):
            cls.status = cls.archived_from_status
            cls.archived_from_status = None
        elif action == "hide":
            if any(
                row.status in ("open", "in_progress", "completed")
                or row.started_at is not None
                or row.opened_at is not None
                for row in rows
            ):
                raise HTTPException(409, detail={"code": "archive_required"})
            cls.hidden_at = now
            from app.models.class_scheduling import SessionHostRequest

            for row in rows:
                row.hidden_at = now
                row.state_version += 1
            for request in (
                db.query(SessionHostRequest)
                .filter(
                    SessionHostRequest.session_id.in_([row.id for row in rows]),
                    SessionHostRequest.status.in_(("requested", "pending_ack")),
                )
                .all()
            ):
                request.status = "cancelled"
                request.resolved_at = now
        else:
            raise HTTPException(409, detail={"code": "class_transition_invalid"})
        return {"status": cls.status}

    return mutate_class(db, actor_id, class_id, command, "transition", apply)


def update_class(db, actor_id, class_id, command, now=None):
    """입력 전체를 검증하고 이후 회차 생성 설정을 갱신한다."""
    from app.models.class_program import ClassInstructor, ClassMember
    from app.schemas.class_scheduling import ScheduleInput
    from pydantic import ValidationError

    def apply(cls, actor, data):
        if cls.status not in ("draft", "active"):
            raise HTTPException(409, detail={"code": "class_not_editable"})
        try:
            schedule = ScheduleInput.model_validate(data["schedule"])
        except ValidationError:
            raise HTTPException(422, detail={"code": "invalid_schedule"})
        if cls.status == "active" and (
            schedule.rows or schedule.schedule_mode != cls.schedule_mode
        ):
            raise HTTPException(409, detail={"code": "use_bulk_schedule_edit"})
        if (
            cls.status == "active"
            and db.query(ClassMember)
            .filter_by(class_id=cls.id, status="active")
            .count()
            > schedule.capacity
        ):
            raise HTTPException(409, detail={"code": "class_capacity"})
        if cls.status == "active":
            rule = schedule.assignment_rule
            required = (
                [
                    rule.weekday_hosts.get(day)
                    for day in schedule.recurrence_rule.weekdays
                ]
                if rule.mode == "by_weekday"
                else rule.host_ids
            )
            if (
                not required
                or any(host is None for host in required)
                or (rule.mode == "all_one" and len(required) != 1)
            ):
                raise HTTPException(422, detail={"code": "host_required"})
        for instructor in schedule.instructors:
            add_instructor(db, cls, instructor.user_id, instructor.role, actor.id)
        for host in {
            *schedule.assignment_rule.host_ids,
            *schedule.assignment_rule.weekday_hosts.values(),
        } - {None}:
            validate_instructor(db, cls, host)
        for attr in (
            "title",
            "location_type",
            "location_address",
            "capacity",
            "linkband_mode",
            "record_audio",
            "record_video",
            "chat_enabled",
            "schedule_mode",
            "reminder_offsets",
            "ends_on",
        ):
            setattr(cls, attr, getattr(schedule, attr))
        cls.default_duration_min = schedule.duration_min
        if cls.status == "draft":
            cls.planned_session_count = (
                schedule.planned_session_count
                if schedule.schedule_mode == "fixed"
                else None
            )
            cls.draft_schedule = schedule.model_dump(mode="json")
        cls.recurrence_rule = schedule.recurrence_rule.model_dump(mode="json")
        cls.assignment_rule = schedule.assignment_rule.model_dump(mode="json")
        return {"status": cls.status}

    return mutate_class(db, actor_id, class_id, command, "update", apply)


def correct_host(db, actor_id, class_id, command, now=None):
    from app.models.record import Report
    from app.models.class_scheduling import SessionHostNote
    from app.services.class_instructor_service import _switch_host

    now = now or datetime.now(timezone.utc)

    def apply(cls, actor, data):
        session = (
            db.query(Session)
            .filter(
                Session.class_id == cls.id, Session.id == UUID(str(data["session_id"]))
            )
            .populate_existing()
            .with_for_update()
            .first()
        )
        if not session:
            raise HTTPException(404, detail={"code": "session_not_found"})
        if session.status != "completed" or session.state_version != data.get(
            "expected_state_version"
        ):
            raise HTTPException(409, detail={"code": "host_correction_state"})
        reason = (data.get("reason") or "").strip()
        if not reason:
            raise HTTPException(422, detail={"code": "reason_required"})
        reports = (
            db.query(Report)
            .filter(Report.session_id == session.id)
            .populate_existing()
            .with_for_update()
            .all()
        )
        if data.get("mode") == "note":
            name = (data.get("displayed_host_name") or "").strip()
            if not name or len(name) > 100:
                raise HTTPException(422, detail={"code": "displayed_host_required"})
            note = SessionHostNote(
                session_id=session.id,
                actor_id=actor.id,
                displayed_host_name=name,
                reason=reason,
            )
            db.add(note)
            db.flush()
            return {"note_id": str(note.id)}
        if data.get("mode") != "correct" or not data.get("candidate_host_id"):
            raise HTTPException(422, detail={"code": "correction_mode_invalid"})
        if any(r.status == "completed" or r.approved_at is not None for r in reports):
            raise HTTPException(409, detail={"code": "approved_attribution_immutable"})
        candidate = UUID(str(data["candidate_host_id"]))
        validate_instructor(db, cls, candidate, session.id)
        _switch_host(db, cls, session, candidate, actor, reason, now)
        for report in reports:
            if report.type == "counselor":
                report.user_id = candidate
        return {"session_id": str(session.id), "host_id": str(candidate)}

    return mutate_class(db, actor_id, class_id, command, "host_correction", apply)


def lock_class_session(db, session, actor_id=None):
    """공유 엔진도 편성·정지와 같은 사용자→클래스→회차 잠금 순서를 따른다."""
    from app.models.class_program import ClassInstructor

    ids = [
        r[0]
        for r in db.query(ClassInstructor.user_id)
        .filter_by(class_id=session.class_id)
        .all()
    ]
    if actor_id:
        ids.append(UUID(str(actor_id)))
    lock_users(db, ids)
    cls = (
        db.query(Class)
        .filter_by(id=session.class_id)
        .populate_existing()
        .with_for_update()
        .first()
    )
    row = (
        db.query(Session)
        .filter_by(id=session.id)
        .populate_existing()
        .with_for_update()
        .one()
    )
    return cls, row
