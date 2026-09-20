"""AI 리포트 서비스"""

from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session as DBSession

from app.models.session import Session, SessionParticipant
from app.models.client_profile import ClientProfile
from app.models.record import Report
from app.models.user import User
from app.services import notification_service
from app.schemas.eeg import HRVMotionSummary


def generate_report_inline(report_id: str, db: DBSession):
    """Celery가 태스크부터 로드해도 순환 import 없이 기존 생성 함수를 호출한다."""
    from app.tasks.report_task import generate_report_inline as generate

    return generate(report_id, db)


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
        **HRVMotionSummary.model_validate(eeg).model_dump(),
        "status": status,
        "reliability": eeg.get("reliability"),
        "drowsiness_flag": bool(eeg.get("drowsiness_flag")),
        "score": eeg.get("score"),
        "metrics": metrics,
        "summary_labels": labels,
        "timeline": eeg.get("timeline") if isinstance(eeg.get("timeline"), list) else [],
        "normalization_source": eeg.get("normalization_source", "cohort"),
        "normalization_version": eeg.get("normalization_version"),
        # SDD-045: LLM 서사(또는 규칙 폴백) 보존 — 없으면 None
        "narrative": eeg.get("narrative"),
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


def _serialize(
    report: Report,
    session: Session | None = None,
    report_email: str | None = None,
    participant_info: dict | None = None,
) -> dict:
    content = normalize_report_content(report.content, report.type)
    eeg = content.get("eeg")
    summary = HRVMotionSummary.model_validate(eeg if isinstance(eeg, dict) else {})
    return {
        **summary.model_dump(),
        "id": str(report.id),
        "session_id": str(report.session_id),
        # SDD-027: 게스트 리포트는 user_id 가 없다(participant_id 로 소유).
        "user_id": str(report.user_id) if report.user_id else None,
        "participant_id": str(report.participant_id) if report.participant_id else None,
        "report_email": report_email,
        "type": report.type,
        # SDD-027: 리포트 상태머신 + 데이터 신뢰도(null 보존)
        "status": report.status,
        "data_credibility": report.data_credibility,
        "content": content,
        "pdf_url": report.pdf_url,
        "sent_at": report.sent_at,
        "is_read": bool(report.is_read),
        "created_at": report.created_at,
        "session_title": session.title if session else None,
        "session_type": session.type if session else None,
        "scheduled_at": session.scheduled_at if session else None,
        "participant_name": (
            participant_info.get("participant_name") if participant_info else None
        ),
        "gender": participant_info.get("gender") if participant_info else None,
        "birth_date": participant_info.get("birth_date") if participant_info else None,
        "is_guest": participant_info.get("is_guest") if participant_info else None,
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
    first_participant = (
        db.query(SessionParticipant)
        .filter(SessionParticipant.session_id == s.id)
        .first()
    )
    if report_type == "counselor":
        owner_uuid = s.host_id
        # SDD-065: counselor 리포트도 참여자 정보(이름/성별/생년월일/회원·비회원) 표시를 위해 participant_id 설정
        if first_participant:
            owner_participant_id = first_participant.id
    else:
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
    host = db.query(User).filter(User.id == s.host_id).first()
    if (
        report.status == "pending_review"
        and host is not None
        and host.role == "counselor"
        and host.auto_approve_report
    ):
        return approve_report(str(report.id), host_id, db)
    return _serialize(report, s)


def generate_client_reports_for_session(session_id: str, db: DBSession) -> list[dict]:
    """SDD-086: 세션의 active participant(대기열 제외)별 client 리포트를 생성한다.

    - existing 체크는 report_email_service.request_report_email 과 동일한
      (session_id, participant_id, type="client") 기준 — 멱등, 중복 생성 방지.
    - 게스트는 user_id 가 없으므로(None) participant_id 로 소유를 보완한다 (SDD-027).
    - auto_approve_report 가 켜진 상담사는 생성 직후 자동 승인한다 (기존 정책 유지).
    """
    sid = _to_uuid(session_id)
    s = db.query(Session).filter(Session.id == sid).first()
    if not s:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")

    participants = (
        db.query(SessionParticipant)
        .filter(
            SessionParticipant.session_id == s.id,
            SessionParticipant.is_waitlisted.is_(False),
        )
        .all()
    )
    host = db.query(User).filter(User.id == s.host_id).first()
    auto_approve = bool(host and host.role == "counselor" and host.auto_approve_report)

    results: list[dict] = []
    for participant in participants:
        report = (
            db.query(Report)
            .filter(
                Report.session_id == s.id,
                Report.participant_id == participant.id,
                Report.type == "client",
            )
            .first()
        )
        if not report:
            report = Report(
                session_id=s.id,
                user_id=participant.user_id,
                participant_id=participant.id,
                type="client",
                status="pending_analysis",
                content={"status": "generating"},
            )
            db.add(report)
            db.flush()
        # 이미 승인 게이트를 지난 리포트(pending_review/completed)는 재생성하지 않는다 — 멱등.
        if report.status in ("pending_analysis", "error"):
            report = generate_report_inline(str(report.id), db) or report
        if report.status == "pending_review" and auto_approve:
            results.append(approve_report(str(report.id), str(s.host_id), db))
        else:
            results.append(_serialize(report, s))
    return results


def get_auto_approve_setting(user_id: str, db: DBSession) -> dict:
    user = db.query(User).filter(User.id == _to_uuid(user_id)).first()
    return {"enabled": bool(user and user.auto_approve_report)}


def update_auto_approve_setting(user_id: str, enabled: bool, db: DBSession) -> dict:
    user = db.query(User).filter(User.id == _to_uuid(user_id)).first()
    if not user:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")
    user.auto_approve_report = enabled
    db.commit()
    db.refresh(user)
    return {"enabled": user.auto_approve_report}


def list_reports(
    user_id: str,
    db: DBSession,
    page: int | None = None,
    limit: int | None = None,
) -> dict:
    uid = _to_uuid(user_id)
    user = db.query(User).filter(User.id == uid).first()

    if user and user.role in ("counselor", "org_admin"):
        host_ids = [uid] if user.role == "counselor" else [
            row[0] for row in db.query(User.id).filter(User.org_id == user.org_id).all()
        ]
        sessions = db.query(Session).filter(Session.host_id.in_(host_ids)).all()
        sids = [s.id for s in sessions]
        sessions_map = {s.id: s for s in sessions}
        if sids:
            query = db.query(Report).filter(Report.session_id.in_(sids))
        else:
            query = db.query(Report).filter(False)
    else:
        query = db.query(Report).filter(Report.user_id == uid)

    total = query.count()
    query = query.order_by(Report.created_at.desc(), Report.id.desc())
    if page is not None and limit is not None:
        query = query.offset((page - 1) * limit).limit(limit)
    items = query.all()

    if not (user and user.role in ("counselor", "org_admin")):
        session_ids = {r.session_id for r in items}
        sessions_map = {
            s.id: s
            for s in db.query(Session).filter(Session.id.in_(session_ids)).all()
        } if session_ids else {}

    participant_ids = {r.participant_id for r in items if r.participant_id}
    participants_map = {
        participant.id: participant
        for participant in db.query(SessionParticipant)
        .filter(SessionParticipant.id.in_(participant_ids))
        .all()
    } if participant_ids else {}

    participant_user_ids = {
        participant.user_id
        for participant in participants_map.values()
        if participant.user_id
    }
    member_info_map = {
        user.id: (user, profile)
        for user, profile in db.query(User, ClientProfile)
        .outerjoin(ClientProfile, ClientProfile.user_id == User.id)
        .filter(User.id.in_(participant_user_ids))
        .all()
    } if participant_user_ids else {}

    participant_info_map = {}
    for participant_id, participant in participants_map.items():
        is_guest = participant.user_id is None
        user, profile = member_info_map.get(participant.user_id, (None, None))
        participant_info_map[participant_id] = {
            "participant_name": participant.guest_name if is_guest else (user.name if user else None),
            "gender": participant.gender if is_guest else (profile.gender if profile else None),
            "birth_date": (
                participant.birth_date if is_guest else (profile.birth_date if profile else None)
            ),
            "is_guest": is_guest,
        }

    result = [
        _serialize(
            report,
            sessions_map.get(report.session_id),
            participant_info=participant_info_map.get(report.participant_id),
        )
        for report in items
    ]
    response = {"reports": result, "total": total}
    if page is not None and limit is not None:
        response.update({"page": page, "limit": limit})
    return response


def get_report(report_id: str, user_id: str, db: DBSession) -> dict:
    rid = _to_uuid(report_id)
    report = db.query(Report).filter(Report.id == rid).first()
    if not report:
        raise HTTPException(status_code=404, detail="리포트를 찾을 수 없습니다")
    session = db.query(Session).filter(Session.id == report.session_id).first()
    if not _can_access_report(user_id, session, db):
        raise HTTPException(status_code=403, detail="접근 권한이 없습니다")
    participant = (
        db.query(SessionParticipant)
        .filter(SessionParticipant.id == report.participant_id)
        .first()
        if report.participant_id
        else None
    )
    return _serialize(
        report,
        session,
        participant.report_email if participant else None,
    )


def _can_access_report(user_id: str, session, db: DBSession) -> bool:
    """사용자가 리포트 세션에 접근 가능한지 (본인 세션 host 또는 기관 관리자)."""
    uid = _to_uuid(user_id)
    if session and session.host_id == uid:
        return True
    user = db.query(User).filter(User.id == uid).first()
    if user and user.role == "org_admin" and user.org_id and session:
        host = db.query(User).filter(User.id == session.host_id).first()
        return bool(host and host.org_id == user.org_id)
    return False


def require_report_host(report_id: str, host_id: str, db: DBSession) -> None:
    """리포트가 현재 상담사의 세션에 속하는지 확인한다. (org_admin은 소속 기관 세션 허용)"""
    rid = _to_uuid(report_id)
    report = db.query(Report).filter(Report.id == rid).first()
    if not report:
        raise HTTPException(status_code=404, detail="리포트를 찾을 수 없습니다")
    session = db.query(Session).filter(Session.id == report.session_id).first()
    if not _can_access_report(host_id, session, db):
        raise HTTPException(status_code=403, detail="host 상담사만 가능합니다")


def update_report(report_id: str, host_id: str, payload, db: DBSession) -> dict:
    rid = _to_uuid(report_id)
    report = db.query(Report).filter(Report.id == rid).first()
    if not report:
        raise HTTPException(status_code=404, detail="리포트를 찾을 수 없습니다")
    session = db.query(Session).filter(Session.id == report.session_id).first()
    if not _can_access_report(host_id, session, db):
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
                    "body": "세션 리포트가 승인되었습니다",
                    "extra": {"report_id": str(report.id), "session_id": str(report.session_id)},
                },
                db,
            )
        except Exception:  # noqa: BLE001
            pass

    db.commit()
    db.refresh(report)
    # SDD-066: 수동/자동 승인 모두 메일을 예약하지 않는다. 발송은 별도 요청으로 처리한다.
    return _serialize(report, session)
