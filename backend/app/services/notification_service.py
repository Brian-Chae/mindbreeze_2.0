"""알림 서비스 — 인앱 + 이메일 라우팅"""

import logging
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session as DBSession

from app.models.notification import Notification
from app.models.user import User, DEFAULT_NOTIFICATION_PREFERENCES
from app.tasks.email import _send_email

logger = logging.getLogger(__name__)


# 표준 딥링크 대상 유형 (프론트 라우트 화이트리스트와 1:1 대응)
STANDARD_TARGET_TYPES: frozenset[str] = frozenset(
    {"chat_room", "report", "session", "credentials", "self_profile", "organization", "notice"}
)

# 이벤트 카탈로그 — event_type → (화면 분류 type, 딥링크 대상 target_type)
# 기획서 docs/notification-system/01-backend-기획.md §4 이벤트 카탈로그 기반.
EVENT_CATALOG: dict[str, dict[str, str]] = {
    # ── 세션 S01~S13 ──
    "session_booked": {"type": "session", "target_type": "session"},
    "session_updated": {"type": "session", "target_type": "session"},
    "session_cancelled": {"type": "session", "target_type": "session"},
    "session_ready": {"type": "session", "target_type": "session"},
    "session_opened": {"type": "session", "target_type": "session"},
    "session_started": {"type": "session", "target_type": "session"},
    "session_completed": {"type": "session", "target_type": "session"},
    "session_invited": {"type": "session", "target_type": "session"},
    "session_waitlist_promoted": {"type": "session", "target_type": "session"},
    "session_participant_removed": {"type": "session", "target_type": "notice"},
    "session_deleted": {"type": "session", "target_type": "notice"},
    # ── 채팅 C01~C05 ──
    "chat_message": {"type": "chat", "target_type": "chat_room"},
    "chat_room_created": {"type": "chat", "target_type": "chat_room"},
    "chat_room_invited": {"type": "chat", "target_type": "chat_room"},
    "chat_room_removed": {"type": "chat", "target_type": "notice"},
    # ── 리포트 R01~R04 ──
    "report_review_requested": {"type": "report", "target_type": "report"},
    "report_ready": {"type": "report", "target_type": "report"},
    "report_generation_failed": {"type": "report", "target_type": "report"},
    "report_low_confidence": {"type": "report", "target_type": "session"},
    "report_email_failed": {"type": "report", "target_type": "report"},
    # ── 검증 V01~V03 ──
    "verification_result": {"type": "verification", "target_type": "credentials"},
    "organization_verification_result": {"type": "verification", "target_type": "organization"},
    "verification_requested": {"type": "verification", "target_type": "credentials"},
    # ── 기관 O01~O06 ──
    "organization_join_requested": {"type": "organization", "target_type": "organization"},
    "organization_join_result": {"type": "organization", "target_type": "notice"},
    "organization_updated": {"type": "organization", "target_type": "organization"},
    "organization_deactivated": {"type": "organization", "target_type": "notice"},
    "organization_reactivated": {"type": "organization", "target_type": "notice"},
    "organization_role_changed": {"type": "organization", "target_type": "self_profile"},
    "organization_removed": {"type": "organization", "target_type": "notice"},
    # ── 계정 A01~A03 ──
    "counselor_profile_updated": {"type": "system", "target_type": "self_profile"},
    "primary_admin_profile_updated": {"type": "system", "target_type": "self_profile"},
    "account_suspended": {"type": "system", "target_type": "notice"},
    "account_reactivated": {"type": "system", "target_type": "notice"},
    # ── 개인상담소 P01 ──
    "personal_office_opened": {"type": "organization", "target_type": "self_profile"},
}

# 하위 호환: 이전 이벤트→type 매핑 (기존 호출부가 참조하던 이름)
EVENT_TO_NOTIF_TYPE: dict[str, str] = {
    event: meta["type"] for event, meta in EVENT_CATALOG.items()
}


def build_standard_extra(
    event_type: str,
    target_type: str,
    target_id: str | None,
    params: dict[str, Any] | None = None,
    legacy: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """표준 딥링크 payload(extra) 생성.

    기존 루트 키(room_id/report_id 등)는 `legacy`로 넘겨 호환 기간 유지한다.
    """
    extra: dict[str, Any] = {
        "schema_version": 1,
        "event_type": event_type,
        "target_type": target_type,
        "target_id": target_id,
        "params": params or {},
    }
    if legacy:
        extra.update(legacy)
    return extra



def _to_uuid(value: str | UUID) -> UUID:
    try:
        return value if isinstance(value, UUID) else UUID(str(value))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="잘못된 ID 형식입니다")


def _get_pref_event_key(event_type: str) -> str:
    # NOTIF-04: session_updated → session_booked 치환을 제거한다.
    #   프론트가 저장한 session_updated 설정을 그대로 읽어야 토글이 실제 발송에 반영된다
    #   (치환하면 session_updated 를 꺼도 session_booked 기본값 True 를 읽어 무효화된다).
    return event_type


