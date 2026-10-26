"""플랫폼 관리자 채팅 신고 처리 — [MB261026][FIX] D4 + Apple 1.2.

- 목록·상세·상태 전이, 금칙어 관리. 호출 권한은 라우터(require_platform_admin)가 막는다.
- 처리 기한: 접수 확인 2영업일 · 1차 판단 5영업일(business_days). 조회 시 계산하고 저장하지 않는다.
- 최소 열람: 목록에는 메시지 발췌·이메일을 싣지 않는다. 발췌는 상세에서만, 신고된 메시지 1건만.
- 감사: 열람·전이·금칙어 변경을 verification_audits 에 남긴다. 감사 행에 발췌 내용은 넣지 않는다.
  처리 이력 순서를 고정하려고 감사 created_at 을 서버 기본값 대신 직접 넣는다(SQLite now() 는 초 단위).
- 상태 전이는 기록일 뿐이다. 메시지 삭제·계정 정지·차단을 자동으로 하지 않는다.
"""

import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DBSession

from app.config import settings
from app.models.chat import ChatFilterTerm, ChatReport, ChatRoom
from app.models.credential import VerificationAudit
from app.models.user import User
from app.services import chat_content_filter
from app.services.business_days import parse_holidays, report_deadlines
from app.services.chat_moderation_service import display_user_name

