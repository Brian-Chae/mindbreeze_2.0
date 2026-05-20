"""AI 리포트 서비스"""

from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session as DBSession

from app.models.session import Session, SessionParticipant
from app.models.record import Report
from app.models.notification import Notification
from app.models.user import User
from app.tasks.report_task import generate_report_inline


def _to_uuid(value: str) -> UUID:
    try:
        return UUID(str(value))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="잘못된 ID 형식입니다")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _serialize(report: Report, session: Session | None = None) -> dict:
    return {
        "id": str(report.id),
        "session_id": str(report.session_id),
        "user_id": str(report.user_id),
        "type": report.type,
        "content": report.content or {},
        "pdf_url": report.pdf_url,
        "sent_at": report.sent_at,
        "is_read": bool(report.is_read),
        "created_at": report.created_at,
        "session_title": session.title if session else None,
        "session_type": session.type if session else None,
        "scheduled_at": session.scheduled_at if session else None,
    }


def _get_session_as_host(session_id: str, host_id: str, db: DBSession) -> Session:
    sid = _to_uuid(session_id)
    s = db.query(Session).filter(Session.id == sid).first()
    if not s:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")
    if s.host_id != _to_uuid(host_id):
        raise HTTPException(status_code=403, detail="host 상담사만 가능합니다")
    return s


def generate_report(session_id: str, host_id: str, report_type: str, db: DBSession) -> dict:
    if report_type not in ("counselor", "client"):
        raise HTTPException(status_code=400, detail="잘못된 리포트 유형")
    s = _get_session_as_host(session_id, host_id, db)

    if report_type == "counselor":
        owner_uuid = s.host_id
    else:
        first_participant = (
            db.query(SessionParticipant)
            .filter(SessionParticipant.session_id == s.id)
            .first()
        )
        owner_uuid = first_participant.user_id if first_participant else s.host_id

    existing = (
        db.query(Report)
        .filter(Report.session_id == s.id, Report.type == report_type)
        .first()
    )
    if existing:
        report = existing
    else:
        report = Report(
            session_id=s.id,
            user_id=owner_uuid,
            type=report_type,
            content={"status": "generating"},
        )
        db.add(report)
        db.flush()

    report = generate_report_inline(str(report.id), db) or report
    return _serialize(report, s)


def list_reports(user_id: str, db: DBSession) -> dict:
    uid = _to_uuid(user_id)
    user = db.query(User).filter(User.id == uid).first()

    items: list[Report] = []
    if user and user.role == "counselor":
        sessions = db.query(Session).filter(Session.host_id == uid).all()
        sids = [s.id for s in sessions]
        sessions_map = {s.id: s for s in sessions}
        if sids:
            items = (
                db.query(Report)
                .filter(Report.session_id.in_(sids))
                .order_by(Report.created_at.desc())
                .all()
            )
    else:
        items = (
            db.query(Report)
            .filter(Report.user_id == uid)
            .order_by(Report.created_at.desc())
            .all()
        )
        session_ids = {r.session_id for r in items}
        sessions_map = {
            s.id: s
            for s in db.query(Session).filter(Session.id.in_(session_ids)).all()
        } if session_ids else {}

    result = [_serialize(r, sessions_map.get(r.session_id)) for r in items]
    return {"reports": result, "total": len(result)}


def get_report(report_id: str, user_id: str, db: DBSession) -> dict:
    rid = _to_uuid(report_id)
    report = db.query(Report).filter(Report.id == rid).first()
    if not report:
        raise HTTPException(status_code=404, detail="리포트를 찾을 수 없습니다")
    session = db.query(Session).filter(Session.id == report.session_id).first()
    uid = _to_uuid(user_id)
    if report.user_id != uid and (not session or session.host_id != uid):
        raise HTTPException(status_code=403, detail="접근 권한이 없습니다")
    return _serialize(report, session)


def update_report(report_id: str, host_id: str, payload, db: DBSession) -> dict:
    rid = _to_uuid(report_id)
    report = db.query(Report).filter(Report.id == rid).first()
    if not report:
        raise HTTPException(status_code=404, detail="리포트를 찾을 수 없습니다")
    session = db.query(Session).filter(Session.id == report.session_id).first()
    if not session or session.host_id != _to_uuid(host_id):
        raise HTTPException(status_code=403, detail="host 상담사만 수정 가능합니다")

    if payload.content is not None:
        report.content = payload.content
    db.commit()
    db.refresh(report)
    return _serialize(report, session)


def approve_report(report_id: str, host_id: str, db: DBSession) -> dict:
    rid = _to_uuid(report_id)
    report = db.query(Report).filter(Report.id == rid).first()
    if not report:
        raise HTTPException(status_code=404, detail="리포트를 찾을 수 없습니다")
    session = db.query(Session).filter(Session.id == report.session_id).first()
    if not session or session.host_id != _to_uuid(host_id):
        raise HTTPException(status_code=403, detail="host 상담사만 승인 가능합니다")

    report.sent_at = _now()
    content = dict(report.content or {})
    content["approved"] = True
    report.content = content

    # F10 알림 이벤트 (이메일 발송은 별도 SDD)
    try:
        notif = Notification(
            user_id=report.user_id,
            type="report_approved",
            title="리포트가 도착했습니다",
            body=f"세션 리포트가 승인되어 전송되었습니다",
            extra={"report_id": str(report.id), "session_id": str(report.session_id)},
        )
        db.add(notif)
    except Exception:  # noqa: BLE001
        pass

    db.commit()
    db.refresh(report)
    return _serialize(report, session)
