"""SDD-253: 리포트 계층 조회(클래스 > 회차 > 회원 > 문서).

권한 범위는 기존 list_reports 와 동일하다(상담사=본인 진행 회차, 기관관리자=허용 기관의 귀속 확인된 명상 클래스).
페이지 경계는 회차 단위이며 회원·문서가 페이지 사이로 갈라지지 않는다.
성명·성별·계산된 만 나이만 내려보내며 생년월일은 포함하지 않는다.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, or_
from sqlalchemy.orm import Session as DBSession

from app.models.client_profile import ClientProfile
from app.models.record import Report
from app.models.session import Session, SessionParticipant
from app.models.user import User

_KST = timezone(timedelta(hours=9))
_RELEVANT = ("in_progress", "completed")
_TABS = ("all", "needs_review", "failed")


def age_in_years(birth: date | None, today: date | None = None) -> int | None:
    """생년월일과 기준일(Asia/Seoul)로 만 나이를 계산한다. 미상·미래 날짜는 None."""
    if birth is None:
        return None
    today = today or datetime.now(_KST).date()
    if birth > today:
        return None
    years = today.year - birth.year
    if (today.month, today.day) < (birth.month, birth.day):
        years -= 1
    return years


def _doc_state(report: Report | None, *, session: Session) -> dict | None:
    """문서 한 건의 목록용 요약. 리포트가 없으면 None."""
    if report is None:
        return None
    return {
        "report_id": str(report.id),
        "type": report.type,
        "status": report.status,
        "generation_status": report.generation_status or "pending",
        "generation_error": report.generation_error,
        "approval_required": not (report.type == "counselor" and session.class_id is not None),
        "approved_at": report.approved_at,
        "approved_by_name": report.approved_by_name,
        "approved_by_role": report.approved_by_role,
        "approval_source": report.approval_source,
        "delivery_status": report.delivery_status,
        "delivery_attempted_at": report.delivery_attempted_at,
        "is_read": bool(report.is_read),
    }


def _needs_review(doc: dict | None) -> bool:
    return bool(doc and doc["approval_required"] and doc["status"] == "pending_review")


def _failed(doc: dict | None) -> bool:
    return bool(doc and doc["status"] == "completed" and doc["delivery_status"] == "failed")


def _scoped_sessions(db: DBSession, user: User):
    query = db.query(Session).outerjoin(Report, Report.session_id == Session.id).filter(
        or_(Report.id.isnot(None), Session.status.in_(_RELEVANT)), Session.is_template.is_(False)
    )
    if user.role == "counselor":
        return query.filter(Session.host_id == user.id)
    from app.models.class_program import Class
    from app.models.organization import Organization
    from app.models.user_org_membership import UserOrgMembership

    permitted = (
        db.query(Class.id)
        .join(UserOrgMembership, UserOrgMembership.org_id == Class.organization_id)
        .join(Organization, Organization.id == Class.organization_id)
        .filter(
            Class.organization_attribution_known.is_(True),
            UserOrgMembership.user_id == user.id,
            UserOrgMembership.status == "active",
            UserOrgMembership.role == "org_admin",
            Organization.deactivated_at.is_(None),
        )
    )
    return query.filter(Session.type == "meditation", Session.class_id.in_(permitted))


def build_hierarchy(
    user_id: str,
    db: DBSession,
    *,
    q: str | None = None,
    tab: str = "all",
    counselor_id: str | None = None,
    activity: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    page: int = 1,
    limit: int = 10,
    today: date | None = None,
) -> dict:
    if tab not in _TABS:
        raise HTTPException(status_code=422, detail="알 수 없는 탭입니다")
    user = db.query(User).filter(User.id == UUID(str(user_id))).first()
    if user is None or user.status != "active" or user.role not in ("counselor", "org_admin"):
        raise HTTPException(status_code=403, detail="이 작업을 수행할 권한이 없습니다")

    session_rows = _scoped_sessions(db, user).distinct().all()
    if counselor_id:
        session_rows = [s for s in session_rows if str(s.host_id) == counselor_id]
    if activity:
        session_rows = [s for s in session_rows if s.type == activity]
    stamp = lambda s: s.scheduled_at or s.created_at  # noqa: E731
    if date_from:
        session_rows = [s for s in session_rows if stamp(s) and stamp(s).astimezone(_KST).date() >= date_from]
    if date_to:
        session_rows = [s for s in session_rows if stamp(s) and stamp(s).astimezone(_KST).date() <= date_to]

    sids = [s.id for s in session_rows]
    reports = db.query(Report).filter(Report.session_id.in_(sids)).all() if sids else []
    by_session: dict = {}
    for r in reports:
        by_session.setdefault(r.session_id, []).append(r)
    participants = (
        db.query(SessionParticipant).filter(SessionParticipant.session_id.in_(sids)).all() if sids else []
    )
    users = {}
    user_ids = {p.user_id for p in participants if p.user_id}
    if user_ids:
        for u, prof in (
            db.query(User, ClientProfile)
            .outerjoin(ClientProfile, ClientProfile.user_id == User.id)
            .filter(User.id.in_(user_ids))
            .all()
        ):
            users[u.id] = (u, prof)
    host_names = dict(db.query(User.id, User.name).filter(User.id.in_({s.host_id for s in session_rows})).all()) if session_rows else {}

    from app.models.class_program import Class

    class_ids = {s.class_id for s in session_rows if s.class_id}
    classes = {c.id: c for c in db.query(Class).filter(Class.id.in_(class_ids)).all()} if class_ids else {}

    needle = (q or "").strip().lower()
    groups: dict[str, dict] = {}
    summary = {"needs_review": 0, "failed_delivery": 0, "generation_failed": 0, "total_sessions": 0}

    for s in session_rows:
        reps = by_session.get(s.id, [])
        client_reports = {r.participant_id: r for r in reps if r.type == "client" and r.participant_id}
        common = next((r for r in reps if r.type == "counselor"), None)
        members = []
        for p in participants:
            if p.session_id != s.id or p.is_waitlisted:
                continue
            doc = _doc_state(client_reports.get(p.id), session=s)
            if p.user_id and p.user_id in users:
                u, prof = users[p.user_id]
                name, gender, birth = u.name, (prof.gender if prof else None), (prof.birth_date if prof else None)
            else:
                name, gender, birth = p.guest_name, p.gender, p.birth_date
            members.append(
                {
                    "participant_id": str(p.id),
                    "name": name,
                    "gender": gender,
                    "age": age_in_years(birth, today),
                    "is_guest": p.user_id is None,
                    "client_report": doc,
                }
            )
        for r in reps:  # 참가자 행이 없는 클라이언트 리포트도 유실 없이 노출
            if r.type == "client" and r.participant_id and not any(m["participant_id"] == str(r.participant_id) for m in members):
                members.append({"participant_id": str(r.participant_id), "name": None, "gender": None, "age": None,
                                "is_guest": r.user_id is None, "client_report": _doc_state(r, session=s)})
        common_doc = _doc_state(common, session=s)

        # 상태 정렬(할 일 우선): 발송 실패 → 검토 필요 → 생성 중 → 그 외
        def rank(m):
            d = m["client_report"]
            if _failed(d):
                return 0
            if _needs_review(d):
                return 1
            if d is None or d["generation_status"] in ("pending", "processing"):
                return 2
            return 3

        members.sort(key=lambda m: (rank(m), m["name"] or ""))
        matched_ids = None
        if needle:
            title = " ".join(
                filter(None, [s.title, classes[s.class_id].title if s.class_id in classes else None, host_names.get(s.host_id)])
            ).lower()
            if needle in title:
                matched_ids = {m["participant_id"] for m in members}
            else:
                matched_ids = {m["participant_id"] for m in members if m["name"] and needle in m["name"].lower()}
            if not matched_ids:
                continue
        if tab == "needs_review":
            matched = {m["participant_id"] for m in members if _needs_review(m["client_report"])}
        elif tab == "failed":
            matched = {m["participant_id"] for m in members if _failed(m["client_report"])}
        else:
            matched = {m["participant_id"] for m in members}
        if matched_ids is not None:
            matched &= matched_ids
        if not matched:
            continue
        shown = [m for m in members if m["participant_id"] in matched]
        pending = sum(1 for m in members if _needs_review(m["client_report"]))
        failed_n = sum(1 for m in members if _failed(m["client_report"]))
        gen_failed = sum(1 for m in members if m["client_report"] and m["client_report"]["generation_status"] == "partial"
                         and m["client_report"]["status"] == "error")
        summary["needs_review"] += pending
        summary["failed_delivery"] += failed_n
        summary["generation_failed"] += gen_failed
        summary["total_sessions"] += 1
        key = f"class:{s.class_id}" if s.class_id else "solo"
        cls = classes.get(s.class_id)
        group = groups.setdefault(
            key,
            {
                "key": key,
                "kind": "class" if s.class_id else "solo",
                "class_id": str(s.class_id) if s.class_id else None,  # solo 는 실제 클래스 ID 를 합성하지 않는다
                "title": (cls.title if cls else None) or ("개인 상담" if not s.class_id else "클래스"),
                "sessions": [],
            },
        )
        group["sessions"].append(
            {
                "session_id": str(s.id),
                "title": s.title,
                "type": s.type,
                "scheduled_at": s.scheduled_at or s.created_at,
                "counselor_id": str(s.host_id),
                "counselor_name": host_names.get(s.host_id),
                "participant_count": len(members),
                "matched_count": len(shown),
                "needs_review": pending,
                "delivery_failed": failed_n,
                "common_report": common_doc,
                "members": shown,
            }
        )

    flat = []
    for g in groups.values():
        g["sessions"].sort(key=lambda x: x["scheduled_at"] or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
        for sess in g["sessions"]:
            flat.append((g, sess))
    flat.sort(key=lambda t: (t[1]["scheduled_at"] or datetime.min.replace(tzinfo=timezone.utc)), reverse=True)
    total = len(flat)
    window = flat[(page - 1) * limit : page * limit]
    out: dict[str, dict] = {}
    for g, sess in window:
        slot = out.setdefault(g["key"], {**{k: v for k, v in g.items() if k != "sessions"}, "sessions": [],
                                         "continued": (page > 1 and sess is not g["sessions"][0])})
        slot["sessions"].append(sess)
    for slot in out.values():
        slot["needs_review"] = sum(x["needs_review"] for x in slot["sessions"])
        slot["session_total"] = len(next(g for g in groups.values() if g["key"] == slot["key"])["sessions"])
    return {
        "summary": summary,
        "groups": list(out.values()),
        "total_sessions": total,
        "page": page,
        "limit": limit,
    }
