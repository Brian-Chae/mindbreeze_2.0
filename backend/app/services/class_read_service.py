"""SDD-214: 클래스·상담 읽기 서비스.

가시 범위는 현행 `GET /sessions`(session_service.list_sessions)의 부모 단위 투영이다 — 호스트이거나 참여자인
비템플릿 세션만 보이고, 부모(클래스·상담 관계)는 그런 세션이 하나라도 있을 때만 보인다. 새 권한 정책은 없다.
EEG·녹음·전사·리포트 본문은 조회하지 않는다(진행 상태 값만).
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session as DBSession

from app.models.class_program import Class, ClassInstructor
from app.models.counseling import CounselingGuest, CounselingRelationship
from app.models.record import Report, SessionRecord
from app.models.session import Session, SessionParticipant
from app.models.user import User
from app.services.session_authz import DENY_NO_ACCESS

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
    return (Session.is_template.is_(False), or_(Session.host_id == uid, participates))


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
    completed = sum(1 for r in rows if r.status == "completed")
    total = cls.planned_session_count or sum(1 for r in rows if r.status != "cancelled")
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
                "host": {"id": str(nxt.host_id), "name": names.get(nxt.host_id)},
            }
            if nxt
            else None
        ),
        "has_open_session": any(r.status in _OPEN_STATUSES for r in rows),
    }


def _visible_class_sessions(db: DBSession, uid: UUID, class_ids) -> dict[UUID, list]:
    rows = (
        db.query(
            Session.class_id, Session.id, Session.seq, Session.scheduled_at, Session.status,
            Session.session_kind, Session.host_id, Session.host_state,
        )
        .filter(Session.class_id.in_(list(class_ids)), *_visible_session_filter(uid, db))
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
        db.query(Session.class_id).filter(Session.class_id.isnot(None), *_visible_session_filter(uid, db))
    )
    base = db.query(Class).filter(Class.id.in_(visible_class_ids))
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
    return [_class_summary(c, grouped.get(c.id, []), names, now) for c in classes], total


def _load_class_for_viewer(db: DBSession, class_id: str, uid: UUID) -> tuple[Class, list]:
    """400(ID 형식) → 404(없음) → 403(가시 회차 없음) 순서. 현행 세션 상세(session_authz)와 같은 상태코드·문구."""
    cid = _to_uuid(class_id)
    cls = db.query(Class).filter(Class.id == cid).first()
    if not cls:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")
    rows = _visible_class_sessions(db, uid, [cid]).get(cid, [])
    if not rows:
        any_session = db.query(Session.id).filter(Session.class_id == cid, Session.is_template.is_(False)).first()
        if not any_session:
            raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")
        raise HTTPException(status_code=403, detail=DENY_NO_ACCESS)
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
        "capacity": cls.capacity,
        "participant_mode": cls.participant_mode,
        "default_duration_min": cls.default_duration_min,
        "host_view": None,
    }
    instructors = db.query(ClassInstructor).filter(ClassInstructor.class_id == cls.id).order_by(ClassInstructor.added_at).all()
    is_host = any(i.user_id == uid and i.status == "active" for i in instructors) or any(r.host_id == uid for r in rows)
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
            "host": {"id": str(r.host_id), "name": names.get(r.host_id)},
            "host_state": r.host_state,
        }
        for r in rows
    ]
    return items, len(items)


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
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")
    rows = _visible_relationship_sessions(db, uid, [rid]).get(rid, [])
    if not rows:
        any_session = db.query(Session.id).filter(Session.counseling_relationship_id == rid, Session.is_template.is_(False)).first()
        if not any_session:
            raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")
        raise HTTPException(status_code=403, detail=DENY_NO_ACCESS)

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
