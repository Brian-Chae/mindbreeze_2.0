"""클래스 읽기(SDD-214)와 편성·강사·최소 멤버십(SDD-216) API."""

from fastapi import APIRouter, BackgroundTasks, Depends, Query, HTTPException, Request, Header
from app.core.redis import get_redis
from app.schemas.class_scheduling import (
    UpdateClassCommand,
    InstructorRoleCommand,
    EmailInvitesCommand,
    ClassCodeInput,
    HostCorrectionCommand,
)
from datetime import datetime, timezone
from uuid import UUID
from app.config import settings
from app.models.class_program import Class, ClassInstructor, ClassMember
from app.models.class_scheduling import ClassEmailInvite, SessionHostRequest
from app.models.session import Session
from app.models.user import User
from app.schemas.class_scheduling import (
    ScheduleInput,
    CreateClassCommand,
    WriteCommand,
    BulkCommand,
    DuplicateCommand,
    AddSessionCommand,
    TransitionCommand,
    InstructorCommand,
    MembersCommand,
    HostRequestCommand,
    ResolveHostCommand,
)
from app.services import class_write_service as writes
from app.services.class_access_service import authorize_class_action
from sqlalchemy.orm import Session as DBSession

from app.api.deps import get_current_user, get_current_user_optional
from app.core.database import get_db
from app.schemas.class_parent import (
    ClassMemberCandidatesResponse,
    ClassDetail,
    ClassListResponse,
    ClassSessionsResponse,
)
from app.services import class_read_service

router = APIRouter(prefix="/classes", tags=["classes"])


def queue_class_effects(result, background_tasks, db):
    from app.services.class_effect_service import dispatch_class_effects

    cls = db.get(Class, UUID(result["class_id"]))
    if cls is not None and (cls.recurrence_rule or {}).get("start_now"):
        background_tasks.add_task(dispatch_class_effects, result["class_id"])
    return result