def get_user_preferences(user: User) -> dict[str, dict[str, bool]]:
    prefs = user.notification_preferences
    if not isinstance(prefs, dict):
        return {
            "email": dict(DEFAULT_NOTIFICATION_PREFERENCES["email"]),
            "in_app": dict(DEFAULT_NOTIFICATION_PREFERENCES["in_app"]),
        }
    return {
        "email": {**DEFAULT_NOTIFICATION_PREFERENCES["email"], **(prefs.get("email") or {})},
        "in_app": {**DEFAULT_NOTIFICATION_PREFERENCES["in_app"], **(prefs.get("in_app") or {})},
    }


def create_notification(
    user_id: str | UUID,
    notif_type: str,
    title: str,
    body: str | None,
    db: DBSession,
    extra: dict[str, Any] | None = None,
) -> Notification:
    notif = Notification(
        user_id=_to_uuid(user_id),
        type=notif_type,
        title=title,
        body=body,
        extra=extra,
    )
    db.add(notif)
    db.flush()
    return notif


def send_email_notification(
    to_email: str, subject: str, body: str, body_html: str | None = None
) -> bool:
    """알림 이메일 발송. body_html 이 있으면 HTML 본문을 함께 전달한다.

    FUNC-07: 리마인더 등 outbox payload['html'] 계약을 실제 발송까지 전달한다.
    """
    for attempt in range(3):
        try:
            ok = _send_email(to_email, subject, body, body_html)
            if ok:
                return True
        except Exception as e:  # noqa: BLE001
            logger.warning(f"[NOTIF EMAIL] 발송 실패 (시도 {attempt + 1}/3): {e}")
    logger.error(f"[NOTIF EMAIL] 최종 실패 → {to_email}")
    return False


def _build_email_content(event_type: str, data: dict[str, Any]) -> tuple[str, str, str]:
    """(notif_type, subject, body) 반환"""
    title = data.get("title", "")
    body = data.get("body", "")
    notif_type = EVENT_TO_NOTIF_TYPE.get(event_type, "system")
    subject = f"[MIND BREEZE] {title}" if title else "[MIND BREEZE] 알림"
    return notif_type, subject, body


def enqueue_outbox(
    db: DBSession,
    *,
    user_id: str | UUID,
    channel: str,
    payload: dict[str, Any],
    notification_id: str | UUID | None = None,
    recipient: str | None = None,
) -> None:
    """트랜잭셔널 outbox에 전달 이벤트 기록. 실제 WS·이메일 전달은 워커가 처리."""
    from app.models.notification_outbox import NotificationOutbox

    db.add(NotificationOutbox(
        user_id=_to_uuid(user_id),
        channel=channel,
        payload=payload,
        notification_id=_to_uuid(notification_id) if notification_id else None,
        recipient=recipient,
        status="pending",
        attempts=0,
    ))


def notify_event(
    event_type: str,
    user_id: str | UUID,
    data: dict[str, Any],
    db: DBSession,
    *,
    commit: bool = True,
) -> Notification | None:
    """이벤트 → 인앱 알림 + (설정 시) 이메일 발송

    TXN-01: commit=False 면 알림·outbox 를 flush 만 하고 커밋은 호출자에게 맡긴다.
    상위 흐름이 아직 확정하지 않은 변경을 조기 커밋하는 것을 막는다.
    (commit=False 호출자는 커밋 후 outbox beat 가 이메일을 발송하도록 남겨둔다.)
    """
    user = db.query(User).filter(User.id == _to_uuid(user_id)).first()
    if not user:
        return None

    prefs = get_user_preferences(user)
    pref_key = _get_pref_event_key(event_type)
    notif_type, subject, body_text = _build_email_content(event_type, data)
    title = data.get("title", "")
    body_message = data.get("body", "")
    extra = data.get("extra")

    # 표준 딥링크 필드 정규화 — 레거시 발화 지점이 루트 키(room_id 등)만 넘겨도
    # event_type/target_type/schema_version을 보완해 프론트 딥링크가 동작하도록 보장.
    if isinstance(extra, dict):
        meta = EVENT_CATALOG.get(event_type, {})
        extra.setdefault("event_type", event_type)
        if meta.get("target_type"):
            extra.setdefault("target_type", meta["target_type"])
        extra.setdefault("schema_version", 1)

    notif: Notification | None = None
    if prefs["in_app"].get(pref_key, True):
        notif = create_notification(user.id, notif_type, title, body_message, db, extra=extra)
        # 트랜잭셔널 outbox: WS 실시간 전달을 이벤트로 기록 (워커가 처리)
        enqueue_outbox(
            db,
            user_id=user.id,
            channel="ws",
            notification_id=notif.id,
            payload={
                "id": str(notif.id),
                "type": notif_type,
                "title": title,
                "body": body_message,
                "extra": extra,
            },
        )

    if prefs["email"].get(pref_key, False) and user.email:
        from app.models.notification_outbox import NotificationOutbox

        email_item = NotificationOutbox(
            user_id=user.id,
            channel="email",
            recipient=user.email,
            payload={"subject": subject, "body": body_text or body_message or title},
        )
        db.add(email_item)
        db.flush()  # outbox 행을 같은 트랜잭션에 확정

    if commit:
        db.commit()  # 알림 + outbox 이벤트를 원자적으로 확정
    else:
        # TXN-01: 호출자가 트랜잭션을 소유 — 조기 커밋 대신 flush 만.
        db.flush()

    # OUTBOX-DUP-003: 이메일 채널은 여기서 직접 큐 적재하지 않는다.
    #   과거엔 email_app 큐에 바로 넣는 동시에 beat/cron 의 process_email_outbox 가
    #   같은 pending 행을 집어 이중 발송됐다. 단일 소비자(process_email_outbox, 행
    #   선점 잠금)만 이메일 outbox 를 처리하도록 일원화한다.
    return notif


