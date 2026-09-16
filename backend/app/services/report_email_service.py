"""SDD-029: 인증된 참가자 이메일로 승인된 개인 리포트를 발송한다."""
import logging
from datetime import datetime, timedelta, timezone
from html import escape
from uuid import UUID

from fastapi import HTTPException
from jose import JWTError, jwt
from sqlalchemy.orm import Session as DBSession

from app.config import settings
from app.models.session import Session, SessionParticipant
from app.models.record import Report
from app.services.report_service import _serialize
from app.services.email_verify_service import verify_email_token
from app.tasks.email import send_report_email

logger = logging.getLogger(__name__)


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
        logger.exception(
            "[report_email] enqueue failed: report_id=%s session_id=%s participant_id=%s",
            report.id,
            session.id,
            participant.id,
        )
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
    link = f"{settings.report_email_base_url.rstrip('/')}/report-view?token={token}"
    try:
        sent = send_report_email(participant.report_email, link)
    except Exception:
        participant.report_email_status = "failed"
        db.commit()
        logger.exception(
            "[report_email] delivery exception: report_id=%s session_id=%s participant_id=%s",
            report.id,
            report.session_id,
            participant.id,
        )
        return "failed"
    if not sent:
        participant.report_email_status = "failed"
        db.commit()
        logger.warning(
            "[report_email] delivery failed: report_id=%s session_id=%s participant_id=%s",
            report.id,
            report.session_id,
            participant.id,
        )
        return "failed"
    participant.report_email_status = "sent"
    participant.report_email_sent_at = datetime.now(timezone.utc)
    db.commit()
    return "sent"


def resend_report_email(report_id: str, email: str, db: DBSession) -> bool:
    """승인된 내담자 리포트를 지정 주소로 다시 발송한다."""
    try:
        report_uuid = UUID(report_id)
    except (TypeError, ValueError):
        raise HTTPException(400, "잘못된 리포트 ID 형식입니다")

    report = db.query(Report).filter(Report.id == report_uuid).first()
    if not report:
        raise HTTPException(404, "리포트를 찾을 수 없습니다")
    if not report.participant_id:
        raise HTTPException(400, "참가자가 있는 리포트만 재발송할 수 있습니다")
    if report.status != "completed":
        raise HTTPException(409, "승인 완료된 리포트만 재발송할 수 있습니다")

    participant = db.query(SessionParticipant).filter(
        SessionParticipant.id == report.participant_id,
        SessionParticipant.session_id == report.session_id,
    ).first()
    if not participant:
        raise HTTPException(400, "리포트 참가자를 찾을 수 없습니다")

    token = _token(
        "report_view",
        str(report.id),
        str(report.session_id),
        email=email,
    )
    link = f"{settings.report_email_base_url.rstrip('/')}/report-view?token={token}"
    try:
        sent = send_report_email(email, link)
    except Exception:
        logger.exception(
            "[report_email] resend exception: report_id=%s session_id=%s participant_id=%s",
            report.id,
            report.session_id,
            participant.id,
        )
        return False
    if not sent:
        logger.warning(
            "[report_email] resend failed: report_id=%s session_id=%s participant_id=%s",
            report.id,
            report.session_id,
            participant.id,
        )
        return False

    participant.report_email = email
    db.commit()
    return True


