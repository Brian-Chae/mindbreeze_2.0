"""SDD-015 — 상담사 / 기관 대시보드 집계 로직"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy.orm import Session as DBSession

from app.models.record import Report, SessionRecord
from app.models.session import Session, SessionParticipant
from app.models.user import User
from app.models.organization import Organization

_IN_PROGRESS = ("in_progress",)


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
    pending_review_count: int,
    participants: list[SessionParticipant],
) -> dict:
    guest_count = sum(1 for p in participants if p.user_id is None)
    return {
        "id": str(s.id),
        "class_id": str(s.class_id) if s.class_id else None,
        "counseling_relationship_id": (
            str(s.counseling_relationship_id) if s.counseling_relationship_id else None
        ),
        "area": "meditation" if s.class_id else "counseling" if s.counseling_relationship_id else None,
        "seq": s.seq,
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
        "pending_review_count": pending_review_count,
    }


def _build_summaries(sessions: list[Session], db: DBSession) -> list[dict]:
    """N+1 쿼리를 피하기 위해 참여자·기록·리포트를 한 번에 조회해 매핑한다."""
    if not sessions:
        return []
    ids = [s.id for s in sessions]

    parts_by_session: dict[uuid.UUID, list[SessionParticipant]] = {sid: [] for sid in ids}
    # DASH-WAITLIST-006: 대시보드 참여자/게스트 수는 실제 입장(active) 참여자만 센다 —
    #   대기열(is_waitlisted=True) 은 좌석을 차지하지 않으므로 제외한다.
    for p in (
        db.query(SessionParticipant)
        .filter(
            SessionParticipant.session_id.in_(ids),
            SessionParticipant.is_waitlisted.is_(False),
        )
        .all()
    ):
        parts_by_session.setdefault(p.session_id, []).append(p)

    records_by_session = {
        r.session_id: r
        for r in db.query(SessionRecord).filter(SessionRecord.session_id.in_(ids)).all()
    }

    report_counts: dict[uuid.UUID, int] = {}
    pending_review_counts: dict[uuid.UUID, int] = {}
    class_session_ids = {s.id for s in sessions if s.class_id is not None}
    for rep in db.query(Report).filter(Report.session_id.in_(ids)).all():
        report_counts[rep.session_id] = report_counts.get(rep.session_id, 0) + 1
        # SDD-237: 명상 클래스 회차의 상담사용 리포트는 승인 대상이 아니라 승인 대기 수에 세지 않는다.
        if rep.status == "pending_review" and not (
            rep.type == "counselor" and rep.session_id in class_session_ids
        ):
            pending_review_counts[rep.session_id] = pending_review_counts.get(rep.session_id, 0) + 1

    return [
        _class_summary(
            s,
            record=records_by_session.get(s.id),
            report_count=report_counts.get(s.id, 0),
            pending_review_count=pending_review_counts.get(s.id, 0),
            participants=parts_by_session.get(s.id, []),
        )
        for s in sessions
    ]


def _participant_key(p: SessionParticipant) -> str:
    """같은 사람을 한 번만 세기 위한 키. 회원=계정, 비회원(게스트)=멤버십·상담 비회원·참여 행 순."""
    if p.user_id:
        return f"u:{p.user_id}"
    member_id = getattr(p, "member_id", None)
    if member_id:
        return f"m:{member_id}"
    guest_client_id = getattr(p, "guest_client_id", None)
    if guest_client_id:
        return f"g:{guest_client_id}"
    return f"p:{p.id}"


def _distinct_participant_count(sessions: list[Session], db: DBSession) -> int:
    """대시보드 '총 참여자' — 회차별 인원을 더하지 않고 서로 다른 사람 수를 센다(대기열 제외).

    회차별 합산은 한 회원이 61회 참여하면 61명으로 보였다.
    """
    if not sessions:
        return 0
    ids = [s.id for s in sessions]
    rows = (
        db.query(SessionParticipant)
        .filter(SessionParticipant.session_id.in_(ids), SessionParticipant.is_waitlisted.is_(False))
        .all()
    )
    return len({_participant_key(p) for p in rows})


def _member_total(user_id: str, db: DBSession) -> int:
    """대시보드 '총 회원' — 회원 화면(GET /clients)과 같은 모집단·같은 수.

    상담사=본인 active 연결 회원, 기관관리자=여기에 관리 기관 회원을 더한다(client_overview_service 와 동일 기준).
    """
    from app.services import client_overview_service

    data = client_overview_service.list_clients_overview(str(user_id), None, 1, 1, None, None, db)
    return int(data["total"])


def _distinct_class_count(sessions: list[Session]) -> int:
    """서로 다른 클래스 수 — class_id 기준 고유 개수. class_id 없는 레거시 단건 회차는 회차 1건 = 클래스 1개."""
    return len({s.class_id if s.class_id is not None else s.id for s in sessions})


_FALLBACK_SORT_TIME = datetime(1970, 1, 1, tzinfo=timezone.utc)


def _ensure_aware(dt: datetime) -> datetime:
    """naive/aware 혼합 비교로 인한 TypeError 를 막기 위해 UTC aware 로 정규화한다."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _activity_sort_key(s: Session) -> datetime:
    """최근 활동 시각 — started_at > scheduled_at > created_at(aware 정규화)."""
    value = s.started_at or s.scheduled_at or s.created_at
    return _ensure_aware(value) if value is not None else _FALLBACK_SORT_TIME


def _sorted_sessions(query) -> list[Session]:
    """최근 활동 순 정렬 — 실제 타임스탬프를 키로 써서 정렬이 무력화되지 않게 한다."""
    sessions = query.all()
    return sorted(sessions, key=_activity_sort_key, reverse=True)


