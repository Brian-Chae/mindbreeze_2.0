"""SDD-327 T13 — 리포트 공유 메일 발송 태스크.

`email_app`(큐 email)에 등록한다. mindbreeze-email-worker 는 `report_email_task` 모듈만 로드하므로
그 모듈 끝에서 이 모듈을 import 해 태스크가 워커에 등록되게 한다(미등록 시 unregistered task 로 버려짐).

계약: apply_async(args=[event_id, email, share_url, attach_pdf, message, sender_name], retry=False)
- message 는 호출측에서 이미 HTML 이스케이프된 문자열/None, sender_name 은 대체 처리된 표시 이름.
- 수신 주소 원문은 큐 인자로만 받고 저장·로그 평문 출력하지 않는다.
- PDF 첨부는 책 PDF(T6)를 지연 import 로 호출한다. 모듈이 없거나 실패·8MB 초과면 링크만 보낸다.
- 결과는 report_share_events.status(sent/failed)·sent_at·error_code·attached 에 반영한다.
"""
from __future__ import annotations

import base64
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Callable

import httpx

from app.config import settings
from app.tasks.report_email_task import email_app

logger = logging.getLogger(__name__)

MAX_ATTACH_BYTES = 8 * 1024 * 1024
ATTACH_FILENAME = "명상 기록 책.pdf"
MAX_RETRIES = 2
_RESEND_API = "https://api.resend.com/emails"

# T6(member_report_book)가 노출하는 렌더 함수 후보 — (content: dict) -> bytes
_BOOK_FUNC_NAMES = ("render_book_pdf", "build_book_pdf", "render_member_report_book")


def _render_book_pdf(content: dict[str, Any]) -> bytes | None:
    """책 PDF 바이트. 모듈·함수가 없거나 실패하면 None(링크만 발송)."""
    try:
        from app.services import member_report_book  # 지연 import — T6 미병합이어도 안전
    except Exception:  # noqa: BLE001
        logger.info("[report_share] 책 PDF 모듈 없음 — 링크만 발송")
        return None
    for name in _BOOK_FUNC_NAMES:
        func: Callable[..., Any] | None = getattr(member_report_book, name, None)
        if callable(func):
            try:
                data = func(content)
            except Exception:  # noqa: BLE001
                logger.exception("[report_share] 책 PDF 생성 실패 — 링크만 발송")
                return None
            return bytes(data) if isinstance(data, (bytes, bytearray)) and data else None
    logger.warning("[report_share] 책 PDF 렌더 함수를 찾지 못함 — 링크만 발송")
    return None


def _send_with_attachment(to_email: str, subject: str, text: str, html: str, pdf: bytes) -> bool:
    """Resend 첨부 발송. 기존 `_send_email` 이 첨부를 지원하지 않아 같은 규약으로 별도 호출한다."""
    from app.tasks.email import _mask_email

    if settings.debug and not settings.resend_api_key:
        logger.info("[EMAIL DEBUG] To: %s | Subject: %s | 첨부 %dB", _mask_email(to_email), subject, len(pdf))
        return True
    payload = {
        "from": settings.resend_from_email,
        "to": [to_email],
        "subject": subject,
        "text": text,
        "html": html,
        "attachments": [{"filename": ATTACH_FILENAME, "content": base64.b64encode(pdf).decode("ascii")}],
    }
    try:
        with httpx.Client(timeout=30) as client:
            resp = client.post(
                _RESEND_API,
                headers={"Authorization": f"Bearer {settings.resend_api_key}", "Content-Type": "application/json"},
                json=payload,
            )
        if not resp.is_success:
            logger.error("[EMAIL] 첨부 발송 실패 → %s: %s", _mask_email(to_email), resp.status_code)
        return bool(resp.is_success)
    except Exception as exc:  # noqa: BLE001
        logger.error("[EMAIL] 첨부 발송 예외 → %s: %s", _mask_email(to_email), type(exc).__name__)
        return False


def deliver_share_email(
    event_id: str,
    email: str,
    share_url: str,
    attach_pdf: bool,
    message: str | None,
    sender_name: str,
    db: Any,
) -> str:
    """발송 1건 처리 → "sent" | "failed" | "skipped". 이력 행을 갱신한다(commit 포함)."""
    from app.models.record import Report
    from app.models.report_share_event import ReportShareEvent
    from app.services import report_share_email_template as tpl
    from app.tasks.email import _send_email

    try:
        event = db.query(ReportShareEvent).filter(ReportShareEvent.id == uuid.UUID(str(event_id))).first()
    except ValueError:
        return "skipped"
    if event is None or event.status == "sent" or event.revoked_at is not None:
        return "skipped"

    report = db.query(Report).filter(Report.id == event.report_id).first()
    content = (report.content or {}) if report else {}
    member_report = content.get("member_report") if isinstance(content, dict) else None
    hero = member_report.get("hero") if isinstance(member_report, dict) else None

    pdf: bytes | None = None
    if attach_pdf and isinstance(member_report, dict):
        data = _render_book_pdf(content)
        if data is not None and len(data) <= MAX_ATTACH_BYTES:
            pdf = bytes(data)
        elif data is not None:
            logger.info("[report_share] 책 PDF %dB > 8MB — 링크만 발송", len(data))
    attached = pdf is not None

    mail = tpl.build_share_email(
        sender_name=sender_name,
        share_url=share_url,
        message=message,
        hero=hero if isinstance(hero, dict) else None,
        expires_at=tpl.compute_expires_at(event.created_at),
        attached=attached,
        attach_size_mb=(len(pdf) / (1024 * 1024)) if pdf else None,
    )
    if attached:
        ok = _send_with_attachment(email, mail.subject, mail.text, mail.html, pdf)  # type: ignore[arg-type]
    else:
        ok = bool(_send_email(email, mail.subject, mail.text, mail.html))

    event.attached = attached
    if ok:
        event.status = "sent"
        event.sent_at = datetime.now(timezone.utc)
        event.error_code = None
    else:
        event.status = "failed"
        event.error_code = "send_failed"
    db.commit()
    return "sent" if ok else "failed"


@email_app.task(name="tasks.report_share_email", bind=True)
def report_share_email_task(
    self,
    event_id: str,
    email: str,
    share_url: str,
    attach_pdf: bool,
    message: str | None,
    sender_name: str,
) -> None:
    """공유 메일 1통 발송. 실패하면 백오프 재시도, 마지막 시도에서만 failed 로 확정한다."""
    from app.core.database import SessionLocal
    from app.models.report_share_event import ReportShareEvent

    with SessionLocal() as db:
        final = self.request.retries >= MAX_RETRIES
        result = "failed"
        try:
            result = deliver_share_email(event_id, email, share_url, attach_pdf, message, sender_name, db)
        except Exception:  # noqa: BLE001
            logger.exception("[report_share] 발송 처리 예외: event_id=%s", event_id)
            db.rollback()
            if final:
                event = db.query(ReportShareEvent).filter(ReportShareEvent.id == uuid.UUID(str(event_id))).first()
                if event is not None and event.status != "sent":
                    event.status = "failed"
                    event.error_code = "send_exception"
                    db.commit()
                return
            raise self.retry(countdown=30 * (self.request.retries + 1), max_retries=MAX_RETRIES)
        if result == "failed" and not final:
            # 이번 시도에서 failed 로 기록됐어도 재시도하면 덮어쓴다(중간 상태 노출 허용).
            raise self.retry(countdown=30 * (self.request.retries + 1), max_retries=MAX_RETRIES)