REPORT_STATUSES = ("submitted", "reviewing", "actioned", "dismissed", "withdrawn")
OPEN_STATUSES = ("submitted", "reviewing")
CLOSED_STATUSES = ("actioned", "dismissed")
ALLOWED_TRANSITIONS = {
    "submitted": {"reviewing", "actioned", "dismissed"},
    "reviewing": {"actioned", "dismissed"},
}
AUDIT_TARGET_REPORT = "chat_report"
AUDIT_TARGET_TERM = "chat_filter_term"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime | None) -> datetime | None:
    # SQLite 는 시간대 없는 UTC 값을 돌려준다.
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _parse_id(value: str, message: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except ValueError:
        raise HTTPException(status_code=404, detail=message)


def _conflict(code: str, message: str) -> HTTPException:
    return HTTPException(status_code=409, detail={"code": code, "message": message})


def notice_email_configured() -> bool:
    return bool((settings.moderation_notice_email or "").strip())


# ── 직렬화 ──


def _users(db: DBSession, ids: set) -> dict[uuid.UUID, User]:
    ids = {i for i in ids if i is not None}
    if not ids:
        return {}
    return {u.id: u for u in db.query(User).filter(User.id.in_(ids)).all()}


def _person(user: User | None, user_id, *, with_email: bool) -> dict:
    person = {
        "id": str(user_id) if user_id else None,
        "name": display_user_name(user.name, user.status) if user else None,
    }
    if with_email:
        # 탈퇴 사용자는 이메일을 보여 주지 않는다.
        person["email"] = user.email if user and user.status != "deleted" else None
    return person


def _deadline_fields(report: ChatReport, now: datetime, holidays) -> dict:
    created = _aware(report.created_at) or now
    ack_due, decision_due = report_deadlines(created, holidays)
    is_open = report.status in OPEN_STATUSES
    return {
        "ack_due_at": ack_due,
        "decision_due_at": decision_due,
        "ack_overdue": is_open and report.acknowledged_at is None and now > ack_due,
        "decision_overdue": is_open and report.decided_at is None and now > decision_due,
    }


def _item(report: ChatReport, users: dict, room_types: dict, now: datetime, holidays, *, with_email: bool) -> dict:
    handler = users.get(report.handled_by) if report.handled_by else None
    return {
        "id": str(report.id),
        "status": report.status,
        "reason": report.reason,
        "created_at": _aware(report.created_at),
        "reporter": _person(users.get(report.reporter_id), report.reporter_id, with_email=with_email),
        "reported_user": _person(users.get(report.reported_user_id), report.reported_user_id, with_email=with_email),
        "room_type": room_types.get(report.room_id) if report.room_id else None,
        "has_message": report.message_id is not None,
        "acknowledged_at": _aware(report.acknowledged_at),
        "decided_at": _aware(report.decided_at),
        "withdrawn_at": _aware(report.withdrawn_at),
        "handled_by_name": handler.name if handler else None,
        **_deadline_fields(report, now, holidays),
    }


def _room_types(db: DBSession, room_ids: set) -> dict:
    room_ids = {r for r in room_ids if r is not None}
    if not room_ids:
        return {}
    return {rid: rtype for rid, rtype in db.query(ChatRoom.id, ChatRoom.room_type).filter(ChatRoom.id.in_(room_ids)).all()}


def _history(report_id: uuid.UUID, db: DBSession) -> list[dict]:
    rows = (
        db.query(VerificationAudit)
        .filter(
            VerificationAudit.target_type == AUDIT_TARGET_REPORT,
            VerificationAudit.target_id == report_id,
            VerificationAudit.action == "chat_report_transition",
        )
        .order_by(VerificationAudit.created_at, VerificationAudit.id)
        .all()
    )
    admins = _users(db, {r.admin_id for r in rows})
    result = []
    for r in rows:
        extra = r.extra or {}
        admin = admins.get(r.admin_id)
        result.append(
            {
                "from_status": extra.get("from"),
                "to_status": extra.get("to"),
                "note": r.reason,
                "admin_name": admin.name if admin else None,
                "at": _aware(r.created_at),
            }
        )
    return result


def _detail_payload(report: ChatReport, db: DBSession, *, sensitive: bool) -> dict:
    """sensitive=True(상세 열람)일 때만 발췌·이메일·방/메시지 ID 를 싣는다. 전이 응답은 False."""
    users = _users(db, {report.reporter_id, report.reported_user_id, report.handled_by})
    payload = _item(
        report,
        users,
        _room_types(db, {report.room_id}),
        _now(),
        parse_holidays(settings.moderation_holidays),
        with_email=sensitive,
    )
    payload.update({"resolution_note": report.resolution_note, "history": _history(report.id, db)})
    if sensitive:
        payload.update(
            {
                "room_id": str(report.room_id) if report.room_id else None,
                "message_id": str(report.message_id) if report.message_id else None,
                "message_excerpt": report.message_excerpt,
            }
        )
    return payload


# ── 신고 목록·상세·전이 ──


def list_reports(
    db: DBSession,
    admin_id: uuid.UUID,
    *,
    status: str | None,
    overdue: bool,
    page: int,
    size: int,
) -> dict[str, Any]:
    now = _now()
    holidays = parse_holidays(settings.moderation_holidays)
    query = db.query(ChatReport)
    if status:
        query = query.filter(ChatReport.status == status)
    ordered = query.order_by(ChatReport.created_at.desc(), ChatReport.id.desc())

    if overdue:
        # 기한은 조회 시 계산하므로 미종결 건만 가져와 파이썬에서 거른다(운영 규모에서 충분히 작다).
        candidates = ordered.filter(ChatReport.status.in_(OPEN_STATUSES)).all()
        matched = []
        for r in candidates:
            fields = _deadline_fields(r, now, holidays)
            if fields["ack_overdue"] or fields["decision_overdue"]:
                matched.append(r)
        total = len(matched)
        rows = matched[(page - 1) * size : page * size]
    else:
        total = query.count()
        rows = ordered.offset((page - 1) * size).limit(size).all()

    users = _users(db, {u for r in rows for u in (r.reporter_id, r.reported_user_id, r.handled_by)})
    room_types = _room_types(db, {r.room_id for r in rows})
    items = [_item(r, users, room_types, now, holidays, with_email=False) for r in rows]

    counts = {s: 0 for s in REPORT_STATUSES}
    for s, n in db.query(ChatReport.status, func.count(ChatReport.id)).group_by(ChatReport.status).all():
        if s in counts:
            counts[s] = n

    db.add(
        VerificationAudit(
            created_at=_now(),
            target_type=AUDIT_TARGET_REPORT,
            target_id=None,
            admin_id=admin_id,
            action="chat_report_list",
            extra={"status": status, "overdue": overdue, "page": page, "size": size, "count": len(items)},
        )
    )
    db.commit()
    return {
        "items": items,
        "total": total,
        "page": page,
        "size": size,
        "counts": counts,
        "notice_email_configured": notice_email_configured(),
    }


def get_report_detail(report_id: str, admin_id: uuid.UUID, db: DBSession) -> dict[str, Any]:
    rid = _parse_id(report_id, "신고를 찾을 수 없습니다")
    report = db.query(ChatReport).filter(ChatReport.id == rid).first()
    if report is None:
        raise HTTPException(status_code=404, detail="신고를 찾을 수 없습니다")
    payload = _detail_payload(report, db, sensitive=True)
    db.add(
        VerificationAudit(
            created_at=_now(),
            target_type=AUDIT_TARGET_REPORT,
            target_id=report.id,
            admin_id=admin_id,
            action="chat_report_view",
        )
    )
    db.commit()
    return payload


def transition_report(report_id: str, to: str, note: str | None, admin_id: uuid.UUID, db: DBSession) -> dict[str, Any]:
    rid = _parse_id(report_id, "신고를 찾을 수 없습니다")
    # 신고자 철회(withdraw_report)와 동시에 와도 한쪽만 이기도록 행을 잠근다.
    report = db.query(ChatReport).filter(ChatReport.id == rid).with_for_update().first()
    if report is None:
        raise HTTPException(status_code=404, detail="신고를 찾을 수 없습니다")
    if report.status == "withdrawn":
        raise _conflict("REPORT_WITHDRAWN", "신고자가 철회한 신고입니다")
    if report.status in CLOSED_STATUSES:
        raise _conflict("REPORT_CLOSED", "이미 판단이 끝난 신고입니다")
    if to == report.status:
        return _detail_payload(report, db, sensitive=False)  # 멱등 — 변화·감사 없음
    if to not in ALLOWED_TRANSITIONS.get(report.status, set()):
        raise _conflict("INVALID_REPORT_TRANSITION", "이 상태로 바꿀 수 없습니다")
    clean_note = (note or "").strip()
    if to in CLOSED_STATUSES and not clean_note:
        raise HTTPException(
            status_code=422,
            detail={"code": "RESOLUTION_NOTE_REQUIRED", "message": "판단 내용을 메모로 남겨 주세요"},
        )

    now = _now()
    previous = report.status
    if report.acknowledged_at is None:
        report.acknowledged_at = now
    if to in CLOSED_STATUSES:
        report.decided_at = now
        report.resolution_note = clean_note
    report.handled_by = admin_id
    report.status = to
    db.add(
        VerificationAudit(
            created_at=now,
            target_type=AUDIT_TARGET_REPORT,
            target_id=report.id,
            admin_id=admin_id,
            action="chat_report_transition",
            reason=clean_note or None,
            extra={"from": previous, "to": to},
        )
    )
    db.commit()
    # 전이 응답에는 발췌·이메일을 싣지 않는다 — 열람은 상세 조회(감사 1행)로만 일어난다.
    db.refresh(report)
    return _detail_payload(report, db, sensitive=False)


# ── 금칙어 ──


def _term_payload(term: ChatFilterTerm, users: dict) -> dict:
    creator = users.get(term.created_by) if term.created_by else None
    return {
        "id": str(term.id),
        "term": term.term,
        "created_at": _aware(term.created_at),
        "created_by_name": creator.name if creator else None,
    }


def list_terms(db: DBSession) -> list[dict]:
    terms = db.query(ChatFilterTerm).order_by(ChatFilterTerm.created_at.desc(), ChatFilterTerm.term).all()
    users = _users(db, {t.created_by for t in terms})
    return [_term_payload(t, users) for t in terms]


def add_term(term: str, admin_id: uuid.UUID, db: DBSession) -> dict:
    display = (term or "").strip()
    normalized = chat_content_filter.normalize(display)
    if not (chat_content_filter.MIN_TERM_LENGTH <= len(normalized) <= chat_content_filter.MAX_TERM_LENGTH):
        raise HTTPException(
            status_code=422,
            detail={
                "code": "CHAT_FILTER_TERM_INVALID",
                "message": (
                    f"금칙어는 공백·기호를 뺀 {chat_content_filter.MIN_TERM_LENGTH}~"
                    f"{chat_content_filter.MAX_TERM_LENGTH}자여야 합니다"
                ),
            },
        )
    exists = _conflict("CHAT_FILTER_TERM_EXISTS", "이미 등록된 단어입니다")
    if db.query(ChatFilterTerm.id).filter(ChatFilterTerm.normalized_term == normalized).first() is not None:
        raise exists
    if db.query(ChatFilterTerm).count() >= chat_content_filter.MAX_TERMS:
        raise _conflict("CHAT_FILTER_TERM_LIMIT", f"금칙어는 최대 {chat_content_filter.MAX_TERMS}개까지 등록할 수 있습니다")
    row = ChatFilterTerm(term=display, normalized_term=normalized, created_by=admin_id)
    try:
        db.add(row)
        db.flush()
        db.add(
            VerificationAudit(
                created_at=_now(),
                target_type=AUDIT_TARGET_TERM,
                target_id=row.id,
                admin_id=admin_id,
                action="chat_filter_term_add",
                extra={"term": display},
            )
        )
        db.commit()
    except IntegrityError:
        db.rollback()
        raise exists
    db.refresh(row)
    return _term_payload(row, _users(db, {row.created_by}))


def remove_term(term_id: str, admin_id: uuid.UUID, db: DBSession) -> None:
    tid = _parse_id(term_id, "금칙어를 찾을 수 없습니다")
    row = db.query(ChatFilterTerm).filter(ChatFilterTerm.id == tid).first()
    if row is None:
        raise HTTPException(status_code=404, detail="금칙어를 찾을 수 없습니다")
    db.add(
        VerificationAudit(
            created_at=_now(),
            target_type=AUDIT_TARGET_TERM,
            target_id=row.id,
            admin_id=admin_id,
            action="chat_filter_term_remove",
            extra={"term": row.term},
        )
    )
    db.delete(row)
    db.commit()