def get_report_view_content(token: str, db: DBSession) -> dict:
    """report_view 토큰 소유자에게 완료된 내담자 리포트 계약을 반환한다."""
    claims = _decode(token, "report_view")
    try:
        report_id = UUID(claims.get("sub", ""))
        session_id = UUID(claims.get("session_id", ""))
    except (TypeError, ValueError):
        raise HTTPException(401, "유효하지 않은 리포트 링크입니다")

    report = db.query(Report).filter(
        Report.id == report_id,
        Report.session_id == session_id,
        Report.type == "client",
        Report.status == "completed",
    ).first()
    participant = db.query(SessionParticipant).filter(
        SessionParticipant.id == report.participant_id,
        SessionParticipant.session_id == session_id,
    ).first() if report and report.participant_id else None
    if not participant or participant.report_email != claims.get("email"):
        raise HTTPException(403, "리포트 접근 권한이 없습니다")

    session = db.query(Session).filter(Session.id == session_id).first()
    if not session:
        raise HTTPException(403, "리포트 접근 권한이 없습니다")
    return _serialize(report, session, report_email=participant.report_email)


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
    items = "".join(
        f'<li style="padding:18px 20px;margin-bottom:12px;background:#F1FAF5;'
        f'border-left:3px solid #59CE90;border-radius:0 12px 12px 0;white-space:pre-wrap;">{escape(str(item))}</li>'
        for item in insights
    )
    eeg = content.get("eeg") or {}
    metrics = eeg.get("metrics") or {}
    labels = {"focus_index_stability_score": "집중 안정도", "total_neural_activity_score": "신경 활동도",
              "cognitive_load_stability_score": "인지 부하 안정도", "stress_score": "스트레스",
              "hemispheric_balance_score": "좌우 균형", "emotional_stability_score": "정서 안정도",
              "relaxation_score": "두뇌휴식도"}
    cards = []
    for key, label in labels.items():
        value = metrics.get(key)
        # 측정되지 않은 값은 0으로 대체하거나 긍정적인 상태로 해석하지 않는다.
        detail = (
            f'<details style="margin-top:12px;color:#5F0080;font-size:13px;">'
            f'<summary style="cursor:pointer;padding:6px 0;">측정값 자세히 보기</summary>'
            f'<p style="margin:8px 0 0;color:#63566B;">측정값: {escape(str(value))}</p></details>'
            if value is not None else
            '<p style="margin:12px 0 0;color:#63566B;font-size:13px;">측정 정보 없음</p>'
        )
        cards.append(
            f'<article style="min-width:0;padding:22px;background:#FFFFFF;border:1px solid #E8D9EF;border-radius:16px;">'
            f'<h3 style="margin:0;font-size:16px;font-weight:700;">{label}</h3>{detail}</article>'
        )
    empty_metrics = (
        '<p style="color:#63566B;">측정된 뇌파 지표가 없습니다.</p>'
        if all(metrics.get(key) is None for key in labels) else ''
    )
    return f"""<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{title} · MIND BREEZE</title></head>
<body style="margin:0;background:#FAF9FB;color:#1F1F1F;font-family:Arial,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;font-size:16px;line-height:1.8;overflow-wrap:anywhere;">
<header style="max-width:840px;margin:auto;padding:24px 20px;box-sizing:border-box;">
  <span style="color:#59CE90;font-size:24px;" aria-hidden="true">●</span>
  <strong style="color:#5F0080;font-size:16px;letter-spacing:2px;">MIND BREEZE</strong>
  <span style="display:inline-block;margin-left:12px;color:#63566B;font-size:12px;">나를 위한 세션 리포트</span>
</header>
<main style="max-width:800px;margin:0 auto 32px;border:1px solid #E8D9EF;border-radius:24px;overflow:hidden;background:#FFFFFF;">
  <section aria-labelledby="cover-title" style="padding:clamp(28px,6vw,56px) clamp(20px,5vw,48px);background:#F5EDFC;">
    <p style="margin:0 0 20px;color:#5F0080;font-size:12px;letter-spacing:2px;">01 · 나에게 돌아오는 시간</p>
    <h1 id="cover-title" style="margin:0;color:#5F0080;font-size:clamp(28px,5vw,42px);line-height:1.4;letter-spacing:-1px;white-space:pre-wrap;">{title}</h1>
    <div style="width:40px;height:4px;background:#59CE90;border-radius:4px;margin:28px 0;" aria-hidden="true"></div>
    <p style="margin:0;color:#63566B;font-size:17px;line-height:1.95;white-space:pre-wrap;">{summary}</p>
  </section>
  <section aria-labelledby="insights-title" style="padding:clamp(28px,6vw,48px) clamp(20px,5vw,48px);">
    <p style="margin:0 0 8px;color:#5F0080;font-size:12px;letter-spacing:2px;">02 · 세션 인사이트</p>
    <h2 id="insights-title" style="margin:0 0 24px;font-size:24px;line-height:1.5;">오늘의 나를 돌아보며</h2>
    <ul style="list-style:none;margin:0;padding:0;">{items or '<li style="color:#63566B;">아직 등록된 인사이트가 없습니다.</li>'}</ul>
  </section>
  <section aria-labelledby="eeg-title" style="padding:clamp(28px,6vw,48px) clamp(20px,5vw,48px);background:#F5EDFC;">
    <p style="margin:0 0 8px;color:#5F0080;font-size:12px;letter-spacing:2px;">03 · 뇌파 분석</p>
    <h2 id="eeg-title" style="margin:0 0 12px;font-size:24px;line-height:1.5;">마음의 기록을 살펴보세요</h2>
    <p style="margin:0 0 24px;color:#63566B;font-size:14px;">세션에서 기록한 지표입니다. 궁금한 항목을 펼쳐 측정값을 확인해 보세요.</p>
    {empty_metrics}
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:14px;">{''.join(cards)}</div>
    <p style="margin:24px 0 0;color:#63566B;font-size:12px;">측정 정보가 없는 항목은 해석하지 않습니다. 지표는 나의 느낌과 함께 읽어주세요.</p>
  </section>
  <footer style="padding:32px clamp(20px,5vw,48px);">
    <p style="margin:0 0 12px;color:#5F0080;font-weight:bold;">나를 알아가는 작은 시간, MIND BREEZE</p>
    <p style="margin:0;color:#63566B;font-size:12px;">이 페이지는 개인 리포트입니다. 링크를 다른 사람에게 공유하지 마세요.<br>리포트 링크는 발급 후 7일간 유효합니다.</p>
  </footer>
</main></body></html>"""
