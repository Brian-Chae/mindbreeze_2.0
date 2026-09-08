"""SDD-029: 인증된 참가자 이메일로 승인된 개인 리포트를 발송한다."""
from datetime import datetime, timedelta, timezone
from html import escape
from uuid import UUID

from fastapi import HTTPException
from jose import JWTError, jwt
from sqlalchemy.orm import Session as DBSession

from app.config import settings
from app.models.session import Session, SessionParticipant
from app.models.record import Report
from app.services.email_verify_service import verify_email_token
from app.tasks.email import send_report_email


def _token(kind: str, subject: str, session_id: str, **extra) -> str:
    return jwt.encode({"type": kind, "sub": subject, "session_id": session_id,
                       "exp": datetime.now(timezone.utc) + timedelta(days=7), **extra},
                      settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def participant_token(participant: SessionParticipant) -> str:
    """참여 시에만 반환하는 소유 증명. 공개 참가자 목록에는 포함하지 않는다."""
    return _token("report_participant", str(participant.id), str(participant.session_id))


def _decode(token: str | None, kind: str) -> dict:
    try:
        claims = jwt.decode(token or "", settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
        if claims.get("type") != kind:
            raise JWTError()
        return claims
    except JWTError:
        raise HTTPException(401, "토큰이 만료되었거나 유효하지 않습니다")


def enqueue_report_email(report_id: str) -> None:
    from app.tasks.report_email_task import report_email_task
    report_email_task.apply_async(args=[report_id], retry=False)


def request_report_email(session_id: UUID, payload, db: DBSession, user_id: str | None) -> dict:
    session = db.query(Session).filter(Session.id == session_id).with_for_update().first()
    if not session:
        raise HTTPException(404, "세션을 찾을 수 없습니다")
    participant = db.query(SessionParticipant).filter(
        SessionParticipant.id == payload.participant_id,
        SessionParticipant.session_id == session.id,
        SessionParticipant.is_waitlisted.is_(False),
    ).first()
    if not participant:
        raise HTTPException(403, "해당 세션의 참가자가 아닙니다")
    if participant.user_id:
        if str(participant.user_id) != user_id:
            raise HTTPException(403, "본인의 리포트만 요청할 수 있습니다")
    else:
        claims = _decode(payload.participant_token, "report_participant")
        if claims.get("sub") != str(participant.id) or claims.get("session_id") != str(session.id):
            raise HTTPException(403, "참가자 확인 정보가 일치하지 않습니다")
    if session.status != "completed":
        raise HTTPException(409, "완료된 세션에서만 리포트를 요청할 수 있습니다")
    if not payload.email_verify_token:
        raise HTTPException(401, "이메일 인증이 필요합니다")
    if verify_email_token(payload.email_verify_token).casefold() != str(payload.email).casefold():
        raise HTTPException(403, "인증한 이메일과 수신 이메일이 다릅니다")
    if participant.report_email and participant.report_email != str(payload.email):
        # 이전 수신자에게 발송 중인 작업과 주소 변경이 경합하지 않게 한다.
        raise HTTPException(409, "이미 등록된 리포트 수신 이메일은 변경할 수 없습니다")
    participant.report_email = str(payload.email)
    report = db.query(Report).filter(Report.session_id == session.id,
        Report.participant_id == participant.id, Report.type == "client").first()
    if not report:
        report = Report(session_id=session.id, participant_id=participant.id,
                        user_id=participant.user_id, type="client", content={}, status="pending_analysis")
        db.add(report)
        db.flush()
    db.commit()
    if report.status in ("pending_analysis", "error"):
        from app.tasks.report_task import generate_report_inline
        generate_report_inline(str(report.id), db)
    if report.status == "error":
        raise HTTPException(503, "리포트 생성에 실패했습니다. 다시 요청해주세요")
    if report.status != "completed":
        return {"status": "pending_review", "message": "상담사 승인 후 이메일로 발송됩니다"}
    if participant.report_email_sent_at:
        return {"status": "sent", "message": "이미 발송된 리포트입니다"}
    try:
        enqueue_report_email(str(report.id))
    except Exception:
        participant.report_email_status = "failed"
        db.commit()
        raise HTTPException(503, "메일 발송 예약에 실패했습니다. 다시 요청해주세요")
    return {"status": "queued", "message": "메일 발송을 예약했습니다"}


def deliver_report_email(report_id: str, db: DBSession) -> str:
    report = db.query(Report).filter(Report.id == UUID(report_id)).first()
    if not report or report.type != "client" or not report.participant_id:
        return "unavailable"
    participant = db.query(SessionParticipant).filter(
        SessionParticipant.id == report.participant_id,
        SessionParticipant.session_id == report.session_id,
    ).with_for_update().first()
    if not participant or not participant.report_email:
        return "unavailable"
    if report.status != "completed":
        return report.status
    if participant.report_email_sent_at:
        return "sent"
    token = _token("report_view", str(report.id), str(report.session_id), email=participant.report_email)
    link = f"{settings.report_email_base_url.rstrip('/')}/api/v1/sessions/{report.session_id}/report-email/view?token={token}"
    if not send_report_email(participant.report_email, link):
        participant.report_email_status = "failed"
        db.commit()
        return "failed"
    participant.report_email_status = "sent"
    participant.report_email_sent_at = datetime.now(timezone.utc)
    db.commit()
    return "sent"


def view_report_email(session_id: UUID, token: str, db: DBSession) -> str:
    claims = _decode(token, "report_view")
    if claims.get("session_id") != str(session_id):
        raise HTTPException(403, "리포트 접근 권한이 없습니다")
    try:
        report_id = UUID(claims.get("sub", ""))
    except (ValueError, TypeError):
        raise HTTPException(401, "유효하지 않은 리포트 링크입니다")
    report = db.query(Report).filter(Report.id == report_id, Report.session_id == session_id,
                                   Report.type == "client", Report.status == "completed").first()
    participant = db.query(SessionParticipant).filter(SessionParticipant.id == report.participant_id).first() if report else None
    if not participant or participant.report_email != claims.get("email"):
        raise HTTPException(403, "리포트 접근 권한이 없습니다")
    # 링크 열람에는 허용한 내담자 필드만 사용하며 HTML을 이스케이프한다.
    content = report.content or {}
    title = escape(str(content.get("title") or "내 마음 리포트"))
    summary = escape(str(content.get("summary") or "오늘 세션에 참여해주셔서 감사합니다."))
    insights = content.get("insights") or []
    items = "".join(f"<li>{escape(str(item))}</li>" for item in insights)
    eeg = content.get("eeg") or {}
    metrics = eeg.get("metrics") or {}
    labels = {"focus_index_stability_score": "집중 안정도", "total_neural_activity_score": "신경 활동도",
              "cognitive_load_stability_score": "인지 부하 안정도", "stress_score": "스트레스",
              "hemispheric_balance_score": "좌우 균형", "emotional_stability_score": "정서 안정도",
              "relaxation_score": "두뇌휴식도"}
    rows = "".join(f"<li>{label}: {escape(str(metrics[key]))}</li>" for key, label in labels.items() if metrics.get(key) is not None)
    return f'<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{title}</title><body><main><h1>{title}</h1><p>{summary}</p><ul>{items}</ul><h2>뇌파 분석</h2><ul>{rows or "<li>측정된 뇌파 지표가 없습니다.</li>"}</ul></main></body></html>'
