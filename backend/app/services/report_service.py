"""AI 리포트 서비스"""

from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session as DBSession

from app.models.session import Session, SessionParticipant
from app.models.record import Report
from app.models.user import User
from app.services import notification_service
from app.tasks.report_task import generate_report_inline


def _to_uuid(value: str) -> UUID:
    try:
        return UUID(str(value))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="잘못된 ID 형식입니다")


def _now() -> datetime:
    return datetime.now(timezone.utc)


# 하루밴드 7지표 키 (프론트 report.ts EEG_METRIC_KEYS 와 순서·이름 동일)
_EEG_METRIC_KEYS = (
    "focus_index_stability_score",
    "total_neural_activity_score",
    "cognitive_load_stability_score",
    "stress_score",
    "hemispheric_balance_score",
    "emotional_stability_score",
    "relaxation_score",
)


def _normalize_eeg(eeg) -> dict | None:
    """content.eeg 를 단일 계약으로 정규화한다.

    - 레거시 {available: bool} → status 매핑
    - not_measured 는 최소 형태로 축약 (프론트 섹션 숨김)
    - 두뇌휴식도 = relaxation_score 단일 소스를 summary_labels 로 보장
    - 7지표는 null 보존 (없는 키는 None, 0 치환 금지)
    """
    if not isinstance(eeg, dict):
        return None

    status = eeg.get("status")
    if status is None:
        avail = eeg.get("available")
        status = "valid" if avail is True else "not_measured"
    if status == "not_measured":
        return {"status": "not_measured"}

    metrics_in = eeg.get("metrics") if isinstance(eeg.get("metrics"), dict) else {}
    metrics = {k: metrics_in.get(k) for k in _EEG_METRIC_KEYS}

    labels = dict(eeg.get("summary_labels") or {})
    labels.setdefault("relaxation_score", "두뇌휴식도")

    return {
        "status": status,
        "reliability": eeg.get("reliability"),
        "drowsiness_flag": bool(eeg.get("drowsiness_flag")),
        "score": eeg.get("score"),
        "metrics": metrics,
        "summary_labels": labels,
        "timeline": eeg.get("timeline") if isinstance(eeg.get("timeline"), list) else [],
        "normalization_version": eeg.get("normalization_version"),
    }


def normalize_report_content(content, report_type: str = "counselor") -> dict:
    """리포트 content 를 UI 단일 계약으로 정규화한다.

    additive·idempotent — 기존 키(headline/approved/sections 등)를 보존하면서
    summary/insights/markers/eeg 계약 필드를 보강한다. null 보존이 원칙이다.
    """
    if not isinstance(content, dict):
        return {}

    out = dict(content)  # 기존 키 보존
    # summary 는 없으면 None (하위호환: headline 은 그대로 둔다)
    out["summary"] = content.get("summary")
    out["insights"] = out["insights"] if isinstance(out.get("insights"), list) else []
    out["markers"] = out["markers"] if isinstance(out.get("markers"), list) else []

    eeg_norm = _normalize_eeg(content.get("eeg"))
    if eeg_norm is None:
        out.pop("eeg", None)
    else:
        out["eeg"] = eeg_norm
    return out


def _serialize(report: Report, session: Session | None = None) -> dict:
    return {
        "id": str(report.id),
        "session_id": str(report.session_id),
        # SDD-027: 게스트 리포트는 user_id 가 없다(participant_id 로 소유).
        "user_id": str(report.user_id) if report.user_id else None,
        "participant_id": str(report.participant_id) if report.participant_id else None,
        "type": report.type,
        # SDD-027: 리포트 상태머신 + 데이터 신뢰도(null 보존)
        "status": report.status,
        "data_credibility": report.data_credibility,
        "content": normalize_report_content(report.content, report.type),
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

    owner_participant_id = None
    if report_type == "counselor":
        owner_uuid = s.host_id
    else:
        first_participant = (
            db.query(SessionParticipant)
            .filter(SessionParticipant.session_id == s.id)
            .first()
        )
        if first_participant:
            # SDD-027: 게스트 내담자는 user_id 가 없다(None) — participant_id 로 소유를 보완한다.
            owner_uuid = first_participant.user_id
            owner_participant_id = first_participant.id
        else:
            owner_uuid = s.host_id

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
            participant_id=owner_participant_id,
            type=report_type,
            # SDD-027: 상태머신 시작점 — 분석 대기(pending_analysis)
            status="pending_analysis",
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

    # SDD-027: 승인 게이트 = pending_review → completed. 이미 completed 면 멱등 처리.
    # 분석 미완/실패(pending_analysis/error) 상태는 승인할 수 없다.
    if report.status not in ("pending_review", "completed"):
        raise HTTPException(status_code=400, detail="검토 대기 상태의 리포트만 승인할 수 있습니다")

    already_completed = report.status == "completed"
    report.status = "completed"
    report.sent_at = report.sent_at or _now()
    content = dict(report.content or {})
    content["approved"] = True
    report.content = content

    # F10 알림 이벤트 — 게스트(user_id 없음)는 알림 대상이 아니며, 중복 승인 시 재발송하지 않는다.
    if report.user_id is not None and not already_completed:
        try:
            notification_service.notify_event(
                "report_ready",
                report.user_id,
                {
                    "title": "리포트가 도착했습니다",
                    "body": "세션 리포트가 승인되어 전송되었습니다",
                    "extra": {"report_id": str(report.id), "session_id": str(report.session_id)},
                },
                db,
            )
        except Exception:  # noqa: BLE001
            pass

    db.commit()
    db.refresh(report)
    return _serialize(report, session)
