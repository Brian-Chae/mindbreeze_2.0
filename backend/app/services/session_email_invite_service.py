"""비회원 이메일 초대 (SDD-209 B14 / BE-R4).

- 호스트 전용. 이메일 목록을 받아 형식 검증·중복 제거 후 ``session_email_invites`` 에 **등록**하고,
  Celery ``email_app``(큐 ``email``)에 발송을 **요청**한다. 등록 결과와 발송 요청 결과는 별개 필드다.
- 메일에는 클래스 정보와 **4자리 코드**, ``/join`` 안내가 들어간다. 코드는 URL 에 싣지 않는다.
- 상태는 ``queued``(큐 투입) → ``requested``(Resend 2xx 접수) | ``failed``. **전달·수신 확인이 아니다**
  (웹훅 미수신 — B0 §7-3). 큐에 오래 머무는 건(워커 미기동 의심)은 ``stale`` 로 표시한다.
- 재요청은 같은 행을 갱신하며 쿨다운(``INVITE_EMAIL_COOLDOWN_SEC``)을 둔다.
"""

from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy.orm import Session as DBSession

from app.config import settings
from app.models.session import Session
from app.models.session_email_invite import SessionEmailInvite
from app.models.user import User
from app.services.session_authz import SessionAction, get_session_authorized

logger = logging.getLogger(__name__)

KST = ZoneInfo("Asia/Seoul")
INVITE_EMAIL_COOLDOWN_SEC = 60
# 큐에 이 시간 넘게 머문 건은 워커 미기동/적체로 보고 상담사 화면에 "아직 보내지 못했어요" 로 알린다.
QUEUE_STALE_SEC = 300
MAX_EMAILS_PER_REQUEST = 50
MAX_INVITES_PER_SESSION = 200

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def normalize_email(email: str) -> str:
    return email.strip().casefold()


def is_valid_email(email: str) -> bool:
    return bool(_EMAIL_RE.match(email.strip())) and len(email) <= 320


def enqueue_invite_email(invite_id: str) -> None:
    """email_app 큐(``email``)에 초대 메일 발송을 요청한다. 브로커 장애는 예외로 올라온다."""
    from app.tasks.report_email_task import session_invite_email_task

    session_invite_email_task.apply_async(args=[invite_id], retry=False)


def _is_stale(invite: SessionEmailInvite, now: datetime) -> bool:
    queued_at = _aware(invite.queued_at)
    return (
        invite.status == "queued"
        and queued_at is not None
        and (now - queued_at).total_seconds() > QUEUE_STALE_SEC
    )


def _serialize(invite: SessionEmailInvite, now: datetime) -> dict:
    return {
        "invite_id": str(invite.id),
        "email": invite.email,
        "status": invite.status,
        "stale": _is_stale(invite, now),
        "request_count": invite.request_count,
        "queued_at": invite.queued_at,
        "requested_at": invite.requested_at,
        "pii_scrubbed": invite.pii_scrubbed_at is not None,
    }


def invite_by_email(session_id: str, host_id: str, emails: list[str], db: DBSession) -> dict:
    """이메일 초대 요청. 응답은 주소별로 ``registered``(등록 여부)와 ``request``(발송 요청 결과)를 분리한다."""
    s = get_session_authorized(db, session_id, host_id, SessionAction.EMAIL_INVITE_MANAGE)
    if s.status in ("completed", "cancelled"):
        raise HTTPException(status_code=400, detail="종료된 클래스에는 초대할 수 없어요")
    if s.is_template or not s.access_code:
        raise HTTPException(status_code=409, detail="초대할 수 있는 클래스가 아니에요")
    if not emails:
        raise HTTPException(status_code=422, detail="초대할 이메일을 입력해 주세요")
    if len(emails) > MAX_EMAILS_PER_REQUEST:
        raise HTTPException(status_code=422, detail=f"한 번에 {MAX_EMAILS_PER_REQUEST}명까지 초대할 수 있어요")

    now = _now()
    existing = {
        i.email_norm: i
        for i in db.query(SessionEmailInvite).filter(
            SessionEmailInvite.session_id == s.id, SessionEmailInvite.email_norm.isnot(None)
        )
    }
    total_rows = db.query(SessionEmailInvite).filter(SessionEmailInvite.session_id == s.id).count()

    results: list[dict] = []
    seen: set[str] = set()
    to_enqueue: list[SessionEmailInvite] = []
    for raw in emails:
        email = (raw or "").strip()
        norm = normalize_email(email)
        if not is_valid_email(email):
            results.append({"email": email, "registered": False, "request": "invalid_email", "invite_id": None})
            continue
        if norm in seen:
            results.append({"email": email, "registered": False, "request": "duplicate_in_request", "invite_id": None})
            continue
        seen.add(norm)

        invite = existing.get(norm)
        registered = False
        if invite is None:
            if total_rows >= MAX_INVITES_PER_SESSION:
                results.append({"email": email, "registered": False, "request": "limit_exceeded", "invite_id": None})
                continue
            invite = SessionEmailInvite(
                session_id=s.id, created_by=s.host_id, email=email, email_norm=norm,
                status="queued", request_count=0,
            )
            db.add(invite)
            db.flush()
            registered = True
            total_rows += 1
        else:
            queued_at = _aware(invite.queued_at)
            if invite.status == "queued" and not _is_stale(invite, now):
                results.append(
                    {"email": email, "registered": False, "request": "skipped_pending", "invite_id": str(invite.id)}
                )
                continue
            if queued_at is not None and (now - queued_at).total_seconds() < INVITE_EMAIL_COOLDOWN_SEC:
                results.append(
                    {"email": email, "registered": False, "request": "skipped_cooldown", "invite_id": str(invite.id)}
                )
                continue
        invite.status = "queued"
        invite.last_error = None
        invite.queued_at = now
        invite.request_count = (invite.request_count or 0) + 1
        to_enqueue.append(invite)
        results.append(
            {"email": email, "registered": registered, "request": "queued", "invite_id": str(invite.id)}
        )
    db.commit()

    # 등록(DB)은 커밋됐다. 큐 투입 실패는 등록을 되돌리지 않고 요청 결과로만 노출한다(재요청 가능).
    by_id = {r["invite_id"]: r for r in results if r.get("invite_id")}
    for invite in to_enqueue:
        try:
            enqueue_invite_email(str(invite.id))
        except Exception:  # noqa: BLE001 — 브로커 장애
            logger.exception("[email_invite] 큐 투입 실패: invite_id=%s", invite.id)
            invite.status = "failed"
            invite.last_error = "enqueue_failed"
            invite.queued_at = None
            by_id[str(invite.id)]["request"] = "enqueue_failed"
    db.commit()

    summary: dict[str, int] = {}
    for r in results:
        summary[r["request"]] = summary.get(r["request"], 0) + 1
    return {"session_id": str(s.id), "cooldown_sec": INVITE_EMAIL_COOLDOWN_SEC, "results": results, "summary": summary}


