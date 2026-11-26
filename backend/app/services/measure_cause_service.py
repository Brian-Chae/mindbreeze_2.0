"""SDD-336 — 수업 측정 미시작 원인 판정 + 앱 재진입 푸시(넛지) 적재.

- `classify_reason`: 순수 함수. 우선순위 app_update_required > consent_declined > app_not_in_class > not_started.
- `load_cause_context`: 회차 참가자 배치 조회(쿼리 4회 고정, N+1 없음).
- `enqueue_measure_nudges`: 수업 시작 후 측정 미시작 150초 초과 회원에게 푸시 outbox 적재(회차·회원당 최대 2회).
  1분 cron(process_push_outbox_cron)이 호출한다. 점수·등급은 어디에도 쓰지 않는다.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy.orm import Session as DBSession

logger = logging.getLogger(__name__)

# 원인 코드(API `measure_issue_reason` 값)
REASON_APP_UPDATE = "app_update_required"
REASON_CONSENT_DECLINED = "consent_declined"
REASON_APP_NOT_IN_CLASS = "app_not_in_class"
REASON_NOT_STARTED = "not_started"

MIN_APP_VERSION = (1, 0, 1)
NUDGE_AFTER_SECONDS = 150          # 측정 미시작이 이 시간을 넘으면 첫 푸시
NUDGE_REPEAT_SECONDS = 300         # 두 번째 푸시는 첫 푸시 후 이 시간 뒤
NUDGE_MAX = 2                      # 회차·회원당 최대
NUDGE_CHANNEL = "push_nudge"       # session_reminder_logs.channel(10자 이내) — 중복 제한 기록용
NUDGE_BODY = "수업이 시작됐어요. 앱을 열어 측정을 시작해 주세요"

_VERSION_RE = re.compile(r"^\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?")


def parse_app_version(raw) -> tuple[int, int, int] | None:
    """'1.0.1'·'1.0.1-beta'·'v1.1' → (major, minor, patch). 읽을 수 없으면 None."""
    if not isinstance(raw, str):
        return None
    m = _VERSION_RE.match(raw)
    if not m:
        return None
    return tuple(int(g or 0) for g in m.groups())  # type: ignore[return-value]


def is_app_outdated(raw) -> bool:
    """버전 기록이 없거나(None·빈 값·해석 불가) 최소 버전 미만이면 True."""
    parsed = parse_app_version(raw)
    return parsed is None or parsed < MIN_APP_VERSION


def classify_reason(*, app_version, consent_declined: bool, has_presence: bool) -> str:
    """측정 미시작 회원의 원인 하나를 우선순위대로 돌려준다."""
    if is_app_outdated(app_version):
        return REASON_APP_UPDATE
    if consent_declined:
        return REASON_CONSENT_DECLINED
    if not has_presence:
        return REASON_APP_NOT_IN_CLASS
    return REASON_NOT_STARTED


def load_cause_context(db: DBSession, session_id, participants: list, now: datetime) -> dict:
    """참가자별 {app_version, declined, has_presence} — 읽기 전용 배치 조회."""
    from app.models.class_membership import SessionPresenceLease
    from app.models.device_token import DeviceToken
    from app.models.research import ResearchConsentEvent
    from app.models.session import SessionBandDevice

    pids = [p.id for p in participants]
    if not pids:
        return {}

    band_ver: dict = {}
    for pid, ver, seen in (
        db.query(SessionBandDevice.participant_id, SessionBandDevice.app_version, SessionBandDevice.last_seen_at)
        .filter(SessionBandDevice.session_id == session_id, SessionBandDevice.participant_id.in_(pids),
                SessionBandDevice.app_version.isnot(None))
        .all()
    ):
        if pid not in band_ver or (seen and seen > band_ver[pid][1]):
            band_ver[pid] = (ver, seen or datetime.min.replace(tzinfo=timezone.utc))

    user_ids = list({p.user_id for p in participants if p.user_id})
    token_ver: dict = {}
    if user_ids:
        for uid, ver, seen, created in (
            db.query(DeviceToken.user_id, DeviceToken.app_version, DeviceToken.last_seen_at, DeviceToken.created_at)
            .filter(DeviceToken.user_id.in_(user_ids), DeviceToken.platform != "web")
            .all()
        ):
            stamp = seen or created or datetime.min.replace(tzinfo=timezone.utc)
            if uid not in token_ver or stamp > token_ver[uid][1]:
                token_ver[uid] = (ver, stamp)

    latest_consent: dict = {}
    for pid, new_consented, created in (
        db.query(ResearchConsentEvent.participant_id, ResearchConsentEvent.new_consented, ResearchConsentEvent.created_at)
        .filter(ResearchConsentEvent.session_id == session_id, ResearchConsentEvent.participant_id.in_(pids))
        .all()
    ):
        if pid not in latest_consent or (created and created > latest_consent[pid][1]):
            latest_consent[pid] = (bool(new_consented), created or datetime.min.replace(tzinfo=timezone.utc))

    live_pids = {
        pid for (pid,) in db.query(SessionPresenceLease.participant_id)
        .filter(SessionPresenceLease.session_id == session_id, SessionPresenceLease.participant_id.in_(pids),
                SessionPresenceLease.expires_at > now)
        .distinct().all()
    }

    out: dict = {}
    for p in participants:
        ver = band_ver[p.id][0] if p.id in band_ver else (token_ver.get(p.user_id, (None,))[0] if p.user_id else None)
        event = latest_consent.get(p.id)
        out[p.id] = {
            "app_version": ver,
            "declined": p.eeg_collection_consented is False or (event is not None and event[0] is False),
            "has_presence": p.id in live_pids,
        }
    return out


# ---------------------------------------------------------------------------
# 재진입 푸시(넛지)
# ---------------------------------------------------------------------------

def enqueue_measure_nudges(db: DBSession, now: datetime | None = None) -> dict:
    """진행 중 회차에서 측정 미시작 150초 초과 회원에게 푸시를 적재한다(commit 포함).

    - 회차·회원당 최대 2회(첫 푸시 후 5분 간격). 측정 데이터가 들어오면 대상에서 빠져 자동 중단된다.
    - 뇌파 수집 거절·연구 동의 거절 회원, 푸시 알림을 끈 회원, 활성 기기 토큰이 없는 회원은 보내지 않는다.
    - 같은 (회차, 회원, 횟수)는 session_reminder_logs 유니크 제약으로 한 번만 적재된다.
    """
    from app.models.session import Session, SessionParticipant, SessionReminderLog
    from app.services import device_service, notification_service
    from app.services.session_service import (
        _ensure_aware, _participants_with_measure_data, compute_measure_not_started,
    )
    from app.models.user import User

    now = now or datetime.now(timezone.utc)
    stats = {"sessions": 0, "queued": 0, "skipped": 0}
    sessions = (
        db.query(Session)
        .filter(Session.status == "in_progress", Session.is_template.is_(False), Session.started_at.isnot(None))
        .all()
    )
    for s in sessions:
        stats["sessions"] += 1
        active = [p for p in (s.participants or [])
                  if not p.is_waitlisted and p.user_id and p.entered_at is not None
                  and p.eeg_collection_consented is not False]
        if not active:
            continue
        from app.models.eeg_feature import EEGFeatureWindow

        feature_pids = {
            pid for (pid,) in db.query(EEGFeatureWindow.participant_id)
            .filter(EEGFeatureWindow.session_id == s.id, EEGFeatureWindow.participant_id.in_([p.id for p in active]))
            .distinct().all()
        }
        with_data = _participants_with_measure_data(db, s.id, [p.id for p in active], feature_pids)
        due = []
        for p in active:
            since = compute_measure_not_started(
                session_status=s.status, entered_at=p.entered_at, started_at=s.started_at,
                has_data=p.id in with_data, eeg_consented=p.eeg_collection_consented, now=now,
                threshold_s=NUDGE_AFTER_SECONDS,
            )
            if since is not None:
                due.append(p)
        if not due:
            continue
        ctx = load_cause_context(db, s.id, due, now)
        logs: dict = {}
        for uid, offset, sent_at in (
            db.query(SessionReminderLog.user_id, SessionReminderLog.offset_min, SessionReminderLog.sent_at)
            .filter(SessionReminderLog.session_id == s.id, SessionReminderLog.channel == NUDGE_CHANNEL,
                    SessionReminderLog.user_id.in_([p.user_id for p in due]))
            .all()
        ):
            logs.setdefault(uid, {})[offset] = sent_at
        for p in due:
            if ctx[p.id]["declined"]:
                stats["skipped"] += 1
                continue
            sent = logs.get(p.user_id, {})
            if len(sent) >= NUDGE_MAX:
                continue
            if sent and _ensure_aware(max(sent.values())) + timedelta(seconds=NUDGE_REPEAT_SECONDS) > now:
                continue
            user = db.get(User, p.user_id)
            if user is None or not notification_service.get_user_preferences(user)["push"].get("session_started", False):
                stats["skipped"] += 1
                continue
            if not device_service.list_active_tokens(db, p.user_id):
                stats["skipped"] += 1
                continue
            order = len(sent) + 1
            try:
                db.add(SessionReminderLog(session_id=s.id, user_id=p.user_id, offset_min=-order,
                                          channel=NUDGE_CHANNEL, status="sent"))
                notification_service.enqueue_outbox(
                    db, user_id=p.user_id, channel="push",
                    payload={"title": "MIND BREEZE", "body": NUDGE_BODY,
                             "deeplink": f"/class/{UUID(str(s.id))}/enter", "message_id": ""},
                )
                db.commit()
                stats["queued"] += 1
            except Exception:  # noqa: BLE001 — 동시 실행·중복은 건너뛴다
                db.rollback()
                logger.warning("[measure-nudge] 적재 실패 session=%s", str(s.id)[:8], exc_info=True)
    return stats
