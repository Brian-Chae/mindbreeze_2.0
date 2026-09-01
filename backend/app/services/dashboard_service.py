"""SDD-015 — 상담사 / 기관 대시보드 집계 로직"""

from __future__ import annotations

import uuid

from fastapi import HTTPException, status
from sqlalchemy.orm import Session as DBSession

from app.models.record import Report, SessionRecord
from app.models.session import Session, SessionParticipant
from app.models.user import User
from app.models.organization import Organization

_IN_PROGRESS = ("in_progress", "paused")


def _to_uuid(value: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="잘못된 ID 형식입니다")


def _class_summary(
    s: Session,
    *,
    record: SessionRecord | None,
    report_count: int,
    participants: list[SessionParticipant],
) -> dict:
    guest_count = sum(1 for p in participants if p.user_id is None)
    return {
        "id": str(s.id),
        "title": s.title,
        "type": s.type,
        "custom_type_name": s.custom_type_name,
        "status": s.status,
        "access_code": s.access_code,
        "participant_mode": s.participant_mode,
        "participant_count": len(participants),
        "guest_count": guest_count,
        "scheduled_at": s.scheduled_at,
        "started_at": s.started_at,
        "ended_at": s.ended_at,
        "created_at": s.created_at,
        "has_record": record is not None,
        "record_status": record.status if record else None,
        "has_summary": bool(record.ai_summary) if record else False,
        "report_count": report_count,
    }


def _build_summaries(sessions: list[Session], db: DBSession) -> list[dict]:
    """N+1 쿼리를 피하기 위해 참여자·기록·리포트를 한 번에 조회해 매핑한다."""
    if not sessions:
        return []
    ids = [s.id for s in sessions]

    parts_by_session: dict[uuid.UUID, list[SessionParticipant]] = {sid: [] for sid in ids}
    for p in db.query(SessionParticipant).filter(SessionParticipant.session_id.in_(ids)).all():
        parts_by_session.setdefault(p.session_id, []).append(p)

    records_by_session = {
        r.session_id: r
        for r in db.query(SessionRecord).filter(SessionRecord.session_id.in_(ids)).all()
    }

    report_counts: dict[uuid.UUID, int] = {}
    for rep in db.query(Report).filter(Report.session_id.in_(ids)).all():
        report_counts[rep.session_id] = report_counts.get(rep.session_id, 0) + 1

    return [
        _class_summary(
            s,
            record=records_by_session.get(s.id),
            report_count=report_counts.get(s.id, 0),
            participants=parts_by_session.get(s.id, []),
        )
        for s in sessions
    ]


def _sorted_sessions(query) -> list[Session]:
    """최근 활동 순 정렬 — started_at > scheduled_at > created_at 순으로 대체."""
    sessions = query.all()
    return sorted(
        sessions,
        key=lambda s: (s.started_at or s.scheduled_at or s.created_at) is not None,
        reverse=True,
    )


def counselor_dashboard(user_id: str, db: DBSession) -> dict:
    """상담사 본인이 host인 클래스 목록 + 기록/참여자/상태 집계."""
    uid = _to_uuid(user_id)
    user = db.query(User).filter(User.id == uid).first()
    if user is None:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")

    sessions = _sorted_sessions(db.query(Session).filter(Session.host_id == uid))
    summaries = _build_summaries(sessions, db)

    org = db.query(Organization).filter(Organization.id == user.org_id).first() if user.org_id else None

    return {
        "counselor_id": str(uid),
        "counselor_name": user.name,
        "org_id": str(user.org_id) if user.org_id else None,
        "org_name": org.name if org else None,
        "total_classes": len(summaries),
        "in_progress_classes": sum(1 for c in summaries if c["status"] in _IN_PROGRESS),
        "completed_classes": sum(1 for c in summaries if c["status"] == "completed"),
        "total_participants": sum(c["participant_count"] for c in summaries),
        "classes": summaries,
    }


def org_dashboard(user_id: str, db: DBSession) -> dict:
    """기관(org_admin) 소속 상담사 + 기관 내 모든 클래스 + 통계."""
    uid = _to_uuid(user_id)
    user = db.query(User).filter(User.id == uid).first()
    if user is None:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")
    if user.org_id is None:
        raise HTTPException(status_code=400, detail="소속 기관이 없습니다")

    org = db.query(Organization).filter(Organization.id == user.org_id).first()
    if org is None:
        raise HTTPException(status_code=404, detail="기관을 찾을 수 없습니다")

    members = db.query(User).filter(User.org_id == org.id).all()
    counselors = [m for m in members if m.role in ("counselor", "org_admin")]
    counselor_ids = [m.id for m in counselors]

    sessions = (
        _sorted_sessions(db.query(Session).filter(Session.host_id.in_(counselor_ids)))
        if counselor_ids
        else []
    )
    summaries = _build_summaries(sessions, db)

    by_host: dict[str, list[dict]] = {}
    for s, summary in zip(sessions, summaries):
        by_host.setdefault(str(s.host_id), []).append(summary)

    counselor_stats = []
    for m in counselors:
        owned = by_host.get(str(m.id), [])
        counselor_stats.append(
            {
                "id": str(m.id),
                "name": m.name,
                "email": m.email,
                "class_count": len(owned),
                "participant_count": sum(c["participant_count"] for c in owned),
                "completed_count": sum(1 for c in owned if c["status"] == "completed"),
            }
        )

    return {
        "org_id": str(org.id),
        "org_name": org.name,
        "org_code": org.org_code,
        "total_counselors": len(counselor_stats),
        "total_classes": len(summaries),
        "total_participants": sum(c["participant_count"] for c in summaries),
        "completed_classes": sum(1 for c in summaries if c["status"] == "completed"),
        "in_progress_classes": sum(1 for c in summaries if c["status"] in _IN_PROGRESS),
        "counselors": counselor_stats,
        "classes": summaries,
    }
