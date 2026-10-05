"""SDD-097: 예약 클래스 사전 안내(리마인더) 서비스.

클래스 생성 후 참여코드·준비물·시작시간을 상담사가 수동으로 공지하고 회원이 잊던
문제를 해결한다. 예약 클래스(scheduled_at 존재)에 대해 시작 N분 전 시점 목록
(reminder_offsets)을 저장해 두고, Celery ETA 태스크로 T-24h/T-1h 등에 자동 발송한다.

발송 채널:
- 인앱 알림(Notification) + 실시간 웹푸시(WS outbox → Socket.IO new_notification)
- 이메일(outbox → Resend, 기존 notification_email_task 재사용)

중복 방지: session_reminder_logs 에 (session_id, offset_min, user_id, channel) 로 기록하고
이미 발송된 조합은 건너뛴다. 워커 재시도·스윕 폴백이 겹쳐도 1회만 발송된다.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from html import escape
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DBSession

from app.config import settings
from app.models.notification import Notification  # noqa: F401  (relationship 등록)
from app.models.session import Session, SessionParticipant, SessionReminderLog
from app.models.user import User

logger = logging.getLogger(__name__)

KST = ZoneInfo("Asia/Seoul")

# 리마인더 시점 허용 범위(분) — 5분 ~ 14일. 0/음수(이미 시작)는 무의미하므로 제외한다.
MIN_OFFSET_MIN = 5
MAX_OFFSET_MIN = 60 * 24 * 14
# 한 클래스에 붙일 수 있는 시점 개수 상한(폭주 방지).
MAX_OFFSETS = 5
# ETA 태스크가 예정 시각보다 아주 약간 일찍 깨어나도 발송하도록 두는 허용 오차(초).
# 이보다 이르면 "아직 발송 시점이 아님"으로 보고 건너뛴다(FUNC-01).
REMINDER_DUE_TOLERANCE_SEC = 60

# 사전 안내에 항상 포함하는 브라우저 안내 — LINK BAND/실시간 연결 제약.
BROWSER_GUIDE = (
    "Chrome 또는 Edge 를 권장합니다(Web Bluetooth·실시간 연결).\n"
    "Safari·Firefox 는 LINK BAND 연동을 지원하지 않습니다."
)


def _to_uuid(value: str | UUID) -> UUID:
    return value if isinstance(value, UUID) else UUID(str(value))


def _ensure_aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def normalize_reminder_offsets(raw: object) -> list[int]:
    """리마인더 시점 목록 정규화 — 정수화·범위 필터·중복 제거·긴 간격 우선 정렬.

    값이 잘못돼도 예외를 던지지 않고 조용히 걸러낸다(생성 자체를 막지 않는다).
    """
    if raw is None:
        return []
    if not isinstance(raw, list):
        return []
    cleaned: set[int] = set()
    for item in raw:
        try:
            minutes = int(item)
        except (TypeError, ValueError):
            continue
        if MIN_OFFSET_MIN <= minutes <= MAX_OFFSET_MIN:
            cleaned.add(minutes)
    return sorted(cleaned, reverse=True)[:MAX_OFFSETS]


def format_offset_label(offset_min: int) -> str:
    """N분 전 → 사람이 읽는 라벨(예: 하루 전, 1시간 전, 30분 전)."""
    if offset_min % (60 * 24) == 0:
        days = offset_min // (60 * 24)
        return "하루 전" if days == 1 else f"{days}일 전"
    if offset_min % 60 == 0:
        return f"{offset_min // 60}시간 전"
    return f"{offset_min}분 전"


def _session_type_label(session: Session) -> str:
    labels = {
        "clinical": "임상심리상담",
        "hypnosis": "최면심리상담",
        "meditation": "명상수업",
    }
    if session.type == "custom":
        return session.custom_type_name or "클래스"
    return labels.get(session.type, "클래스")


def _format_scheduled_at(session: Session) -> str:
    if not session.scheduled_at:
        return "일정 미정"
    dt = _ensure_aware(session.scheduled_at).astimezone(KST)
    weekday = "월화수목금토일"[dt.weekday()]
    return f"{dt.year}년 {dt.month}월 {dt.day}일({weekday}) {dt.hour:02d}:{dt.minute:02d}"


def _prepare_lines(session: Session) -> list[str]:
    """입장 전 준비물 안내 — 조용한 공간·헤드셋·(선택) LINK BAND."""
    lines = [
        "· 조용하고 안정된 공간 (Wi-Fi가 안정적인 곳)",
        "· 헤드셋(마이크 포함) 권장 — 안내 음성과 상담을 또렷하게 듣기 위해",
    ]
    if session.linkband_mode == "required":
        lines.append(
            "· LINK BAND (필수): 미리 착용하고 전원을 켜 주세요. 연결은 클래스 입장 후 안내됩니다."
        )
    elif session.linkband_mode == "optional":
        lines.append(
            "· LINK BAND (선택): 착용하면 뇌파 기반 이완·집중 지표가 리포트에 함께 담깁니다. "
            "미착용해도 상담·AI 요약은 그대로 진행됩니다."
        )
    else:
        lines.append("· LINK BAND: 이번 클래스는 사용하지 않습니다.")
    return lines


def build_reminder_message(session: Session, offset_min: int) -> dict[str, str]:
    """리마인더 메일/알림 본문 생성 — 참여코드·준비물·브라우저 안내를 담는다.

    반환: {"subject": str, "body_text": str, "body_html": str, "title": str}
    """
    label = format_offset_label(offset_min)
    title = session.title or _session_type_label(session)
    code = session.access_code or "------"
    join_url = f"{settings.frontend_base_url.rstrip('/')}/join"
    when = _format_scheduled_at(session)
    prepare = "\n".join(_prepare_lines(session))

    subject = f"[MIND BREEZE] {title} 클래스 안내 ({label})"
    body_text = (
        f"안녕하세요, MIND BREEZE입니다.\n\n"
        f"예약하신 클래스가 {label} 남았습니다.\n\n"
        f"· 클래스: {title} ({_session_type_label(session)})\n"
        f"· 일시: {when} (약 {session.duration_min}분)\n"
        f"· 참여코드: {code}\n\n"
        f"[입장 전 준비물]\n{prepare}\n\n"
        f"[브라우저 안내]\n{BROWSER_GUIDE}\n\n"
        f"시간에 맞춰 {join_url} 에서 참여코드를 입력하고 입장해 주세요.\n\n"
        f"감사합니다.\nMIND BREEZE 드림"
    )
    rows = "".join(
        f"<li style=\"margin-bottom:6px;\">{escape(line.lstrip('· '))}</li>"
        for line in _prepare_lines(session)
    )
    body_html = (
        "<div style=\"font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo',sans-serif;"
        "color:#1F1630;line-height:1.7;\">"
        f"<p>예약하신 클래스가 <strong>{escape(label)}</strong> 남았습니다.</p>"
        f"<p style=\"padding:16px;background:#F5EDFC;border-radius:12px;\">"
        f"<strong>· 클래스:</strong> {escape(title)} ({escape(_session_type_label(session))})<br>"
        f"<strong>· 일시:</strong> {escape(when)} (약 {session.duration_min}분)<br>"
        f"<strong>· 참여코드:</strong> "
        f"<span style=\"font-family:monospace;font-size:20px;font-weight:800;color:#5F0080;\">"
        f"{escape(code)}</span></p>"
        f"<p><strong>[입장 전 준비물]</strong></p><ul style=\"padding-left:18px;color:#4A3B5F;\">{rows}</ul>"
        "<p><strong>[브라우저 안내]</strong><br>"
        "Chrome 또는 Edge 를 권장합니다(Web Bluetooth·실시간 연결).<br>"
        "Safari·Firefox 는 LINK BAND 연동을 지원하지 않습니다.</p>"
        f"<p><a href=\"{escape(join_url, quote=True)}\" "
        "style=\"display:inline-block;background:#5F0080;color:#fff;text-decoration:none;"
        "padding:12px 24px;border-radius:999px;font-weight:700;\">클래스 입장하기</a></p>"
        "</div>"
    )
    return {"subject": subject, "body_text": body_text, "body_html": body_html, "title": title}


def reminder_recipients(session: Session, db: DBSession) -> list[dict]:
    """리마인더 수신 회원 목록 — 로그인 회원(user_id 보유) & 대기자 제외.

    게스트(비회원)는 계정이 없으므로 이메일·인앱 알림 대상이 아니다.
    """
    rows = (
        db.query(SessionParticipant, User)
        .join(User, User.id == SessionParticipant.user_id)
        .filter(
            SessionParticipant.session_id == session.id,
            SessionParticipant.user_id.is_not(None),
            SessionParticipant.is_waitlisted.is_(False),
        )
        .all()
    )
    recipients: list[dict] = []
    for _part, user in rows:
        recipients.append({
            "user_id": str(user.id),
            "email": user.email,
            "name": user.name or "회원",
        })
    return recipients


def _already_sent(db: DBSession, session_id: UUID, offset_min: int, user_id: UUID, channel: str) -> bool:
    return (
        db.query(SessionReminderLog.id)
        .filter(
            SessionReminderLog.session_id == session_id,
            SessionReminderLog.offset_min == offset_min,
            SessionReminderLog.user_id == user_id,
            SessionReminderLog.channel == channel,
            SessionReminderLog.status == "sent",
        )
        .first()
        is not None
    )


def _log_delivery(
    db: DBSession, *, session_id: UUID, offset_min: int, user_id: UUID | None, channel: str
) -> bool:
    """REM-01: 발송 로그를 원자적 INSERT 로 선점한다.

    반환 True = 이 실행이 선점 성공(실제 발송 진행), False = 이미 기록됨(중복).
    로그를 먼저 선점해야 동시 실행(워커 중복)이 겹쳐도 성공한 실행만 발송한다.
    """
    try:
        with db.begin_nested():
            db.add(SessionReminderLog(
                session_id=session_id,
                offset_min=offset_min,
                user_id=user_id,
                channel=channel,
                status="sent",
            ))
        return True
    except IntegrityError:
        # 동시 실행(워커 중복)으로 이미 선점됨 — 이 실행은 발송하지 않는다.
        logger.info(
            "[REMINDER] 이미 발송 선점됨 (session=%s, offset=%s, user=%s, channel=%s)",
            session_id, offset_min, user_id, channel,
        )
        return False


def _dispatch_channels(session: Session, offset_min: int, recipient: dict, db: DBSession) -> int:
    """한 수신자에게 인앱+WS+이메일 리마인더 발송하고 로그를 남긴다(발송 건수 반환)."""
    from app.models.notification_outbox import NotificationOutbox
    from app.services import notification_service

    user_id = _to_uuid(recipient["user_id"])
    message = build_reminder_message(session, offset_min)
    extra = notification_service.build_standard_extra(
        "session_reminder", "session", str(session.id),
        params={"offset_min": offset_min, "access_code": session.access_code},
    )
    sent = 0

    # 인앱 알림 + WS 실시간 알림(웹푸시) — REM-01: 먼저 로그를 원자적으로 선점한
    # 실행만 실제 발송한다(중복 워커가 겹쳐도 1회만).
    if _log_delivery(db, session_id=session.id, offset_min=offset_min, user_id=user_id, channel="ws"):
        notif = notification_service.create_notification(
            user_id, "session",
            message["subject"].replace("[MIND BREEZE] ", ""),
            message["body_text"],
            db,
            extra=extra,
        )
        db.add(NotificationOutbox(
            user_id=user_id,
            channel="ws",
            notification_id=notif.id,
            payload={
                "id": str(notif.id),
                "type": "session",
                "title": message["subject"].replace("[MIND BREEZE] ", ""),
                "body": message["body_text"],
                "extra": extra,
            },
            status="pending",
        ))
        sent += 1

    # 이메일 — 기존 이메일 서비스/워커 재사용. 로그 선점 성공 시에만 발송한다.
    email = recipient.get("email")
    if email and _log_delivery(
        db, session_id=session.id, offset_min=offset_min, user_id=user_id, channel="email"
    ):
        email_item = NotificationOutbox(
            user_id=user_id,
            channel="email",
            recipient=email,
            payload={
                "subject": message["subject"],
                "body": message["body_text"],
                "html": message["body_html"],
            },
            status="pending",
        )
        db.add(email_item)
        db.flush()
        try:
            from app.tasks.report_email_task import notification_email_task

            notification_email_task.apply_async(args=[str(email_item.id)], retry=False)
        except Exception as e:  # noqa: BLE001 — 브로커 장애 시 outbox 에 남아 추후 재시도
            logger.warning("[REMINDER] 이메일 큐 적재 실패 (outbox=%s): %s", email_item.id, e)
        sent += 1

    return sent


def run_reminder(session_id: str | UUID, offset_min: int, db: DBSession) -> dict:
    """특정 시점(offset_min) 리마인더 1회 실행 — ETA 태스크/스윕의 공용 진입점.

    이미 시작/취소/완료된 클래스나, 일정 없는 즉석 클래스는 발송하지 않는다.
    수신자별로 발송 로그를 확인해 중복 발송을 건너뛴다.
    """
    sid = _to_uuid(session_id)
    session = db.get(Session, sid)
    if session is None:
        return {"status": "skipped", "reason": "not_found"}
    if session.is_template:
        return {"status": "skipped", "reason": "template"}
    # 예약(scheduled) 상태에서만 사전 안내를 보낸다. 오픈(open)까지는 허용(입장 안내 유효).
    if session.status not in ("scheduled", "ready", "open"):
        return {"status": "skipped", "reason": f"status_{session.status}"}
    if session.scheduled_at is None:
        return {"status": "skipped", "reason": "no_schedule"}

    # FUNC-01: 이 시점(offset_min)이 지금 클래스에 유효하게 예약돼 있고 실제 도래했는지 검증한다.
    # 일정/시점이 바뀐 뒤 남아 있던 옛 ETA 태스크가 엉뚱한 시각에 발송하는 것을 막는다.
    try:
        offset = int(offset_min)
    except (TypeError, ValueError):
        return {"status": "skipped", "reason": "invalid_offset"}
    offsets = normalize_reminder_offsets(session.reminder_offsets)
    if offset not in offsets:
        return {"status": "skipped", "reason": "offset_not_scheduled"}
    eta = _ensure_aware(session.scheduled_at) - timedelta(minutes=offset)
    now = datetime.now(timezone.utc)
    if eta > now + timedelta(seconds=REMINDER_DUE_TOLERANCE_SEC):
        return {"status": "skipped", "reason": "not_due", "eta": eta.isoformat()}

    recipients = reminder_recipients(session, db)
    if not recipients:
        return {"status": "skipped", "reason": "no_recipients"}

    total_sent = 0
    for recipient in recipients:
        total_sent += _dispatch_channels(session, offset, recipient, db)
    db.commit()

    result = {
        "status": "sent" if total_sent else "duplicate",
        "session_id": str(session.id),
        "offset_min": offset,
        "recipients": len(recipients),
        "delivered": total_sent,
    }
    logger.info("[REMINDER] %s", result)
    return result


def due_offsets(session: Session, now: datetime | None = None) -> list[int]:
    """지금 발송해야 할 시점(예정 시각이 지난 것) 목록 — 스윕 폴백용."""
    if not session.scheduled_at:
        return []
    now = now or datetime.now(timezone.utc)
    base = _ensure_aware(session.scheduled_at)
    due: list[int] = []
    for offset in normalize_reminder_offsets(session.reminder_offsets):
        if base - timedelta(minutes=offset) <= now:
            due.append(offset)
    return due


def _reminder_task_id(session_id: object, offset_min: int, scheduled_at: datetime) -> str:
    """(세션, 시점, 일정) 별 결정적 Celery task_id.

    일정(scheduled_at)을 포함하므로 일정이 바뀌면 새 task_id 가 되어 옛 ETA 와 충돌하지 않는다.
    같은 조건 재예약은 같은 id 로 들어가며, 발송은 session_reminder_logs 중복 로그로 1회만 된다.
    """
    epoch = int(_ensure_aware(scheduled_at).timestamp())
    return f"session-reminder:{session_id}:{offset_min}:{epoch}"


def revoke_session_reminders(
    session_id: object, offsets: list[int], scheduled_at: datetime | None
) -> int:
    """옛 ETA 태스크를 task_id 로 취소한다(베스트에포트).

    - 일정이 바뀌면 옛 일정 기준 task_id 는 새 예약과 겹치지 않아 안전하게 취소된다.
    - 이미 발송/실행된 task_id 취소는 무해한 no-op 이다.
    - 브로커 장애·eager(워커 없음) 환경에서는 조용히 건너뛴다. 실제 무효화는
      run_reminder 의 offset/ETA due 게이트가 보장한다(방어 로직).
    """
    if not offsets or scheduled_at is None:
        return 0
    from app.core.celery_app import celery_app

    if celery_app.conf.task_always_eager:
        return 0
    revoked = 0
    for offset in offsets:
        task_id = _reminder_task_id(session_id, offset, scheduled_at)
        try:
            celery_app.control.revoke(task_id, terminate=False, reply=False, timeout=1.0)
            revoked += 1
        except Exception as e:  # noqa: BLE001 — 브로커 장애 시에도 예약 자체는 진행
            logger.warning("[REMINDER] ETA 취소 실패 (task_id=%s): %s", task_id, e)
    return revoked


def schedule_session_reminders(session: Session, db: DBSession) -> list[dict]:
    """예약 클래스의 리마인더를 Celery ETA 태스크로 예약한다.

    - reminder_offsets 가 비었거나 일정이 없으면 아무것도 하지 않는다(리마인더 끔).
    - 이미 지난 시점(발송 시각 과거)은 예약하지 않는다 — 스윕이 누락분을 보정한다.
    - 브로커 장애로 큐 적재가 실패해도 클래스 생성/수정은 막지 않는다(스윕 폴백).
    - (세션·시점·일정) 결정적 task_id 로 적재해, 일정 변경 시 옛 ETA 를 revoke 로 취소할 수 있다.
    """
    from app.tasks.reminder_task import send_session_reminder_task

    offsets = normalize_reminder_offsets(session.reminder_offsets)
    if not offsets or session.scheduled_at is None or session.is_template:
        return []
    scheduled = _ensure_aware(session.scheduled_at)
    now = datetime.now(timezone.utc)
    scheduled_jobs: list[dict] = []
    for offset in offsets:
        eta = scheduled - timedelta(minutes=offset)
        if eta <= now:
            continue  # 이미 지난 시점 — 스윕 대상
        try:
            send_session_reminder_task.apply_async(
                args=[str(session.id), offset],
                eta=eta,
                task_id=_reminder_task_id(session.id, offset, scheduled),
                retry=False,
            )
            scheduled_jobs.append({"offset_min": offset, "eta": eta.isoformat()})
        except Exception as e:  # noqa: BLE001
            logger.warning("[REMINDER] ETA 예약 실패 (session=%s, offset=%s): %s", session.id, offset, e)
    return scheduled_jobs