def list_notifications(
    user_id: str,
    db: DBSession,
    only_unread: bool = False,
    limit: int = 50,
    offset: int = 0,
    type: str | None = None,
    event: str | None = None,
) -> dict[str, Any]:
    uid = _to_uuid(user_id)
    base = db.query(Notification).filter(Notification.user_id == uid)
    if only_unread:
        base = base.filter(Notification.is_read.is_(False))
    if type:
        base = base.filter(Notification.type == type)
    if event:
        base = base.filter(Notification.extra["event_type"].astext == event)
    total = base.count()
    items = base.order_by(Notification.created_at.desc()).offset(offset).limit(limit).all()
    unread = (
        db.query(Notification)
        .filter(Notification.user_id == uid, Notification.is_read.is_(False))
        .count()
    )
    return {
        "notifications": [
            {
                "id": str(n.id),
                "type": n.type,
                "title": n.title,
                "body": n.body,
                "is_read": bool(n.is_read),
                "extra": n.extra,
                "created_at": n.created_at,
            }
            for n in items
        ],
        "total": total,
        "unread": unread,
    }


def unread_count(user_id: str, db: DBSession) -> int:
    uid = _to_uuid(user_id)
    return (
        db.query(Notification)
        .filter(Notification.user_id == uid, Notification.is_read.is_(False))
        .count()
    )


def mark_read(notification_id: str, user_id: str, db: DBSession) -> None:
    nid = _to_uuid(notification_id)
    uid = _to_uuid(user_id)
    notif = db.query(Notification).filter(Notification.id == nid).first()
    if not notif:
        raise HTTPException(status_code=404, detail="알림을 찾을 수 없습니다")
    if notif.user_id != uid:
        raise HTTPException(status_code=403, detail="접근 권한이 없습니다")
    notif.is_read = True
    notif.read_at = datetime.now(timezone.utc)
    db.commit()


def mark_all_read(user_id: str, db: DBSession) -> int:
    uid = _to_uuid(user_id)
    items = (
        db.query(Notification)
        .filter(Notification.user_id == uid, Notification.is_read.is_(False))
        .all()
    )
    count = 0
    for n in items:
        n.is_read = True
        n.read_at = datetime.now(timezone.utc)
        count += 1
    db.commit()
    return count


def get_preferences(user_id: str, db: DBSession) -> dict[str, dict[str, bool]]:
    uid = _to_uuid(user_id)
    user = db.query(User).filter(User.id == uid).first()
    if not user:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")
    return get_user_preferences(user)


def update_preferences(
    user_id: str,
    email_prefs: dict[str, bool],
    in_app_prefs: dict[str, bool],
    db: DBSession,
) -> dict[str, dict[str, bool]]:
    uid = _to_uuid(user_id)
    user = db.query(User).filter(User.id == uid).first()
    if not user:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")
    # NOTIF-CONF-08: 임의 event key 저장 금지 — 이벤트 카탈로그(EVENT_CATALOG)에 존재하는
    #   키만 허용한다. 화이트리스트 없이 저장하면 임의 키가 영속화되고, 오타/미지원 키가
    #   조용히 누적돼 실제 이벤트 설정을 우회한다.
    unknown = sorted((set(email_prefs) | set(in_app_prefs)) - set(EVENT_CATALOG))
    if unknown:
        raise HTTPException(
            status_code=422,
            detail=f"지원하지 않는 알림 이벤트입니다: {', '.join(unknown)}",
        )
    # 기존 저장값을 보존한 뒤 제출 키만 덮어쓴다 (미제출 event key는 리셋 금지)
    current = get_user_preferences(user)
    user.notification_preferences = {
        "email": {**current["email"], **email_prefs},
        "in_app": {**current["in_app"], **in_app_prefs},
    }
    db.commit()
    db.refresh(user)
    return get_user_preferences(user)
