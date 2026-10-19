"""SDD-214: 클래스·상담 읽기 서비스.

기존 단건 부모는 세션 가시 범위를 유지한다. SDD-216 편성 부모는 현재 강사·멤버·기관 관리자
역할로 판정하며 초안은 관리 권한자만 조회한다. 센터 관리자의 상담 조회는 운영 메타만 제공한다.
EEG·녹음·전사·리포트 본문은 조회하지 않는다(진행 상태 값만).
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import or_, and_
from sqlalchemy.orm import Session as DBSession

from app.config import settings
from app.models.class_program import Class, ClassInstructor, ClassMember
from app.models.counseling import CounselingGuest, CounselingRelationship
from app.models.record import Report, SessionRecord
from app.models.session import Session, SessionParticipant
from app.models.user import User

# 미존재·접근 불가·숨김을 구분하지 않는 단일 404 문구(기존 세션 API 의 404 문구 재사용). 403 은 쓰지 않는다.
NOT_FOUND = "세션을 찾을 수 없습니다"
PLACEHOLDER_CLIENT_LABEL = "내담자 미지정"
AREA_MEDITATION = "meditation"
AREA_COUNSELING = "counseling"

_OPEN_STATUSES = ("open", "in_progress")
_FINISHED_STATUSES = ("cancelled", "completed")
# 리포트 생성 진행 상태의 진행도 순서(높을수록 앞선 단계). 여러 리포트가 있으면 가장 앞선 값을 보인다.
_REPORT_RANK = {"pending": 0, "processing": 1, "partial": 2, "ready": 3}


def _to_uuid(value: str | UUID) -> UUID:
    try:
        return UUID(str(value))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="잘못된 ID 형식입니다")


def list_member_candidates(db, actor_id, *, class_id=None, query=""):
    """초대 가능 관계의 이름 검색과 정확 이메일 검색만 제공한다."""
    from sqlalchemy import func
    from app.models.client_counselor_link import ClientCounselorLink
    from app.models.user_org_membership import UserOrgMembership
    from app.services.class_access_service import (
        active_membership,
        authorize_class_action,
    )
    from app.services.session_email_invite_service import is_valid_email

    actor = db.query(User).filter(User.id == _to_uuid(actor_id)).first()
    if class_id is not None:
        cls = db.query(Class).filter(Class.id == class_id, Class.hidden_at.is_(None)).first()
        if cls is None:
            raise HTTPException(404, detail={"code": "class_not_found"})
        authorize_class_action(db, actor, cls, "invite")
        org_id = cls.organization_id
    else:
        if (
            actor is None
            or actor.status != "active"
            or actor.role not in ("counselor", "org_admin")
            or not active_membership(db, actor.id, actor.org_id, actor.role)
        ):
            raise HTTPException(403, detail={"code": "class_creation_forbidden"})
        org_id = actor.org_id

    value = query.strip().lower()
    candidates = db.query(User).filter(User.role == "client", User.status == "active")
    if "@" in value:
        if not is_valid_email(value):
            return {"members": [], "has_more": False}
        candidates = candidates.filter(func.lower(User.email) == value)
    else:
        # 이름 검색에서 기관 전체 사용자 디렉터리나 상담 내용을 노출하지 않는다.
        classes = db.query(Class.id).filter(
            Class.organization_id == org_id, Class.hidden_at.is_(None)
        )
        linked = db.query(ClientCounselorLink.client_id).filter(
            ClientCounselorLink.status == "active"
        )
        if actor.role == "org_admin":
            counselors = db.query(User.id).join(
                UserOrgMembership, UserOrgMembership.user_id == User.id
            ).filter(
                User.role == "counselor", User.status == "active",
                UserOrgMembership.org_id == org_id,
                UserOrgMembership.role == "counselor",
                UserOrgMembership.status == "active",
            )
            linked = linked.filter(ClientCounselorLink.counselor_id.in_(counselors))
        else:
            invited_classes = db.query(ClassInstructor.class_id).filter(
                ClassInstructor.user_id == actor.id,
                ClassInstructor.status == "active",
                ClassInstructor.role.in_(("lead", "assistant")),
            )
            classes = classes.filter(Class.id.in_(invited_classes))
            linked = linked.filter(ClientCounselorLink.counselor_id == actor.id)
        members = db.query(ClassMember.user_id).filter(ClassMember.class_id.in_(classes))
        candidates = candidates.filter(or_(User.id.in_(members), User.id.in_(linked)))
        if value:
            candidates = candidates.filter(func.lower(User.name).contains(value, autoescape=True))
    rows = candidates.order_by(User.name, User.id).limit(21).all()
    return {
        "members": [
            {
                "id": str(row.id), "name": row.name,
                "masked_email": f"{row.email.partition('@')[0][:2]}***@{row.email.partition('@')[2]}",
            }
            for row in rows[:20]
        ],
        "has_more": len(rows) > 20,
    }


def _aware(value: datetime | None) -> datetime | None:
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _visible_session_filter(uid: UUID, db: DBSession):
    """session_service.list_sessions 와 같은 조건: 비템플릿 + (호스트 또는 참여자)."""
    participates = (
        db.query(SessionParticipant.id)
        .filter(SessionParticipant.session_id == Session.id, SessionParticipant.user_id == uid)
        .exists()
    )
    from app.models.user_org_membership import UserOrgMembership
    from app.models.organization import Organization
    admin_orgs=db.query(UserOrgMembership.org_id).join(User,User.id==UserOrgMembership.user_id).join(
        Organization,Organization.id==UserOrgMembership.org_id).filter(UserOrgMembership.user_id==uid,
        UserOrgMembership.role=="org_admin",UserOrgMembership.status=="active",User.role=="org_admin",
        User.status=="active",Organization.deactivated_at.is_(None))
    metadata=and_(Session.organization_attribution_known.is_(True),Session.organization_id.in_(admin_orgs))
    return (Session.is_template.is_(False), or_(Session.host_id == uid, participates,metadata))


def _user_names(db: DBSession, user_ids) -> dict[UUID, str | None]:
    ids = {uid for uid in user_ids if uid}
    if not ids:
        return {}
    return {row[0]: row[1] for row in db.query(User.id, User.name).filter(User.id.in_(ids)).all()}


def _next_session(rows: list, now: datetime):
    """가장 가까운 미래의 미종료 회차. 일정 없는 회차는 후보가 아니다."""
    candidates = [
        r for r in rows
        if r.status not in _FINISHED_STATUSES and r.scheduled_at is not None and _aware(r.scheduled_at) >= now
    ]
    return min(candidates, key=lambda r: (_aware(r.scheduled_at), r.seq or 0), default=None)


# ───────────────────────── 클래스 ─────────────────────────


def _class_summary(cls: Class, rows: list, names: dict, now: datetime) -> dict:
    completed = sum(1 for r in rows if r.status == "completed" and r.session_kind == "regular")
    cancelled = sum(1 for r in rows if r.status == "cancelled" and r.session_kind == "regular")
    # 계획 횟수가 있어도 취소 회차는 분모에서 뺀다(verify RD-10). 취소가 계획보다 많아도 음수가 되지 않는다.
    total = max(cls.planned_session_count - cancelled, 0) if cls.planned_session_count else sum(r.session_kind == "regular" for r in rows) - cancelled
    nxt = _next_session(rows, now)
    return {
        "id": str(cls.id),
        "title": cls.title,
        "status": cls.status,
        "schedule_mode": cls.schedule_mode,
        "planned_session_count": cls.planned_session_count,
        "area": AREA_MEDITATION,
        "progress": {"completed": completed, "total": total},
        "session_count": len(rows),
        "next_session": (
            {
                "id": str(nxt.id),
                "seq": nxt.seq,
                "scheduled_at": nxt.scheduled_at,
                "status": nxt.status,
                "host": {"id": str(nxt.host_id), "name": names.get(nxt.host_id)} if nxt.host_state == "assigned" else None,
            }
            if nxt
            else None
        ),
        "has_open_session": any(r.status in _OPEN_STATUSES for r in rows),
    }


def _class_access_ids(db, uid):
    from app.models.user_org_membership import UserOrgMembership
    from app.models.organization import Organization
    memberships = db.query(UserOrgMembership.org_id).join(User, User.id == UserOrgMembership.user_id).join(
        Organization, Organization.id == UserOrgMembership.org_id).filter(
        UserOrgMembership.user_id == uid, UserOrgMembership.status == "active", User.status == "active",
        Organization.deactivated_at.is_(None),
    )
    instructor_ids = db.query(ClassInstructor.class_id).join(Class, Class.id == ClassInstructor.class_id).filter(
        ClassInstructor.user_id == uid, ClassInstructor.status == "active", ClassInstructor.role.in_(("lead", "assistant")),
        Class.organization_id.in_(memberships.filter(UserOrgMembership.role == "counselor", User.role == "counselor")),
    )
    member_ids = db.query(ClassMember.class_id).filter(ClassMember.user_id == uid, ClassMember.status.in_(("active", "waitlisted", "completed", "left", "removed")))
    admin_orgs = memberships.filter(UserOrgMembership.role == "org_admin")
    return db.query(Class.id).filter(or_(Class.id.in_(instructor_ids),
        and_(Class.id.in_(member_ids), Class.status != "draft"), Class.organization_id.in_(admin_orgs)))


def _legacy_class_sessions_filter(db, uid):
    # 기존 단건 엔진의 부모는 편성 규칙이 없다. 제거 강사에게 개설자 영구 권한을 주지 않는다.
    removed = db.query(ClassInstructor.class_id).filter(ClassInstructor.user_id == uid, ClassInstructor.status == "removed")
    legacy = db.query(Class.id).filter(Class.recurrence_rule.is_(None), Class.id.notin_(removed))
    return and_(Session.class_id.in_(legacy), *_visible_session_filter(uid, db))


def _visible_class_sessions(db: DBSession, uid: UUID, class_ids, *, guest_session_id: UUID | None = None) -> dict[UUID, list]:
    rows = (
        db.query(
            Session.class_id, Session.id, Session.seq, Session.scheduled_at, Session.status,
            Session.session_kind, Session.host_id, Session.host_state, Session.state_version, Session.participation_version,
            Session.duration_min, Session.location_type, Session.location_address, Session.assignment_override, Session.started_at,
        )
        .filter(Session.class_id.in_(list(class_ids)), or_(Session.class_id.in_(_class_access_ids(db, uid)), _legacy_class_sessions_filter(db, uid), Session.id == guest_session_id))
        .order_by(Session.seq.asc())
        .all()
    )
    grouped: dict[UUID, list] = defaultdict(list)
    for row in rows:
        grouped[row.class_id].append(row)
    return grouped


def list_classes(
    user_id: str, db: DBSession, *, status: str | None = None, page: int | None = None,
    limit: int | None = None, now: datetime | None = None,
) -> tuple[list[dict], int]:
    uid = _to_uuid(user_id)
    now = now or datetime.now(timezone.utc)
    visible_class_ids = (
        db.query(Session.class_id).filter(Session.class_id.isnot(None), _legacy_class_sessions_filter(db,uid))
    )
    base = db.query(Class).filter(or_(Class.id.in_(_class_access_ids(db, uid)), and_(Class.recurrence_rule.is_(None), Class.id.in_(visible_class_ids))))
    if status:
        base = base.filter(Class.status == status)
    total = base.count()
    query = base.order_by(Class.created_at.desc(), Class.id)
    if page is not None and limit is not None:
        query = query.offset((page - 1) * limit).limit(limit)
    classes = query.all()
    if not classes:
        return [], total
    grouped = _visible_class_sessions(db, uid, [c.id for c in classes])
    names = _user_names(db, {r.host_id for rows in grouped.values() for r in rows})
    member_classes = {cid for cid, in db.query(ClassMember.class_id).filter(ClassMember.class_id.in_([c.id for c in classes]), ClassMember.user_id == uid).all()}
    return [{**_class_summary(c, grouped.get(c.id, []), names, now),
        **(_viewer_fields(db, c, uid, now=now) if c.recurrence_rule is not None or c.id in member_classes else {})} for c in classes], total


def _load_class_for_viewer(db: DBSession, class_id: str, uid: UUID) -> tuple[Class, list]:
    """400(ID 형식) → 404(없음·숨김·접근 불가 동일). 존재 여부를 노출하지 않는다(plan §7.1)."""
    cid = _to_uuid(class_id)
    cls = db.query(Class).filter(Class.id == cid).first()
    if not cls:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    from app.services.class_access_service import class_role
    from app.services.class_instructor_service import validate_instructor

    actor = db.query(User).filter(User.id == uid).first()
    guest_session_id = None
    if class_role(db, actor, cls) == "guest":
        guest = db.query(ClassInstructor).filter_by(
            class_id=cid, user_id=uid, role="guest", status="active"
        ).first()
        if guest and guest.scope_session_id:
            try:
                validate_instructor(db, cls, uid, guest.scope_session_id)
                guest_session_id = guest.scope_session_id
            except HTTPException:
                pass
    rows = _visible_class_sessions(db, uid, [cid], guest_session_id=guest_session_id).get(cid, [])
    if not rows and not db.query(Class.id).filter(Class.id == cid, Class.id.in_(_class_access_ids(db, uid))).first():
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    return cls, rows


def get_class_detail(class_id: str, user_id: str, db: DBSession, *, now: datetime | None = None) -> dict:
    uid = _to_uuid(user_id)
    now = now or datetime.now(timezone.utc)
    cls, rows = _load_class_for_viewer(db, class_id, uid)
    names = _user_names(db, {r.host_id for r in rows})
    detail = {
        **_class_summary(cls, rows, names, now),
        "location_type": cls.location_type,
        "location_address": cls.location_address,
        "linkband_mode": cls.linkband_mode,
        "record_audio": cls.record_audio,
        "record_video": cls.record_video,
        "chat_enabled": cls.chat_enabled,
        "reminder_offsets": cls.reminder_offsets,
        "capacity": cls.capacity,
        "participant_mode": cls.participant_mode,
        "default_duration_min": cls.default_duration_min,
        "host_view": None,
    }
    instructors = db.query(ClassInstructor).filter(ClassInstructor.class_id == cls.id).order_by(ClassInstructor.added_at).all()
    from app.services.class_access_service import class_role
    actor = db.query(User).filter(User.id == uid).first()
    role = class_role(db, actor, cls)
    is_host = role in ("lead", "assistant", "org_admin") or (cls.recurrence_rule is None and any(r.host_id == uid for r in rows))
    detail.update(_viewer_fields(db, cls, uid, now=now))
    detail["revision"] = cls.revision
    detail["capabilities"] = {
        **detail["capabilities"],
        "manage": role in ("lead", "org_admin"),
        "invite": role in ("lead", "assistant", "org_admin"),
        "schedule": bool(settings.class_scheduling_enabled and role in ("lead", "org_admin")),
        "host_request": bool(settings.class_scheduling_enabled and role in ("lead", "assistant", "guest", "org_admin")),
    }
    if role in ("lead", "org_admin"):
        detail.update(draft_schedule=cls.draft_schedule, recurrence_rule=cls.recurrence_rule,
                      assignment_rule=cls.assignment_rule, ends_on=cls.ends_on)
    if is_host:
        instructor_names = _user_names(db, {i.user_id for i in instructors})
        return {
            **detail,
            "host_view": {
                "access_code": cls.access_code,
                "instructors": [
                    {"user_id": str(i.user_id), "name": instructor_names.get(i.user_id), "role": i.role, "status": i.status}
                    for i in instructors
                ],
            },
        }
    return detail


def list_class_sessions(class_id: str, user_id: str, db: DBSession) -> tuple[list[dict], int]:
    uid = _to_uuid(user_id)
    _, rows = _load_class_for_viewer(db, class_id, uid)
    names = _user_names(db, {r.host_id for r in rows})
    items = [
        {
            "id": str(r.id),
            "seq": r.seq,
            "scheduled_at": r.scheduled_at,
            "status": r.status,
            "session_kind": r.session_kind,
            "host": {"id": str(r.host_id), "name": names.get(r.host_id)} if r.host_state == "assigned" else None,
            "host_state": r.host_state,
            "state_version": r.state_version, "duration_min": r.duration_min,
            "location_type": r.location_type, "location_address": r.location_address,
            "assignment_override": r.assignment_override,
        }
        for r in rows
    ]
    cls = db.query(Class).filter_by(id=_to_uuid(class_id)).first()
    member = db.query(ClassMember).filter_by(class_id=cls.id, user_id=uid, canonical_member_id=None).first()
    if member:
        own_items = {item["id"]: item for item in get_my_attendance(db, cls.id, user_id=uid)["sessions"]}
        for item in items:
            extra = own_items.get(item["id"], {})
            item.update({key: value for key, value in extra.items() if key not in item})
    elif cls.recurrence_rule is not None:
        from app.services.class_access_service import class_role
        role = class_role(db, db.get(User, uid), cls)
        for item, row in zip(items, rows):
            item["capabilities"] = _session_staff_capabilities(role, uid, cls, row)
            if item["capabilities"]["correct_attendance"]:
                item["participation_version"] = row.participation_version
    return items, len(items)


# ───────────────────────── SDD-217 본인 이력 ─────────────────────────


def _read_context(db, class_id, *, user_id=None, member_credential=None):
    # 동의 읽기와 같은 로그인/장기 guest 인증을 재사용한다. 활동 권한은 여기서 부여하지 않는다.
    from app.services.class_member_consent_service import _own_member
    member = _own_member(db, class_id, user_id, member_credential)
    cls = db.query(Class).filter(Class.id == member.class_id, Class.status != "draft").first()
    if cls is None:
        raise HTTPException(404, detail=NOT_FOUND)
    return cls, member


def _member_rows(db, cls, member):
    from app.services.class_guest_service import canonical_member_ids
    ids = canonical_member_ids(db, member)
    originals = db.query(ClassMember).filter(ClassMember.id.in_(ids)).all()
    sessions = db.query(Session).filter(Session.class_id == cls.id, Session.is_template.is_(False)).order_by(Session.seq, Session.id).all()
    participants = db.query(SessionParticipant).filter(
        SessionParticipant.session_id.in_([s.id for s in sessions]), SessionParticipant.member_id.in_(ids),
        SessionParticipant.superseded_by_participant_id.is_(None), SessionParticipant.is_waitlisted.is_(False),
    ).execution_options(include_removed=True).all()
    grouped = defaultdict(list)
    for participant in participants:
        grouped[participant.session_id].append(participant)
    # 중복 유효행은 임의로 한 명을 택하지 않고 본인 기록을 보수적으로 숨긴다.
    own = {sid: ps[0] for sid, ps in grouped.items() if len(ps) == 1}
    return ids, originals, sessions, own


def _participation_scope(db, member, originals, session, participant):
    starts = [m.joined_at for m in originals if m.joined_at]
    scheduled = _aware(session.scheduled_at) if session.scheduled_at else None
    if scheduled and starts and scheduled < min(_aware(stamp) for stamp in starts):
        return "before_join"
    # 과거 참가 근거는 최근 재가입/이탈 시각에 의해 사라지지 않는다.
    if participant is not None and participant.attendance_status in ("attended", "absent", "excused"):
        return "eligible"
    # 수료 뒤에도 명시 배정된 개인 보강/취소 대체는 T05와 같은 참가자격으로 읽는다.
    # 일반 expected나 이탈/제외 회차에는 이 예외를 적용하지 않는다.
    if member.status == "completed" and participant is not None and session.status != "cancelled":
        from app.services.class_attendance_service import eligible_participant
        if eligible_participant(db, participant):
            return "eligible"
    end = member.left_at if member.status == "left" else member.removed_at if member.status == "removed" else member.completed_at if member.status == "completed" else None
    if member.status in ("left", "removed") or (end and scheduled and scheduled > _aware(end)):
        return "outside_membership"
    if member.status in ("invited", "waitlisted", "declined"):
        return "outside_membership"
    return "eligible"


def _member_capabilities(db, cls, member, sessions, own, *, activity=True, now=None):
    now = now or datetime.now(timezone.utc)
    active = bool(activity and cls.status == "active" and member.status == "active")
    future = lambda row: row.status in ("ready", "scheduled", "open") and row.started_at is None and (row.scheduled_at is None or _aware(row.scheduled_at) >= now)
    excuse = active and any(future(row) and (p := own.get(row.id)) is not None and p.entered_at is None and not p.removed_at and not p.waitlist_cancelled_at and p.attendance_status == "expected" for row in sessions)
    makeup_available = False
    if activity:
        from app.services.class_makeup_service import validate_reservation
        # 실제 예약이 사용하는 제거/alias/superseded 행도 함께 읽어 같은 쌍을 판정한다.
        participants = db.query(SessionParticipant).filter(
            SessionParticipant.session_id.in_([row.id for row in sessions]),
        ).execution_options(include_removed=True).all()
        sources = [row for row in sessions if row.session_kind == "regular" and (p := own.get(row.id)) is not None
            and p.attendance_kind == "regular" and p.attendance_status in ("absent", "excused")]
        targets = [row for row in sessions if row.status in ("ready", "scheduled")]
        for source in sources:
            for target in targets:
                try:
                    validate_reservation(db, cls, member, source, target, participants, now)
                except HTTPException:
                    continue
                makeup_available = True
                break
            if makeup_available:
                break
    return {"manage_members": False, "correct_attendance": False, "assign_makeup": False, "merge_guests": False,
        "leave": active, "cancel_waitlist": bool(activity and cls.status == "active" and member.status == "waitlisted"),
        "rejoin": bool(cls.status == "active" and member.status == "left"), "excuse": bool(excuse),
        "request_makeup": makeup_available,
        "edit_consents": bool(activity and cls.status == "active" and member.status in ("active", "waitlisted")),
        "read_own_reports": member.status in ("active", "completed", "left", "removed")}


def _makeup_rows(db, cls, member):
    from app.models.class_membership import ClassMakeupAssignment
    from app.services.class_guest_service import canonical_member_ids
    return db.query(ClassMakeupAssignment).filter(ClassMakeupAssignment.class_id == cls.id,
        ClassMakeupAssignment.member_id.in_(canonical_member_ids(db, member)),
        ClassMakeupAssignment.status.in_(("reserved", "completed"))).order_by(ClassMakeupAssignment.id).all()


def _own_attendance(db, cls, member, *, now=None):
    from app.services.class_attendance_service import participant_dto
    from app.services.class_makeup_service import assignment_dto
    _, originals, sessions, own = _member_rows(db, cls, member)
    assignments = _makeup_rows(db, cls, member)
    valid = {p.id: p for p in own.values()}
    by_session = {row.id: row for row in sessions}
    # 집계/표시는 현재 유효한 원결석과 보강 대상의 같은 클래스 근거만 사용한다.
    assignments = [a for a in assignments if a.source_participant_id in valid and a.target_participant_id in valid
        and valid[a.source_participant_id].session_id == a.source_session_id
        and valid[a.target_participant_id].session_id == a.target_session_id
        and by_session[a.source_session_id].status != "cancelled" and by_session[a.target_session_id].status != "cancelled"]
    by_target = {a.target_participant_id: a for a in assignments}
    reports = defaultdict(list)
    for r in db.query(Report).filter(Report.participant_id.in_(valid), Report.type == "client", Report.status == "completed").order_by(Report.id).all():
        participant = valid[r.participant_id]
        if r.session_id == participant.session_id and by_session[r.session_id].status == "completed":
            reports[r.participant_id].append(str(r.id))
    items = []
    count = {"attended": set(), "absent": set(), "excused": set()}
    for row in sessions:
        p = own.get(row.id)
        scope = _participation_scope(db, member, originals, row, p)
        visible = p if scope == "eligible" else None
        if visible and row.status != "cancelled" and p.attendance_status in count:
            count[p.attendance_status].add(row.id)
        assignment = by_target.get(p.id) if visible else None
        items.append({"id": str(row.id), "seq": row.seq, "scheduled_at": row.scheduled_at, "status": row.status,
            "session_kind": row.session_kind, "participation_scope": scope,
            "attendance": participant_dto(db, visible) if visible else None,
            "makeup": assignment_dto(assignment) if assignment else None,
            "approved_report_ids": reports.get(p.id, []) if visible else [],
            "capabilities": {"excuse": bool(visible and member.status == "active" and cls.status == "active"
                and row.status in ("ready", "scheduled", "open") and row.started_at is None
                and (row.scheduled_at is None or _aware(row.scheduled_at) >= (now or datetime.now(timezone.utc)))
                and p.attendance_status == "expected" and p.entered_at is None and not p.removed_at and not p.waitlist_cancelled_at),
                "correct_attendance": False, "assign_makeup": False,
                "read_own_reports": bool(visible and reports.get(p.id))}})
    summary = {key: len(values) for key, values in count.items()}
    for state in ("reserved", "completed"):
        summary["makeup_" + state] = len({a.source_participant_id for a in assignments if a.status == state
            and _participation_scope(db, member, originals, by_session[a.source_session_id], valid[a.source_participant_id]) == "eligible"})
    return items, summary, sessions, own


def _decorate_my_actions(db, cls, member, items, sessions, own, *, activity, guest=False, now=None):
    """화면 동작은 기존 유효 참가자·정원 판정을 읽기로 재사용한다."""
    from app.services.class_attendance_service import eligible_participant, check_capacity
    now = now or datetime.now(timezone.utc)
    rows = db.query(SessionParticipant).filter(SessionParticipant.session_id.in_([row.id for row in sessions])).all()
    by_session = {str(row.id): row for row in sessions}
    cancellable = {str(a.target_participant_id): a for a in _makeup_rows(db, cls, member) if a.status == "reserved"}
    for item in items:
        row = by_session[item["id"]]
        p = own.get(row.id) if item["attendance"] else None
        valid = bool(p and eligible_participant(db, p) and not p.is_waitlisted)
        seat = False
        if valid:
            try:
                check_capacity(db, cls, row, p, [r for r in rows if r.session_id == row.id])
                seat = True
            except HTTPException:
                pass
        future = row.status in ("ready", "scheduled", "open") and row.started_at is None and (row.scheduled_at is None or _aware(row.scheduled_at) >= now)
        item["capabilities"]["undo_excuse"] = bool(activity and cls.status == "active" and member.status == "active"
            and valid and p.attendance_status == "excused" and p.entered_at is None and future and seat)
        assignment = item["makeup"]
        # 취소 회차는 집계에서 제외하되 남은 예약을 취소할 수 있게 표시한다.
        if assignment is None and p and row.status == "cancelled" and str(p.id) in cancellable:
            from app.services.class_makeup_service import assignment_dto
            assignment = item["makeup"] = assignment_dto(cancellable[str(p.id)])
        item["capabilities"]["cancel_makeup"] = bool(activity and member.status in ("active", "completed")
            and cls.status in ("active", "completed") and assignment and assignment["status"] == "reserved"
            # 이탈 후 복구한 본인은 입장 불가인 withdrawn 대상 예약도 명시 취소할 수 있다.
            and p is not None and p.entered_at is None and row.started_at is None and row.status in ("ready", "scheduled", "open", "cancelled"))
        entry_scope = (activity and member.status == "active" and cls.status == "active") or (
            not activity and member.status == "completed" and cls.status in ("active", "completed") and cls.schedule_mode == "fixed")
        item["capabilities"]["guest_entry"] = bool(guest and entry_scope and valid and seat and row.status in ("open", "in_progress"))
        if not activity:
            item["capabilities"]["excuse"] = False
    return items


def get_my_membership(db, class_id, *, user_id=None, member_credential=None, now=None):
    from app.services.class_membership_service import member_dto
    from app.services.class_member_consent_service import consent_view
    from app.services.class_guest_service import authenticate_guest
    cls, member = _read_context(db, class_id, user_id=user_id, member_credential=member_credential)
    items, summary, sessions, own = _own_attendance(db, cls, member, now=now)
    activity = bool(user_id) or authenticate_guest(db, cls.id, member_credential)[1].scope == "activity"
    items = _decorate_my_actions(db, cls, member, items, sessions, own, activity=activity, guest=not bool(user_id), now=now)
    caps = _member_capabilities(db, cls, member, sessions, own, activity=activity, now=now)
    caps.update({key: any(item["capabilities"][key] for item in items) for key in ("undo_excuse", "cancel_makeup", "guest_entry")})
    dto = member_dto(db, member, cls=cls)
    dto["capabilities"] = caps
    return {"class_id": str(cls.id), "revision": cls.revision, "member": dto,
        "attendance_summary": summary, "capabilities": caps, "consents": consent_view(member)}


def get_my_attendance(db, class_id, *, user_id=None, member_credential=None):
    cls, member = _read_context(db, class_id, user_id=user_id, member_credential=member_credential)
    items, _, sessions, own = _own_attendance(db, cls, member)
    activity = True
    if not user_id:
        from app.services.class_guest_service import authenticate_guest
        activity = authenticate_guest(db, cls.id, member_credential)[1].scope == "activity"
    _decorate_my_actions(db, cls, member, items, sessions, own, activity=activity, guest=not bool(user_id))
    return {"sessions": items, "total": len(items)}


def _session_staff_capabilities(role, uid, cls, session):
    clinical = role in ("lead", "assistant") or (role == "guest" and session.host_id == uid)
    return {"correct_attendance": bool(clinical and session.status == "completed"),
        "assign_makeup": bool(clinical and cls.status in ("active", "completed") and session.status in ("ready", "scheduled") and session.started_at is None),
        "excuse": False, "read_own_reports": False}


def _viewer_fields(db, cls, uid, *, now=None):
    from app.services.class_access_service import class_role
    actor = db.get(User, uid)
    role = class_role(db, actor, cls)
    manager = role in ("lead", "assistant", "org_admin")
    sessions = db.query(Session).filter(Session.class_id == cls.id, Session.is_template.is_(False)).all()
    clinical = role in ("lead", "assistant")
    caps = {"manage_members": manager, "merge_guests": manager,
        "correct_attendance": bool((clinical or role == "guest") and any(s.status == "completed" and (clinical or s.host_id == uid) for s in sessions)),
        "assign_makeup": bool((clinical or role == "guest") and cls.status in ("active", "completed") and any(s.status in ("ready", "scheduled") and (clinical or s.host_id == uid) for s in sessions)),
        **{key: False for key in ("leave", "cancel_waitlist", "rejoin", "excuse", "request_makeup", "edit_consents", "read_own_reports")}}
    membership = db.query(ClassMember).filter_by(class_id=cls.id, user_id=uid, canonical_member_id=None).first()
    if membership and cls.status != "draft":
        data = get_my_membership(db, cls.id, user_id=uid, now=now)
        own_caps = data["capabilities"]
        own_caps.update({key: caps[key] for key in ("manage_members", "merge_guests", "correct_attendance", "assign_makeup")})
        return {"membership": data["member"], "attendance_summary": data["attendance_summary"], "capabilities": own_caps}
    return {"membership": None, "attendance_summary": None, "capabilities": caps}


def require_own_approved_report(db, report, session, *, user_id=None, member_credential=None):
    """개인 리포트 원본 FK를 보존하며 canonical 본인 소유권만 검사한다."""
    try:
        if session is None or session.class_id is None or session.status != "completed" or report.type != "client" or report.status != "completed":
            raise HTTPException(404, detail=NOT_FOUND)
        cls, member = _read_context(db, session.class_id, user_id=user_id, member_credential=member_credential)
        _, originals, _, own = _member_rows(db, cls, member)
        participant = own.get(session.id)
        if member.status not in ("active", "completed", "left", "removed") or participant is None or participant.id != report.participant_id or _participation_scope(db, member, originals, session, participant) != "eligible":
            raise HTTPException(404, detail=NOT_FOUND)
        return member, participant
    except HTTPException:
        raise HTTPException(404, detail=NOT_FOUND)


# ───────────────────────── 상담 ─────────────────────────


def _visible_relationship_sessions(db: DBSession, uid: UUID, relationship_ids) -> dict[UUID, list]:
    rows = (
        db.query(
            Session.counseling_relationship_id, Session.id, Session.seq, Session.scheduled_at,
            Session.status, Session.type, Session.host_id,
        )
        .filter(Session.counseling_relationship_id.in_(list(relationship_ids)), *_visible_session_filter(uid, db))
        .order_by(Session.seq.asc())
        .all()
    )
    grouped: dict[UUID, list] = defaultdict(list)
    for row in rows:
        grouped[row.counseling_relationship_id].append(row)
    return grouped


def _session_brief(row) -> dict | None:
    if row is None:
        return None
    return {"id": str(row.id), "seq": row.seq, "scheduled_at": row.scheduled_at, "status": row.status}


def _client_displays(db: DBSession, uid: UUID, relationships: list[CounselingRelationship]) -> dict[UUID, str | None]:
    """보관용 관계는 고정 라벨. 그 외는 담당 상담사와 내담자 본인에게만 이름을 보인다."""
    guest_ids = {r.client_guest_id for r in relationships if r.client_guest_id and r.counselor_id == uid}
    guest_names = (
        {row[0]: row[1] for row in db.query(CounselingGuest.id, CounselingGuest.display_name).filter(CounselingGuest.id.in_(guest_ids)).all()}
        if guest_ids
        else {}
    )
    user_ids = {r.client_user_id for r in relationships if r.client_user_id and (r.counselor_id == uid or r.client_user_id == uid)}
    user_names = _user_names(db, user_ids)
    displays: dict[UUID, str | None] = {}
    for r in relationships:
        if r.is_placeholder:
            displays[r.id] = PLACEHOLDER_CLIENT_LABEL
        elif r.client_user_id and r.client_user_id in user_names:
            displays[r.id] = user_names[r.client_user_id]
        elif r.client_guest_id:
            displays[r.id] = guest_names.get(r.client_guest_id)
        else:
            displays[r.id] = None
    return displays


def _counseling_summaries(
    db: DBSession, uid: UUID, relationships: list[CounselingRelationship], grouped: dict[UUID, list], now: datetime
) -> list[dict]:
    names = _user_names(db, {r.counselor_id for r in relationships})
    displays = _client_displays(db, uid, relationships)
    summaries = []
    for rel in relationships:
        rows = grouped.get(rel.id, [])
        completed = [r for r in rows if r.status == "completed"]
        summaries.append(
            {
                "id": str(rel.id),
                "status": rel.status,
                "area": AREA_COUNSELING,
                "counselor": {"id": str(rel.counselor_id), "name": names.get(rel.counselor_id)},
                "client_display": displays[rel.id],
                "modality_default": rel.modality_default,
                "session_count": len(rows),
                "next_session": _session_brief(_next_session(rows, now)),
                "latest_session": _session_brief(max(completed, key=lambda r: r.seq or 0, default=None)),
            }
        )
    return summaries


def list_counseling(
    user_id: str, db: DBSession, *, status: str | None = None, page: int | None = None,
    limit: int | None = None, now: datetime | None = None,
) -> tuple[list[dict], int]:
    uid = _to_uuid(user_id)
    now = now or datetime.now(timezone.utc)
    visible_ids = (
        db.query(Session.counseling_relationship_id)
        .filter(Session.counseling_relationship_id.isnot(None), *_visible_session_filter(uid, db))
    )
    base = db.query(CounselingRelationship).filter(CounselingRelationship.id.in_(visible_ids))
    if status:
        base = base.filter(CounselingRelationship.status == status)
    total = base.count()
    query = base.order_by(CounselingRelationship.started_at.desc(), CounselingRelationship.id)
    if page is not None and limit is not None:
        query = query.offset((page - 1) * limit).limit(limit)
    relationships = query.all()
    if not relationships:
        return [], total
    grouped = _visible_relationship_sessions(db, uid, [r.id for r in relationships])
    return _counseling_summaries(db, uid, relationships, grouped, now), total


def get_counseling_detail(relationship_id: str, user_id: str, db: DBSession, *, now: datetime | None = None) -> dict:
    uid = _to_uuid(user_id)
    now = now or datetime.now(timezone.utc)
    rid = _to_uuid(relationship_id)
    rel = db.query(CounselingRelationship).filter(CounselingRelationship.id == rid).first()
    if not rel:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    rows = _visible_relationship_sessions(db, uid, [rid]).get(rid, [])
    if not rows:
        raise HTTPException(status_code=404, detail=NOT_FOUND)

    summary = _counseling_summaries(db, uid, [rel], {rid: rows}, now)[0]
    session_ids = [r.id for r in rows]
    record_status = {
        row[0]: row[1] for row in db.query(SessionRecord.session_id, SessionRecord.status).filter(SessionRecord.session_id.in_(session_ids)).all()
    }
    report_query = db.query(Report.session_id, Report.generation_status).filter(Report.session_id.in_(session_ids))
    # 호스트가 아니면 본인 리포트의 진행 상태만 보인다.
    report_rows = report_query.all() if rel.counselor_id == uid else report_query.filter(Report.user_id == uid).all()
    report_status: dict[UUID, str] = {}
    for session_id, generation_status in report_rows:
        current = report_status.get(session_id)
        if current is None or _REPORT_RANK.get(generation_status, -1) > _REPORT_RANK.get(current, -1):
            report_status[session_id] = generation_status
    return {
        **summary,
        "sessions": [
            {
                "id": str(r.id),
                "seq": r.seq,
                "scheduled_at": r.scheduled_at,
                "status": r.status,
                "type": r.type,
                "record_status": record_status.get(r.id),
                "report_status": report_status.get(r.id),
            }
            for r in rows
        ],
    }


# ───────────────────────── SessionResponse 가산 필드 ─────────────────────────


def _parent_fields(db: DBSession, session_ids: list[UUID]) -> dict[str, dict]:
    if not session_ids:
        return {}
    rows = (
        db.query(Session.id, Session.class_id, Session.counseling_relationship_id, Session.seq, Class.title)
        .outerjoin(Class, Class.id == Session.class_id)
        .filter(Session.id.in_(session_ids))
        .all()
    )
    fields: dict[str, dict] = {}
    for sid, class_id, relationship_id, seq, class_title in rows:
        area = AREA_MEDITATION if class_id else AREA_COUNSELING if relationship_id else None
        fields[str(sid)] = {
            "class_id": str(class_id) if class_id else None,
            "class_title": class_title if class_id else None,
            "seq": seq,
            "area": area,
        }
    return fields


_EMPTY_PARENT = {"class_id": None, "class_title": None, "seq": None, "area": None}


def add_parent_fields(db: DBSession, payload: dict | list[dict]) -> dict | list[dict]:
    """세션 응답 dict(또는 목록)에 class_id·class_title·seq·area 를 더한 사본을 돌려준다. 질의는 1회."""
    items = payload if isinstance(payload, list) else [payload]
    fields = _parent_fields(db, [_to_uuid(i["id"]) for i in items if i.get("id")])
    enriched = [{**item, **fields.get(item.get("id"), _EMPTY_PARENT)} for item in items]
    return enriched if isinstance(payload, list) else enriched[0]
