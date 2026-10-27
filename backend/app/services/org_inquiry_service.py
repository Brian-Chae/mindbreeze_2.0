"""기관 도입 문의 비즈니스 로직 (SDD-248)

- 접수(DB 저장)가 원본. 운영자 메일은 email_app(Celery) 비동기 — 큐 적재/발송 실패여도 접수는 유지.
- IP 는 Redis rate limit 키에만 쓰고(TTL) DB·메일에는 남기지 않는다.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.config import settings
from app.models.org_inquiry import OrgInquiry
from app.schemas.org_inquiry import OrgInquiryCreate

logger = logging.getLogger(__name__)

RATE_LIMIT_MAX = 5
RATE_LIMIT_WINDOW_SECONDS = 600
KST = ZoneInfo("Asia/Seoul")

ORG_TYPE_LABELS = {
    "counseling_center": "상담센터",
    "meditation_center": "명상센터",
    "education": "교육기관",
    "company": "기업",
    "other": "기타",
}


def _mask_email(email: str) -> str:
    if not email or "@" not in email:
        return "***"
    local, _, domain = email.partition("@")
    return f"{local[:2]}{'*' * max(len(local) - 2, 1)}@{domain}"


def parse_recipients(raw: str) -> list[str]:
    return [r.strip() for r in (raw or "").split(",") if r.strip()]


async def check_rate_limit(client_ip: str | None, redis) -> None:
    """IP당 10분 5건. Redis 장애 시에는 접수를 막지 않는다(fail-open)."""
    key = f"org_inquiry_rl:{client_ip or 'unknown'}"
    try:
        count = await redis.incr(key)
        if count == 1:
            await redis.expire(key, RATE_LIMIT_WINDOW_SECONDS)
    except Exception as exc:  # noqa: BLE001
        logger.warning(f"[ORG_INQUIRY] rate limit 확인 실패(fail-open): {exc}")
        return
    if count > RATE_LIMIT_MAX:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
        )


def create_inquiry(req: OrgInquiryCreate, db: Session) -> OrgInquiry:
    row = OrgInquiry(
        org_name=req.org_name,
        contact_name=req.contact_name,
        email=req.email,
        phone=req.phone,
        org_type=req.org_type,
        expected_users=req.expected_users,
        band_interest=req.band_interest,
        message=(req.message or "").strip() or None,
        status="new",
        notify_status="pending",
        consented_at=datetime.now(timezone.utc),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def enqueue_notice(row: OrgInquiry, db: Session) -> None:
    """운영 알림을 email_app 큐에 적재. 실패해도 예외를 던지지 않는다."""
    from app.tasks.report_email_task import org_inquiry_notice_task

    try:
        org_inquiry_notice_task.apply_async(args=[str(row.id)], retry=False)
        row.notify_status = "queued"
        db.commit()
    except Exception as exc:  # noqa: BLE001 — 브로커 미가동 등
        logger.warning(
            f"[ORG_INQUIRY] 알림 큐 적재 실패 (inquiry={row.id}, email={_mask_email(row.email)}): {exc}"
        )
        try:
            db.rollback()
        except Exception:  # noqa: BLE001
            pass


def deliver_org_inquiry_notice(inquiry_id: str, db: Session) -> str:
    """email_app worker 가 호출 — 실제 발송. 반환: sent | failed."""
    from app.tasks.email import send_org_inquiry_notice

    row = db.query(OrgInquiry).filter(OrgInquiry.id == uuid.UUID(str(inquiry_id))).first()
    if row is None:
        logger.error(f"[ORG_INQUIRY] 알림 대상 문의를 찾을 수 없음: {inquiry_id}")
        return "failed"

    recipients = parse_recipients(settings.org_inquiry_notify_email)
    if not recipients:
        logger.error("[ORG_INQUIRY] ORG_INQUIRY_NOTIFY_EMAIL 이 비어 있음")
        row.notify_status = "failed"
        db.commit()
        return "failed"

    created = row.created_at or datetime.now(timezone.utc)
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    received = created.astimezone(KST).strftime("%Y-%m-%d %H:%M:%S")

    ok = send_org_inquiry_notice(
        recipients=recipients,
        org_name=row.org_name,
        contact_name=row.contact_name,
        email=row.email,
        phone=row.phone,
        org_type_label=ORG_TYPE_LABELS.get(row.org_type or "", "미입력"),
        expected_users=row.expected_users,
        band_interest=row.band_interest,
        message=row.message,
        received_at_kst=received,
        inquiry_id=str(row.id),
    )
    row.notify_status = "sent" if ok else "failed"
    if ok:
        row.notified_at = datetime.now(timezone.utc)
    db.commit()
    return "sent" if ok else "failed"