@router.get("", response_model=ClassListResponse, response_model_exclude_unset=True)
def list_classes(
    status: str | None = Query(default=None, max_length=12),
    page: int | None = Query(default=None, ge=1),
    limit: int | None = Query(default=None, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
) -> dict:
    classes, total = class_read_service.list_classes(
        current_user["id"], db, status=status, page=page, limit=limit
    )
    return ClassListResponse(classes=classes, total=total)


def scheduling_enabled():
    if not settings.class_scheduling_enabled:
        raise HTTPException(404, detail={"code": "class_scheduling_disabled"})


def load_class_actor(db, class_id, current_user, action="view"):
    cls = db.query(Class).filter(Class.id == class_id).first()
    actor = db.query(User).filter(User.id == UUID(str(current_user["id"]))).first()
    if cls is None:
        raise HTTPException(404, detail={"code": "class_not_found"})
    authorize_class_action(db, actor, cls, action)
    return cls, actor


@router.get(
    "/member-candidates",
    response_model=ClassMemberCandidatesResponse,
    dependencies=[Depends(scheduling_enabled)],
)
def list_member_candidates(
    class_id: UUID | None = Query(default=None),
    q: str = Query(default="", max_length=254),
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
) -> dict:
    return class_read_service.list_member_candidates(
        db, current_user["id"], class_id=class_id, query=q
    )


@router.get("/instructor-candidates", dependencies=[Depends(scheduling_enabled)])
def list_instructor_candidates(
    class_id: UUID | None = Query(default=None),
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
) -> dict:
    from app.models.user_org_membership import UserOrgMembership
    from app.services.class_access_service import active_membership

    if class_id is not None:
        cls, _ = load_class_actor(db, class_id, current_user, "manage")
        org_id = cls.organization_id
    else:
        actor = db.query(User).filter(User.id == UUID(str(current_user["id"]))).first()
        if (
            actor is None
            or actor.status != "active"
            or actor.role not in ("counselor", "org_admin")
            or not active_membership(db, actor.id, actor.org_id, actor.role)
        ):
            raise HTTPException(403, detail={"code": "class_creation_forbidden"})
        org_id = actor.org_id
    candidates = (
        db.query(User)
        .join(UserOrgMembership, UserOrgMembership.user_id == User.id)
        .filter(
            UserOrgMembership.org_id == org_id,
            UserOrgMembership.status == "active",
            UserOrgMembership.role == "counselor",
            User.status == "active",
            User.role == "counselor",
        )
        .order_by(User.name, User.id)
        .all()
    )
    return {
        "instructors": [{"id": str(row.id), "name": row.name} for row in candidates]
    }


@router.post("/preview-schedule", dependencies=[Depends(scheduling_enabled)])
def preview_schedule(
    payload: ScheduleInput,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
) -> dict:
    from types import SimpleNamespace
    from app.services.class_schedule_service import expand_schedule
    from app.services.class_conflict_service import (
        detect_conflicts_bulk,
        conflict_fingerprint,
    )
    from app.services.class_instructor_service import eligible_user
    import hashlib

    actor = db.query(User).filter(User.id == UUID(str(current_user["id"]))).first()
    if (
        not actor
        or actor.status != "active"
        or actor.role not in ("counselor", "org_admin")
    ):
        raise HTTPException(403, detail={"code": "class_creation_forbidden"})
    rows = expand_schedule(payload, datetime.now(timezone.utc))
    for host in {r.host_id for r in rows if r.host_id}:
        eligible_user(db, SimpleNamespace(organization_id=actor.org_id), host)
    conflicts = detect_conflicts_bulk(
        db, rows, set(), current_user, member_ids=payload.member_ids
    )
    return {
        "rows": rows,
        "conflicts": conflicts,
        "warnings": [],
        "input_hash": hashlib.sha256(payload.model_dump_json().encode()).hexdigest(),
        "conflict_fingerprint": conflict_fingerprint(conflicts),
        "class_revision": None,
    }


@router.post("", status_code=201, dependencies=[Depends(scheduling_enabled)])
def create_class(
    payload: CreateClassCommand,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
) -> dict:
    result = writes.create_class(db, current_user["id"], payload)
    return queue_class_effects(result, background_tasks, db)


@router.patch("/{class_id}", dependencies=[Depends(scheduling_enabled)])
def update_class(
    class_id: UUID,
    payload: UpdateClassCommand,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
) -> dict:
    return writes.update_class(db, current_user["id"], class_id, payload)


@router.post("/{class_id}/schedule/preview", dependencies=[Depends(scheduling_enabled)])
def preview_bulk(
    class_id: UUID,
    payload: BulkCommand,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
) -> dict:
    return writes.preview_bulk(db, current_user["id"], class_id, payload)


@router.patch(
    "/{class_id}/instructors/{user_id}", dependencies=[Depends(scheduling_enabled)]
)
def update_instructor(
    class_id: UUID,
    user_id: UUID,
    payload: InstructorRoleCommand,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
) -> dict:
    from app.services.class_instructor_service import add_instructor

    data = {**payload.model_dump(mode="json"), "user_id": str(user_id)}

    def apply(cls, actor, command):
        row = add_instructor(
            db, cls, user_id, payload.role, actor.id, payload.scope_session_id
        )
        return {"user_id": str(row.user_id), "role": row.role}

    return writes.mutate_class(
        db, current_user["id"], class_id, data, "instructor_role", apply
    )


@router.get("/{class_id}/email-invites", dependencies=[Depends(scheduling_enabled)])
def list_email_invites(
    class_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
) -> dict:
    cls, _ = load_class_actor(db, class_id, current_user, "invite")
    if cls.hidden_at is not None:
        raise HTTPException(404, detail={"code": "class_not_found"})
    rows = (
        db.query(ClassEmailInvite)
        .filter(ClassEmailInvite.class_id == class_id)
        .order_by(ClassEmailInvite.created_at, ClassEmailInvite.id)
        .all()
    )
    return {
        "invitations": [
            {
                "id": str(row.id),
                "email": row.email_norm,
                "status": row.status,
                "created_at": row.created_at,
                "sent_at": row.sent_at,
            }
            for row in rows
        ]
    }


@router.post("/{class_id}/email-invites", dependencies=[Depends(scheduling_enabled)])
def invite_emails(
    class_id: UUID,
    payload: EmailInvitesCommand,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
) -> dict:
    from app.services.class_membership_service import invite_emails

    def apply(cls, actor, data):
        rows = invite_emails(db, cls, payload.emails, actor.id)
        return {
            "invitations": [
                {"id": str(r.id), "email": r.email_norm, "status": r.status}
                for r in rows
            ]
        }

    result = writes.mutate_class(
        db, current_user["id"], class_id, payload, "email_invite", apply, "invite"
    )
    return queue_class_effects(result, background_tasks, db)


@router.post(
    "/{class_id}/email-invites/{invite_id}/retry",
    dependencies=[Depends(scheduling_enabled)],
)
def retry_email(
    class_id: UUID,
    invite_id: UUID,
    payload: WriteCommand,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
) -> dict:
    from app.services.class_membership_service import retry_email

    data = {**payload.model_dump(mode="json"), "invite_id": str(invite_id)}

    def apply(cls, actor, command):
        row = retry_email(db, cls, invite_id)
        return {"invite_id": str(row.id), "status": row.status}

    result = writes.mutate_class(
        db, current_user["id"], class_id, data, "email_retry", apply, "invite"
    )
    return queue_class_effects(result, background_tasks, db)


async def code_limited(request, redis, code, callback):
    from app.services import class_code_attempt_service as attempts, class_code_service
    from starlette.concurrency import run_in_threadpool
    from app.api.v1.session import _client_ip

    ip = _client_ip(request)
    await attempts.check_allowed(redis, ip)
    await attempts.note_code_request(
        redis, class_code_service.normalize_class_code(code)
    )
    try:
        return await run_in_threadpool(callback)
    except HTTPException as exc:
        if exc.status_code == 404:
            await attempts.record_failure(redis, ip)
        raise


@router.post("/resolve-code", dependencies=[Depends(scheduling_enabled)])
async def resolve_code(
    payload: ClassCodeInput,
    request: Request,
    db: DBSession = Depends(get_db),
    redis=Depends(get_redis),
) -> dict:
    from app.services.class_code_service import resolve_class_code

    return await code_limited(
        request, redis, payload.code, lambda: resolve_class_code(db, payload.code)
    )


@router.post("/{class_id}/join", dependencies=[Depends(scheduling_enabled)])
async def join_class(
    class_id: UUID,
    payload: ClassCodeInput,
    request: Request,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
    redis=Depends(get_redis),
) -> dict:
    from app.services.class_code_service import join_class_code

    return await code_limited(
        request,
        redis,
        payload.code,
        lambda: join_class_code(db, class_id, current_user["id"], payload.code),
    )


@router.post("/{class_id}/publish", dependencies=[Depends(scheduling_enabled)])
def publish_class(
    class_id: UUID,
    payload: WriteCommand,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
) -> dict:
    result = writes.publish_class(db, current_user["id"], class_id, payload)
    return queue_class_effects(result, background_tasks, db)


@router.post(
    "/{class_id}/duplicate", status_code=201, dependencies=[Depends(scheduling_enabled)]
)
def duplicate_class(
    class_id: UUID,
    payload: DuplicateCommand,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
) -> dict:
    return writes.duplicate_class(
        db, current_user["id"], class_id, payload.model_dump(mode="json")
    )


@router.patch("/{class_id}/sessions/bulk", dependencies=[Depends(scheduling_enabled)])
def bulk_update(
    class_id: UUID,
    payload: BulkCommand,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
) -> dict:
    return writes.bulk_update(
        db, current_user["id"], class_id, payload.model_dump(mode="json")
    )


@router.post(
    "/{class_id}/sessions", status_code=201, dependencies=[Depends(scheduling_enabled)]
)
def add_session(
    class_id: UUID,
    payload: AddSessionCommand,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
) -> dict:
    return writes.add_session(
        db, current_user["id"], class_id, payload.model_dump(mode="json")
    )


@router.post("/{class_id}/transition", dependencies=[Depends(scheduling_enabled)])
def transition_class(
    class_id: UUID,
    payload: TransitionCommand,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
) -> dict:
    return writes.transition_class(
        db, current_user["id"], class_id, payload.model_dump(mode="json")
    )


@router.delete("/{class_id}", dependencies=[Depends(scheduling_enabled)])
def hide_class(
    class_id: UUID,
    payload: WriteCommand,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
) -> dict:
    return writes.transition_class(
        db,
        current_user["id"],
        class_id,
        {**payload.model_dump(mode="json"), "action": "hide"},
    )


@router.post("/{class_id}/roll-forward", dependencies=[Depends(scheduling_enabled)])
def roll_forward(
    class_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
) -> dict:
    from app.services.class_rolling_service import roll_forward

    load_class_actor(db, class_id, current_user, "manage")
    return roll_forward(db, class_id)


@router.get("/{class_id}/instructors")
def list_instructors(
    class_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
) -> dict:
    load_class_actor(db, class_id, current_user, "invite")
    return {
        "instructors": [
            {
                "user_id": str(i.user_id),
                "role": i.role,
                "status": i.status,
                "scope_session_id": i.scope_session_id,
            }
            for i in db.query(ClassInstructor)
            .filter(ClassInstructor.class_id == class_id)
            .all()
        ]
    }


@router.post("/{class_id}/instructors", dependencies=[Depends(scheduling_enabled)])
def add_instructor(
    class_id: UUID,
    payload: InstructorCommand,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
) -> dict:
    from app.services.class_instructor_service import add_instructor

    def apply(cls, actor, data):
        row = add_instructor(
            db, cls, payload.user_id, payload.role, actor.id, payload.scope_session_id
        )
        return {"user_id": str(row.user_id), "role": row.role, "status": row.status}

    return writes.mutate_class(
        db, current_user["id"], class_id, payload, "instructor_add", apply
    )


@router.delete(
    "/{class_id}/instructors/{user_id}", dependencies=[Depends(scheduling_enabled)]
)
def remove_instructor(
    class_id: UUID,
    user_id: UUID,
    payload: WriteCommand,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
) -> dict:
    from app.services.class_instructor_service import remove_instructor

    data = {**payload.model_dump(mode="json"), "user_id": str(user_id)}

    def apply(cls, actor, command):
        remove_instructor(db, cls, user_id)
        return {"user_id": str(user_id), "status": "removed"}

    return writes.mutate_class(
        db, current_user["id"], class_id, data, "instructor_remove", apply
    )


@router.get("/{class_id}/members")
def list_members(
    class_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
) -> dict:
    load_class_actor(db, class_id, current_user, "invite")
    return {
        "members": [
            {
                "id": str(m.id),
                "user_id": str(m.user_id) if m.user_id is not None else None,
                "name": name,
                "status": m.status,
            }
            for m, name in db.query(ClassMember, User.name)
            .outerjoin(User, User.id == ClassMember.user_id)
            .filter(ClassMember.class_id == class_id)
            .all()
        ]
    }


@router.post("/{class_id}/members", dependencies=[Depends(scheduling_enabled)])
def invite_members(
    class_id: UUID,
    payload: MembersCommand,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
) -> dict:
    from app.services.class_membership_service import invite_members

    def apply(cls, actor, data):
        members = invite_members(
            db,
            cls,
            payload.user_ids,
            actor.id,
            datetime.now(timezone.utc),
            reactivate=payload.reactivate,
        )
        return {"member_ids": [str(m.id) for m in members]}

    result = writes.mutate_class(
        db, current_user["id"], class_id, payload, "invite", apply, "invite"
    )
    return queue_class_effects(result, background_tasks, db)


@router.get("/{class_id}/sessions/{session_id}/reports")
def list_session_reports(
    class_id: UUID,
    session_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
) -> dict:
    from app.models.record import Report
    from app.services.class_access_service import (
        admin_can_read_meditation_report,
        can_read_team_material,
    )

    # 회원 본인 리포트는 기존 경로를 사용한다. 대강도 현재 진행자일 때만 허용한다.
    cls, actor = load_class_actor(db, class_id, current_user, "host_request")
    session = (
        db.query(Session)
        .filter(
            Session.id == session_id,
            Session.class_id == class_id,
            Session.hidden_at.is_(None),
        )
        .first()
    )
    if cls.hidden_at is not None or session is None:
        raise HTTPException(404, detail={"code": "session_not_found"})
    allowed = (
        admin_can_read_meditation_report(db, actor, session)
        if actor.role == "org_admin"
        else session.host_id == actor.id or can_read_team_material(db, actor.id, session)
    )
    if not allowed:
        raise HTTPException(403, detail={"code": "report_read_forbidden"})
    return {
        "reports": [
            {"id": str(row.id), "type": row.type, "status": row.status}
            for row in db.query(Report.id, Report.type, Report.status)
            .filter(Report.session_id == session_id)
            .order_by(Report.created_at, Report.id)
            .all()
        ]
    }


@router.get(
    "/{class_id}/sessions/{session_id}/host-requests",
    dependencies=[Depends(scheduling_enabled)],
)
def list_host_requests(
    class_id: UUID,
    session_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
) -> dict:
    from sqlalchemy import or_
    from app.services.class_access_service import class_role
    from app.services.class_instructor_service import validate_instructor

    cls, actor = load_class_actor(db, class_id, current_user, "host_request")
    session = (
        db.query(Session)
        .filter(
            Session.id == session_id,
            Session.class_id == class_id,
            Session.hidden_at.is_(None),
        )
        .first()
    )
    if cls.hidden_at is not None or session is None:
        raise HTTPException(404, detail={"code": "session_not_found"})
    role = class_role(db, actor, cls)
    if role == "guest":
        try:
            validate_instructor(db, cls, actor.id, session.id)
        except HTTPException:
            raise HTTPException(404, detail={"code": "session_not_found"}) from None
    query = db.query(SessionHostRequest).filter(
        SessionHostRequest.session_id == session_id
    )
    if role not in ("lead", "org_admin") and session.host_id != actor.id:
        query = query.filter(
            or_(
                SessionHostRequest.requested_by == actor.id,
                SessionHostRequest.candidate_host_id == actor.id,
            )
        )
    return {
        "requests": [
            {
                "id": str(row.id),
                "session_id": str(row.session_id),
                "requested_by": str(row.requested_by),
                "candidate_host_id": str(row.candidate_host_id),
                "request_kind": row.request_kind,
                "status": row.status,
                "expected_state_version": row.expected_state_version,
                "expires_at": row.expires_at,
                "created_at": row.created_at,
                "resolved_at": row.resolved_at,
            }
            for row in query.order_by(
                SessionHostRequest.created_at, SessionHostRequest.id
            ).all()
        ]
    }


@router.post(
    "/{class_id}/sessions/{session_id}/host-requests",
    dependencies=[Depends(scheduling_enabled)],
)
def request_host(
    class_id: UUID,
    session_id: UUID,
    payload: HostRequestCommand,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
) -> dict:
    from app.services.class_instructor_service import apply_host_request

    data = {**payload.model_dump(mode="json"), "session_id": str(session_id)}

    def apply(cls, actor, command):
        session = (
            db.query(Session)
            .filter(Session.id == session_id, Session.class_id == class_id)
            .with_for_update()
            .first()
        )
        if not session:
            raise HTTPException(404, detail={"code": "session_not_found"})
        request = apply_host_request(
            db, cls, session, command, actor, datetime.now(timezone.utc)
        )
        return {"request_id": str(request.id), "status": request.status}

    return writes.mutate_class(
        db, current_user["id"], class_id, data, "host_request", apply, "host_request"
    )


@router.post(
    "/{class_id}/sessions/{session_id}/host-requests/{request_id}/resolve",
    dependencies=[Depends(scheduling_enabled)],
)
def resolve_host(
    class_id: UUID,
    session_id: UUID,
    request_id: UUID,
    payload: ResolveHostCommand,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
) -> dict:
    from app.services.class_instructor_service import resolve_host_request

    data = {
        **payload.model_dump(mode="json"),
        "session_id": str(session_id),
        "request_id": str(request_id),
    }

    def apply(cls, actor, command):
        session = (
            db.query(Session)
            .filter(Session.id == session_id, Session.class_id == class_id)
            .with_for_update()
            .first()
        )
        request = (
            db.query(SessionHostRequest)
            .filter(
                SessionHostRequest.id == request_id,
                SessionHostRequest.session_id == session_id,
            )
            .with_for_update()
            .first()
        )
        if not session or not request:
            raise HTTPException(404, detail={"code": "host_request_not_found"})
        resolve_host_request(
            db,
            cls,
            session,
            request,
            payload.action,
            actor,
            datetime.now(timezone.utc),
            force=payload.force,
            fingerprint=payload.confirmed_conflict_fingerprint,
        )
        return {"request_id": str(request.id), "status": request.status}

    return writes.mutate_class(
        db, current_user["id"], class_id, data, "host_resolve", apply, "host_resolve"
    )


@router.post(
    "/{class_id}/sessions/{session_id}/observe",
    dependencies=[Depends(scheduling_enabled)],
)
def observe(
    class_id: UUID,
    session_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
) -> dict:
    from app.services.class_access_service import observe_session

    return observe_session(db, current_user["id"], class_id, session_id)


@router.post(
    "/{class_id}/sessions/{session_id}/host-correction",
    dependencies=[Depends(scheduling_enabled)],
)
def correct_host(
    class_id: UUID,
    session_id: UUID,
    payload: HostCorrectionCommand,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
) -> dict:
    data = {**payload.model_dump(mode="json"), "session_id": str(session_id)}
    return writes.correct_host(db, current_user["id"], class_id, data)


@router.get("/reassignment-queue", dependencies=[Depends(scheduling_enabled)])
def reassignment_queue(
    current_user: dict = Depends(get_current_user), db: DBSession = Depends(get_db)
) -> dict:
    from app.models.user_org_membership import UserOrgMembership
    from app.services.class_access_service import active_membership

    actor = db.query(User).filter_by(id=UUID(str(current_user["id"]))).first()
    if not actor or actor.status != "active" or actor.role != "org_admin":
        raise HTTPException(403, detail={"code": "administrator_required"})
    orgs = [
        m.org_id
        for m in db.query(UserOrgMembership)
        .filter_by(user_id=actor.id, role="org_admin", status="active")
        .all()
        if active_membership(db, actor.id, m.org_id, "org_admin")
    ]
    rows = (
        db.query(Session, Class)
        .join(Class, Class.id == Session.class_id)
        .filter(
            Class.organization_id.in_(orgs),
            Session.host_state == "needs_reassign",
            Session.status.in_(("ready", "scheduled")),
        )
        .order_by(Session.scheduled_at, Session.id)
        .all()
    )
    return {
        "sessions": [
            {
                "class_id": str(cls.id),
                "session_id": str(row.id),
                "title": cls.title,
                "seq": row.seq,
                "scheduled_at": row.scheduled_at,
                "host_state": row.host_state,
            }
            for row, cls in rows
        ]
    }


@router.get("/{class_id}", response_model=ClassDetail)
def get_class(
    class_id: str,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
) -> dict:
    return class_read_service.get_class_detail(class_id, current_user["id"], db)


@router.get("/{class_id}/sessions", response_model=ClassSessionsResponse, response_model_exclude_unset=True)
def list_class_sessions(
    class_id: str,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
) -> dict:
    sessions, total = class_read_service.list_class_sessions(
        class_id, current_user["id"], db
    )
    return ClassSessionsResponse(sessions=sessions, total=total)


@router.get("/{class_id}/me/membership", dependencies=[Depends(scheduling_enabled)])
def my_membership(class_id: UUID, current_user: dict | None = Depends(get_current_user_optional),
    member_credential: str | None = Header(default=None, alias="X-Class-Member-Credential"), db: DBSession = Depends(get_db)):
    return class_read_service.get_my_membership(db, class_id,
        user_id=current_user["id"] if current_user else None, member_credential=member_credential)


@router.get("/{class_id}/me/attendance", dependencies=[Depends(scheduling_enabled)])
def my_attendance(class_id: UUID, current_user: dict | None = Depends(get_current_user_optional),
    member_credential: str | None = Header(default=None, alias="X-Class-Member-Credential"), db: DBSession = Depends(get_db)):
    return class_read_service.get_my_attendance(db, class_id,
        user_id=current_user["id"] if current_user else None, member_credential=member_credential)
