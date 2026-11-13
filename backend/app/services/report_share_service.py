"""SDD-327 T12/T14 — 리포트 공유 메일 서비스.

- `share_report`: 회원·상담사·기관관리자 공통의 단일 발송 진입점. 권한 분기는 라우터에서 끝내고
  서비스는 ShareActor(종류·표시 이름)만 받는다.
- 수신자별 `report_share` JWT(7일, 받는 주소 해시·jti 바인딩), 이력 행(report_share_events) 기록.
- Redis 상한: 회원 10통/일, 상담사·기관관리자 300통/일(수신 주소 1개=1통, KST 날짜), 같은 주소 1분.
  Redis 장애 시 발송을 거부한다(fail-closed).
- `get_report_share_view_content`: 공유 토큰 열람(로그인 불필요, jti·만료·revoked 검사).
- 주소 원문은 저장하지 않는다(마스킹 + HMAC 해시만). 원문은 큐 인자로만 전달한다.
"""
import hashlib
import hmac
import logging
import re
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from html import escape
from typing import Callable, Literal
from uuid import UUID

import redis
from fastapi import HTTPException
from sqlalchemy.orm import Session as DBSession

from app.config import settings
from app.models.record import Report
from app.models.report_share_event import ReportShareEvent
from app.models.session import Session, SessionParticipant
from app.models.user import User
from app.schemas.report_share import MAX_MESSAGE_LEN, MAX_RECIPIENTS, mask_recipient
from app.services import record_service, report_email_service
from app.services.report_service import _serialize

logger = logging.getLogger(__name__)

KST = timezone(timedelta(hours=9))
MEMBER_DAILY_LIMIT = 10
STAFF_DAILY_LIMIT = 300
SAME_ADDRESS_INTERVAL_SEC = 60
DAY_KEY_TTL_SEC = 36 * 3600
FALLBACK_SENDER_NAME = "MIND BREEZE 회원"
HISTORY_LIMIT = 50

