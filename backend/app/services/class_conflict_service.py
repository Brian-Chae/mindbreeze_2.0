"""편성 후보의 범위 쿼리와 반개구간 충돌. 저장·커밋하지 않는다."""

import hashlib
import json
from datetime import timedelta, timezone
from uuid import UUID

from sqlalchemy import func, text, or_, and_
from sqlalchemy.orm import Session as DBSession

from app.models.class_program import Class, ClassInstructor, ClassMember
from app.models.user import User
from app.models.user_org_membership import UserOrgMembership
from app.models.organization import Organization
from app.models.session import Session, SessionParticipant
from app.schemas.class_scheduling import ConflictItem, ScheduleRow

ACTIVE_STATES = ("ready", "scheduled", "open", "in_progress")


def utc(value):
    return (
        value.replace(tzinfo=timezone.utc)
        if value.tzinfo is None
        else value.astimezone(timezone.utc)
    )


def overlaps(start_a, minutes_a, start_b, minutes_b):
    a, b = utc(start_a), utc(start_b)
    return a < b + timedelta(minutes=minutes_b) and b < a + timedelta(minutes=minutes_a)


def detect_conflicts_bulk(
    db: DBSession,
    rows: list[ScheduleRow],
    exclude_ids: set,
    viewer: dict,
    *,
    class_id=None,
    member_ids=None
) -> list[ConflictItem]:
    if not rows:
        return []
    viewer_id = UUID(str(viewer["id"]))
    memberships = (
        db.query(UserOrgMembership)
        .join(User, User.id == UserOrgMembership.user_id)
        .join(Organization, Organization.id == UserOrgMembership.org_id)
        .filter(
            UserOrgMembership.user_id == viewer_id,
            UserOrgMembership.status == "active",
            User.status == "active",
            Organization.deactivated_at.is_(None),
        )
        .all()
    )
    org_ids = {m.org_id for m in memberships}
    admin_orgs = {m.org_id for m in memberships if m.role == "org_admin"}
    visible_classes = {
        c.id
        for c in db.query(Class)
        .outerjoin(
            ClassInstructor,
            and_(
                ClassInstructor.class_id == Class.id,
                ClassInstructor.user_id == viewer_id,
                ClassInstructor.status == "active",
                ClassInstructor.role.in_(("lead", "assistant")),
            ),
        )
        .filter(
            Class.organization_id.in_(org_ids),
            or_(
                ClassInstructor.user_id.isnot(None),
                Class.organization_id.in_(admin_orgs),
            ),
        )
        .all()
    }
    titles = (
        {
            p.id: p.title
            for p in db.query(Class).filter(Class.id.in_(visible_classes)).all()
        }
        if visible_classes
        else {}
    )
    hosts = {row.host_id for row in rows if row.host_id is not None}
    members = set(member_ids or []) if org_ids else set()
    if class_id and UUID(str(class_id)) in visible_classes:
        members.update(
            r[0]
            for r in db.query(ClassMember.user_id)
            .filter_by(class_id=class_id, status="active")
            .all()
            if r[0]
        )
    addresses = {
        r.location_address
        for r in rows
        if r.location_type == "offline" and r.location_address
    }
    member_sessions = (
        {
            r[0]
            for r in db.query(SessionParticipant.session_id)
            .join(Session, Session.id == SessionParticipant.session_id)
            .filter(
                SessionParticipant.user_id.in_(members),
                or_(
                    Session.host_id == viewer_id, Session.class_id.in_(visible_classes)
                ),
            )
            .all()
        }
        if members
        else set()
    )
    earliest = min(row.scheduled_at for row in rows)
    latest = max(row.scheduled_at + timedelta(minutes=row.duration_min) for row in rows)
    candidates = or_(
        Session.host_id.in_(hosts),
        Session.id.in_(member_sessions),
        and_(
            Session.organization_id.in_(org_ids),
            Session.location_type == "offline",
            Session.location_address.in_(addresses),
        ),
    )
    query = db.query(Session).filter(
        candidates,
        Session.status.in_(ACTIVE_STATES),
        Session.is_template.is_(False),
        Session.scheduled_at < latest,
        Session.id.notin_(exclude_ids),
    )
    if db.get_bind().dialect.name == "postgresql":
        query = query.filter(
            Session.scheduled_at + Session.duration_min * text("INTERVAL '1 minute'")
            > earliest
        )
    else:
        query = query.filter(
            func.julianday(Session.scheduled_at) + Session.duration_min / 1440.0
            > func.julianday(earliest)
        )
    persisted = query.all()
    result = []
    for i, row in enumerate(rows):
        for other in persisted:
            if not overlaps(
                row.scheduled_at,
                row.duration_min,
                other.scheduled_at,
                other.duration_min,
            ):
                continue
            kinds = []
            if other.host_id == row.host_id:
                kinds.append("host")
            if (
                other.organization_id in org_ids
                and row.location_type == other.location_type == "offline"
                and row.location_address == other.location_address
            ):
                kinds.append("place")
            if other.id in member_sessions:
                kinds.append("member")
            visible = other.host_id == viewer_id or other.class_id in visible_classes
            for kind in kinds:
                result.append(
                    ConflictItem(
                        candidate_key=row.client_key,
                        kind=kind,
                        starts_at=utc(other.scheduled_at),
                        ends_at=utc(other.scheduled_at)
                        + timedelta(minutes=other.duration_min),
                        visible=visible,
                        other_session_id=other.id if visible else None,
                        parent_title=titles.get(other.class_id) if visible else None,
                        seq=other.seq if visible else None,
                    )
                )
        for other in rows[i + 1 :]:
            if not overlaps(
                row.scheduled_at,
                row.duration_min,
                other.scheduled_at,
                other.duration_min,
            ):
                continue
            kinds = []
            if row.host_id is not None and row.host_id == other.host_id:
                kinds.append("host")
            if (
                row.location_type == other.location_type == "offline"
                and row.location_address
                and row.location_address == other.location_address
            ):
                kinds.append("place")
            if members:
                kinds.append("member")
            for kind in kinds:
                result.append(
                    ConflictItem(
                        candidate_key=row.client_key,
                        kind=kind,
                        starts_at=other.scheduled_at,
                        ends_at=other.scheduled_at
                        + timedelta(minutes=other.duration_min),
                        other_candidate_key=other.client_key,
                        visible=True,
                    )
                )
    return result


def conflict_fingerprint(conflicts: list[ConflictItem]) -> str:
    serialized = sorted(
        json.dumps(c.model_dump(mode="json"), sort_keys=True, ensure_ascii=False)
        for c in conflicts
    )
    return hashlib.sha256(json.dumps(serialized).encode()).hexdigest()