def list_email_invites(session_id: str, host_id: str, db: DBSession) -> dict:
    s = get_session_authorized(db, session_id, host_id, SessionAction.EMAIL_INVITE_MANAGE)
    now = _now()
    rows = (
        db.query(SessionEmailInvite)
        .filter(SessionEmailInvite.session_id == s.id)
        .order_by(SessionEmailInvite.created_at.asc(), SessionEmailInvite.id.asc())
        .all()
    )
    items = [_serialize(r, now) for r in rows]
    return {
        "session_id": str(s.id),
        "invites": items,
        "summary": {
            "total": len(items),
            "requested": sum(1 for i in items if i["status"] == "requested"),
            "failed": sum(1 for i in items if i["status"] == "failed"),
            "stale": sum(1 for i in items if i["stale"]),
        },
    }


def build_invite_mail(session: Session, host_name: str | None, code: str) -> tuple[str, str]:
    """(제목, 본문). 코드는 본문에만 넣고 링크에는 싣지 않는다."""
    when = ""
    if session.scheduled_at is not None:
        dt = _aware(session.scheduled_at).astimezone(KST)
        when = f"{dt.year}년 {dt.month}월 {dt.day}일 {dt.hour:02d}:{dt.minute:02d}"
    title = session.title or "클래스"
    join_url = f"{settings.report_email_base_url.rstrip('/')}/join"
    subject = f"[MIND BREEZE] {title} 에 초대했어요"
    lines = [
        "안녕하세요, MIND BREEZE입니다.",
        "",
        f"{host_name + ' 선생님이' if host_name else '진행자가'} 클래스에 초대했어요.",
        f"- 클래스: {title}",
    ]
    if when:
        lines.append(f"- 시작 시각: {when}")
    lines += [
        "",
        f"입장 코드: {code}",
        "",
        f"아래 주소에서 입장 코드(4자리)를 입력하고 이름·성별·생년월일·이메일을 적으면 입장해요.",
        join_url,
        "",
        "입장 코드는 이 클래스에서만 쓸 수 있어요. 다른 사람에게 알려 주지 마세요.",
        "본인이 요청하지 않았다면 이 메일을 무시해 주세요.",
    ]
    return subject, "\n".join(lines)


def deliver_invite_email(invite_id: str, db: DBSession) -> str:
    """초대 메일 1건을 발송 요청한다(Celery 태스크가 호출). ``sent``(Resend 접수)|``failed``|``skipped``."""
    from app.tasks.email import send_session_invite_email

    invite = db.query(SessionEmailInvite).filter(SessionEmailInvite.id == uuid.UUID(invite_id)).first()
    if invite is None or not invite.email or invite.pii_scrubbed_at is not None:
        return "skipped"
    session = db.query(Session).filter(Session.id == invite.session_id).first()
    if session is None or session.status in ("completed", "cancelled") or not session.access_code:
        invite.status = "failed"
        invite.last_error = "class_closed"
        db.commit()
        return "skipped"
    host = db.query(User).filter(User.id == session.host_id).first()
    subject, body = build_invite_mail(session, host.name if host else None, session.access_code)
    try:
        ok = send_session_invite_email(invite.email, subject, body)
    except Exception:  # noqa: BLE001
        logger.exception("[email_invite] 발송 예외: invite_id=%s", invite.id)
        ok = False
    if not ok:
        invite.status = "failed"
        invite.last_error = "send_failed"
        db.commit()
        return "failed"
    invite.status = "requested"
    invite.requested_at = _now()
    invite.last_error = None
    db.commit()
    return "sent"


def scrub_invite_emails(db: DBSession, *, session_ids: list[uuid.UUID] | None = None, commit: bool = True) -> int:
    """보관 스위프용: 이메일 값을 비운다(행·세션 참조 유지). 스크럽한 행 수를 반환한다."""
    q = db.query(SessionEmailInvite).filter(SessionEmailInvite.pii_scrubbed_at.is_(None))
    if session_ids is not None:
        q = q.filter(SessionEmailInvite.session_id.in_(session_ids))
    rows = q.all()
    now = _now()
    for r in rows:
        r.email = None
        r.email_norm = None
        r.pii_scrubbed_at = now
    if commit:
        db.commit()
    return len(rows)