ActorKind = Literal["member", "counselor", "org_admin"]

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_TAG_RE = re.compile(r"<[^>]*>")
_URL_RE = re.compile(
    r"(?:[a-zA-Z][a-zA-Z0-9+.\-]*://\S*|www\.\S*"
    r"|\b[\w\-]+(?:\.[\w\-]+)*\.(?:com|net|org|kr|io|co|me|app|link|ly|xyz|info|biz|dev|site|top|ai)\b\S*)",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class ShareActor:
    """발송 주체. kind 로 일일 상한이 정해진다."""

    user_id: str
    kind: ActorKind
    display_name: str | None = None

    @property
    def daily_limit(self) -> int:
        return MEMBER_DAILY_LIMIT if self.kind == "member" else STAFF_DAILY_LIMIT

    @property
    def sender_name(self) -> str:
        """메일에 표시할 보낸 사람 이름 — 앱 표시 이름만, 비면 대체 문구 (spec §10)."""
        name = (self.display_name or "").strip()
        return name or FALLBACK_SENDER_NAME


def resolve_display_name(user: User | None) -> str | None:
    """앱 표시 이름만 사용한다. 실명(users.name)·이메일은 쓰지 않는다 (spec §10).

    현재 User 모델에는 표시 이름 컬럼이 없어 대체 문구가 쓰인다. 컬럼이 생기면 여기서만 연결한다.
    """
    if user is None:
        return None
    for attr in ("display_name", "nickname"):
        value = getattr(user, attr, None)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


# ---------------------------------------------------------------------------
# 유틸
# ---------------------------------------------------------------------------
def get_sync_redis() -> "redis.Redis":
    """동기 라우트용 Redis 클라이언트(기존 비동기 싱글턴과 분리). 테스트에서 monkeypatch 한다."""
    return redis.Redis.from_url(
        settings.redis_url, decode_responses=True, socket_connect_timeout=1, socket_timeout=2
    )


def hash_recipient(email: str) -> str:
    """수신 주소 HMAC-SHA256 hex(소문자 주소). 키는 기존 JWT 시크릿."""
    return hmac.new(
        settings.jwt_secret_key.encode("utf-8"),
        email.strip().lower().encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def sanitize_message(message: str | None) -> str | None:
    """메시지에서 태그·URL/링크를 제거하고 HTML 이스케이프한다. 비면 None."""
    if not message:
        return None
    text = _TAG_RE.sub("", message)
    text = _URL_RE.sub("", text)
    text = re.sub(r"[ \t]{2,}", " ", text).strip()[:MAX_MESSAGE_LEN]
    return escape(text) if text else None


def _now_kst() -> datetime:
    return datetime.now(KST)


def _day_key(user_id: str) -> str:
    return f"rl:share:day:{user_id}:{_now_kst().strftime('%Y%m%d')}"


def _rcpt_key(recipient_hash: str) -> str:
    return f"rl:share:rcpt:{recipient_hash[:16]}"


def _unavailable() -> HTTPException:
    return HTTPException(503, "잠시 후 다시 시도해 주세요")


def _to_uuid(value: str) -> UUID:
    try:
        return UUID(str(value))
    except (TypeError, ValueError):
        raise HTTPException(400, "잘못된 리포트 ID 형식입니다")


def _normalize_recipients(recipients: list[str]) -> list[str]:
    out: list[str] = []
    for raw in recipients:
        addr = str(raw).strip().lower()
        if not _EMAIL_RE.match(addr) or len(addr) > 254:
            raise HTTPException(422, "올바른 이메일 주소가 아닙니다")
        if addr not in out:
            out.append(addr)
    if not out:
        raise HTTPException(422, "받는 주소를 입력해 주세요")
    if len(out) > MAX_RECIPIENTS:
        raise HTTPException(422, f"받는 주소는 최대 {MAX_RECIPIENTS}개입니다")
    return out


def load_shareable_report(report_id: str, db: DBSession) -> tuple[Report, Session, SessionParticipant]:
    """공유 가능한 리포트(승인 완료·참가자 존재·개인정보 만료/제외 아님)를 로드한다."""
    report = db.query(Report).filter(Report.id == _to_uuid(report_id)).first()
    if not report:
        raise HTTPException(404, "리포트를 찾을 수 없습니다")
    if not report.participant_id:
        raise HTTPException(400, "참가자가 있는 리포트만 공유할 수 있습니다")
    if report.status != "completed":
        raise HTTPException(409, "승인 완료된 리포트만 공유할 수 있습니다")
    participant = db.query(SessionParticipant).filter(
        SessionParticipant.id == report.participant_id,
        SessionParticipant.session_id == report.session_id,
    ).first()
    if not participant:
        raise HTTPException(400, "리포트 참가자를 찾을 수 없습니다")
    if participant.pii_scrubbed_at is not None:
        raise HTTPException(409, "개인정보 보관 기간이 만료된 참가자입니다")
    if not participant.report_included:
        raise HTTPException(409, "리포트에 반영되지 않은 참가자입니다")
    session = db.query(Session).filter(Session.id == report.session_id).first()
    if not session:
        raise HTTPException(404, "세션을 찾을 수 없습니다")
    return report, session, participant


def assert_member_owns(report: Report, participant: SessionParticipant, user_id: str) -> None:
    """회원 본인 리포트만 허용 — participant.user_id 또는 report.user_id 가 본인이어야 한다."""
    uid = str(user_id)
    owner_ids = {str(x) for x in (participant.user_id, report.user_id) if x}
    if uid not in owner_ids:
        raise HTTPException(403, "본인의 리포트만 공유할 수 있습니다")


# ---------------------------------------------------------------------------
# 발송
# ---------------------------------------------------------------------------
def _reserve_rate_limit(
    r: "redis.Redis", actor: ShareActor, hashes: dict[str, str]
) -> tuple[list[str], list[tuple[str, str]], int]:
    """주소별 1분 간격 → 일일 상한 순으로 예약한다.

    반환: (수락 주소, [(거절 주소, 사유)], 남은 통수). 일일 상한 초과는 429.
    Redis 오류는 모두 503(fail-closed).
    """
    accepted: list[str] = []
    rejected: list[tuple[str, str]] = []
    day_key = _day_key(actor.user_id)
    day_incremented = 0
    try:
        for addr, h in hashes.items():
            if r.set(_rcpt_key(h), "1", nx=True, ex=SAME_ADDRESS_INTERVAL_SEC):
                accepted.append(addr)
            else:
                rejected.append((addr, "too_soon"))
        if not accepted:
            used = int(r.get(day_key) or 0)
            return accepted, rejected, max(actor.daily_limit - used, 0)
        used = int(r.incrby(day_key, len(accepted)))
        day_incremented = len(accepted)
        r.expire(day_key, DAY_KEY_TTL_SEC)
        if used > actor.daily_limit:
            r.decrby(day_key, day_incremented)
            for addr in accepted:
                r.delete(_rcpt_key(hashes[addr]))
            remaining = max(actor.daily_limit - (used - day_incremented), 0)
            raise HTTPException(
                429,
                f"오늘 보낼 수 있는 횟수를 넘었어요 (하루 {actor.daily_limit}통, 남은 {remaining}통)",
            )
        return accepted, rejected, max(actor.daily_limit - used, 0)
    except HTTPException:
        raise
    except Exception:  # noqa: BLE001 — redis.RedisError·OSError 등 모두 fail-closed
        logger.exception("[report_share] redis rate-limit failure")
        raise _unavailable()


def _enqueue(event_id: str, email: str, link: str, attach_pdf: bool, message: str | None, sender_name: str) -> None:
    """T13 이 만드는 Celery 태스크를 지연 import 로 큐잉한다.

    인자: (event_id, recipient_email, share_url, attach_pdf, message(이미 이스케이프됨), sender_display_name)
    """
    from app.tasks.report_share_email_task import report_share_email_task

    report_share_email_task.apply_async(
        args=[event_id, email, link, attach_pdf, message, sender_name], retry=False
    )


def share_report(
    db: DBSession,
    report_id: str,
    actor: ShareActor,
    recipients: list[str],
    attach_pdf: bool = True,
    message: str | None = None,
    *,
    sync_send: bool = False,
    redis_client: "redis.Redis | None" = None,
) -> dict:
    """리포트를 수신자별 전용 링크로 공유한다. 권한 검사는 호출 전에 끝나 있어야 한다.

    sync_send=True 는 기존 resend-email 호환 경로: 큐 없이 기존 링크 메일 함수로 즉시 발송한다.
    반환: {accepted:[{masked,event_id,status}], rejected:[{masked,reason}], accepted_count,
           attached, daily_remaining, events:[ReportShareEvent], sent_ok(sync 전용)}
    """
    addrs = _normalize_recipients(recipients)
    report, session, participant = load_shareable_report(report_id, db)
    clean_message = sanitize_message(message)
    hashes = {a: hash_recipient(a) for a in addrs}

    try:
        r = redis_client or get_sync_redis()
    except Exception:  # noqa: BLE001
        logger.exception("[report_share] redis client init failure")
        raise _unavailable()
    accepted, rejected, remaining = _reserve_rate_limit(r, actor, hashes)

    rejected_out = [{"masked": mask_recipient(a), "reason": reason} for a, reason in rejected]
    if not accepted:
        return {"accepted": [], "rejected": rejected_out, "accepted_count": 0,
                "attached": False, "daily_remaining": remaining, "events": [], "sent_ok": False}

    attached = bool(attach_pdf) and not sync_send
    base = settings.report_email_base_url.rstrip("/")
    rows: list[tuple[ReportShareEvent, str, str]] = []
    for addr in accepted:
        jti = uuid.uuid4().hex
        token = report_email_service._token(
            "report_share", str(report.id), str(report.session_id),
            rcpt=hashes[addr][:32], jti=jti, sender=actor.user_id,
        )
        event = ReportShareEvent(
            report_id=report.id,
            sender_user_id=_to_uuid(actor.user_id),
            sender_role=actor.kind,
            recipient_masked=mask_recipient(addr),
            recipient_hash=hashes[addr],
            jti=jti,
            attached=attached,
            status="queued",
        )
        db.add(event)
        rows.append((event, addr, f"{base}/report-view?token={token}"))
    db.commit()

    all_ok = True
    for event, addr, link in rows:
        try:
            if sync_send:
                sent = bool(report_email_service.send_report_email(addr, link))
                event.status = "sent" if sent else "failed"
                event.error_code = None if sent else "send_failed"
                if sent:
                    event.sent_at = datetime.now(timezone.utc)
                all_ok = all_ok and sent
            else:
                _enqueue(str(event.id), addr, link, attached, clean_message, actor.sender_name)
        except Exception:  # noqa: BLE001 — 큐잉/발송 실패는 이력에 남기고 계속
            logger.exception("[report_share] dispatch failure: event_id=%s", event.id)
            event.status = "failed"
            event.error_code = "send_exception" if sync_send else "enqueue_failed"
            all_ok = False
    if sync_send:
        # 기존 resend 계약 호환: 발송 결과를 리포트 발송 상태에도 반영한다.
        report_email_service._record_delivery(report, "sent" if all_ok else "failed",
                                              None if all_ok else "send_failed")
        if all_ok:
            participant.report_email_status = "sent"
            participant.report_email_sent_at = datetime.now(timezone.utc)
    db.commit()

    return {
        "accepted": [{"masked": e.recipient_masked, "event_id": str(e.id), "status": e.status} for e, _, _ in rows],
        "rejected": rejected_out,
        "accepted_count": sum(1 for e, _, _ in rows if e.status != "failed"),
        "attached": attached,
        "daily_remaining": remaining,
        "events": [e for e, _, _ in rows],
        "sent_ok": all_ok,
    }


def list_share_history(db: DBSession, report_id: str, sender_user_id: str, limit: int = HISTORY_LIMIT) -> list[ReportShareEvent]:
    """본인이 보낸 최근 이력(최대 50건)."""
    return (
        db.query(ReportShareEvent)
        .filter(ReportShareEvent.report_id == _to_uuid(report_id),
                ReportShareEvent.sender_user_id == _to_uuid(sender_user_id))
        .order_by(ReportShareEvent.created_at.desc())
        .limit(min(limit, HISTORY_LIMIT))
        .all()
    )


# ---------------------------------------------------------------------------
# T14 — 공유 토큰 열람
# ---------------------------------------------------------------------------
def get_report_share_view_content(token: str, db: DBSession) -> dict:
    """report_share 토큰 소지자에게 리포트 계약을 반환한다(로그인 불필요).

    만료는 JWT exp(401), 발급되지 않은 jti·다른 리포트·수신자 해시 불일치·revoked 는 403.
    """
    claims = report_email_service._decode(token, "report_share")
    try:
        report_id = UUID(claims.get("sub", ""))
        session_id = UUID(claims.get("session_id", ""))
    except (TypeError, ValueError):
        raise HTTPException(401, "유효하지 않은 리포트 링크입니다")
    jti = claims.get("jti")
    event = db.query(ReportShareEvent).filter(
        ReportShareEvent.jti == str(jti or ""),
        ReportShareEvent.report_id == report_id,
    ).first() if jti else None
    if (
        event is None
        or event.revoked_at is not None
        or not claims.get("rcpt")
        or event.recipient_hash[:32] != claims.get("rcpt")
    ):
        raise HTTPException(403, "리포트 접근 권한이 없습니다")

    report = db.query(Report).filter(
        Report.id == report_id, Report.session_id == session_id,
        Report.type == "client", Report.status == "completed",
    ).first()
    participant = db.query(SessionParticipant).filter(
        SessionParticipant.id == report.participant_id,
        SessionParticipant.session_id == session_id,
    ).first() if report and report.participant_id else None
    if not participant or not participant.report_included or participant.pii_scrubbed_at is not None:
        raise HTTPException(403, "리포트 접근 권한이 없습니다")
    session = db.query(Session).filter(Session.id == session_id).first()
    if not session:
        raise HTTPException(403, "리포트 접근 권한이 없습니다")
    return _serialize(
        report, session,
        report_email=None,  # 수신자에게 등록 이메일을 노출하지 않는다
        subjective=record_service.resolve_subjective_state(report.session_id, report.participant_id, db),
    )