def _team_instructor_sessions(
    uid: uuid.UUID, user: User, exclude_ids: set[uuid.UUID], db: DBSession
) -> list[Session]:
    """본인이 활성 팀 강사(lead/assistant)인 클래스의 회차 중 본인이 host 가 아닌 것.

    guest 강사는 진행 요청 외 접근이 없으므로 제외하고, 접근 판정은 class_role 을 그대로 따른다
    (기관 소속·상담사 역할 불일치 시 제외). 템플릿(is_template)은 계속 제외한다.
    """
    from app.models.class_program import Class, ClassInstructor
    from app.services.class_access_service import class_role

    class_ids = [
        row.class_id
        for row in db.query(ClassInstructor)
        .filter(
            ClassInstructor.user_id == uid,
            ClassInstructor.status == "active",
            ClassInstructor.role.in_(("lead", "assistant")),
        )
        .all()
    ]
    if not class_ids:
        return []
    allowed = [
        c.id
        for c in db.query(Class).filter(Class.id.in_(class_ids)).all()
        if class_role(db, user, c) in ("lead", "assistant")
    ]
    if not allowed:
        return []
    query = db.query(Session).filter(
        Session.class_id.in_(allowed), Session.is_template.is_(False)
    )
    return [s for s in _sorted_sessions(query) if s.id not in exclude_ids]


def counselor_dashboard(user_id: str, db: DBSession) -> dict:
    """상담사 본인이 host인 클래스 목록 + 기록/참여자/상태 집계."""
    uid = _to_uuid(user_id)
    user = db.query(User).filter(User.id == uid).first()
    if user is None:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")

    # SDD-095: 클래스 템플릿(is_template=True)은 실제 진행 클래스가 아니므로 집계·목록에서 제외한다.
    sessions = _sorted_sessions(
        db.query(Session).filter(
            Session.host_id == uid,
            Session.is_template.is_(False),
            Session.counseling_relationship_id.is_(None),  # SDD-225: 상담 세션은 클래스 홈 통계에서 제외
        )
    )
    summaries = _build_summaries(sessions, db)
    all_sessions = list(sessions)

    # SDD-221: 팀 강사(lead/assistant)로만 속한 클래스의 타인 진행 회차도 목록·집계에 합친다.
    team_sessions = _team_instructor_sessions(uid, user, {s.id for s in sessions}, db)
    if team_sessions:
        team_summaries = _build_summaries(team_sessions, db)
        for row in team_summaries:
            # 리포트는 진행 강사 몫이다(팀 열람은 별도 동의 경로) — 건수·검토 대기를 노출하지 않는다.
            row["report_count"] = 0
            row["pending_review_count"] = 0
        merged = sorted(
            zip(sessions + team_sessions, summaries + team_summaries),
            key=lambda pair: _activity_sort_key(pair[0]),
            reverse=True,
        )
        summaries = [summary for _, summary in merged]
        all_sessions = sessions + team_sessions

    org = db.query(Organization).filter(Organization.id == user.org_id).first() if user.org_id else None

    return {
        "counselor_id": str(uid),
        "counselor_name": user.name,
        "org_id": str(user.org_id) if user.org_id else None,
        "org_name": org.name if org else None,
        # SDD-081: 개인 상담소(individual)면 FE 가 "내 개인 상담소"로 표시한다
        "org_kind": org.kind if org else None,
        "total_classes": _distinct_class_count(all_sessions),
        "in_progress_classes": sum(1 for c in summaries if c["status"] in _IN_PROGRESS),
        "completed_classes": sum(1 for c in summaries if c["status"] == "completed"),
        "total_participants": _distinct_participant_count(all_sessions, db),
        "total_members": _member_total(str(uid), db),
        "pending_review_count": sum(c["pending_review_count"] for c in summaries),
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

    from app.services.org_management_service import require_active_org
    require_active_org(org.id, db)
    members = db.query(User).filter(User.org_id == org.id).all()
    counselors = [m for m in members if m.role in ("counselor", "org_admin")]
    counselor_ids = [m.id for m in counselors]

    sessions = (
        _sorted_sessions(
            db.query(Session).filter(
                Session.host_id.in_(counselor_ids),
                Session.is_template.is_(False),  # SDD-095: 템플릿은 기관 집계에서 제외
                Session.counseling_relationship_id.is_(None),  # SDD-225: 상담 세션 제외
            )
        )
        if counselor_ids
        else []
    )
    summaries = _build_summaries(sessions, db)

    by_host: dict[str, list[dict]] = {}
    sessions_by_host: dict[str, list[Session]] = {}
    for s, summary in zip(sessions, summaries):
        by_host.setdefault(str(s.host_id), []).append(summary)
        sessions_by_host.setdefault(str(s.host_id), []).append(s)

    counselor_stats = []
    for m in counselors:
        owned = by_host.get(str(m.id), [])
        counselor_stats.append(
            {
                "id": str(m.id),
                "name": m.name,
                "email": m.email,
                "class_count": _distinct_class_count(sessions_by_host.get(str(m.id), [])),
                "participant_count": sum(c["participant_count"] for c in owned),
                "completed_count": sum(1 for c in owned if c["status"] == "completed"),
            }
        )

    return {
        "org_id": str(org.id),
        "org_name": org.name,
        "org_code": org.org_code,
        "total_counselors": len(counselor_stats),
        "total_classes": _distinct_class_count(sessions),
        "total_participants": _distinct_participant_count(sessions, db),
        "total_members": _member_total(str(uid), db),
        "completed_classes": sum(1 for c in summaries if c["status"] == "completed"),
        "in_progress_classes": sum(1 for c in summaries if c["status"] in _IN_PROGRESS),
        "counselors": counselor_stats,
        "classes": summaries,
    }
