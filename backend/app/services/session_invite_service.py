"""초대 재발송 (SDD-209 B7 / BE-7) — 호스트 전용·쿨다운·대상별 실제 요청 결과.

- 채널은 인앱 알림(+WS outbox)과, 사용자 선호가 켜진 경우 이메일뿐이다. **푸시 수신을 약속하지 않으며**
  결과는 요청 상태(queued/skipped/failed)이지 전달·수신 확인이 아니다.
- 입장 시각(``entered_at``, B9)이 기록된 참여자는 서버가 `skipped_entered` 로 건너뛴다. 기록이 없는 참여자(미입장·기록 도입 전)는
  대상이며, 호스트 클라이언트가 ``participant_ids`` 로 더 좁힐 수 있다. 생략하면 호스트를 제외한 모든 참여자가 대상이다.
- 쿨다운은 새 컬럼 없이 최근 재발송 알림 행(``extra.params.remind``)으로 판정한다.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session as DBSession

from app.models.notification import Notification
from app.services import session_service
from app.services.session_authz import SessionAction, get_session_authorized

REMIND_COOLDOWN_SEC = 60
_RECENT_LOOKBACK = 20


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def _recently_reminded(user_id: uuid.UUID, session_id: uuid.UUID, db: DBSession) -> bool:
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=REMIND_COOLDOWN_SEC)
    rows = (
        db.query(Notification)
        .filter(Notification.user_id == user_id, Notification.type == "session")
        .order_by(Notification.created_at.desc())
        .limit(_RECENT_LOOKBACK)
        .all()
    )
    for n in rows:
        extra = n.extra or {}
        if (
            extra.get("target_id") == str(session_id)
            and (extra.get("params") or {}).get("remind") is True
            and n.created_at is not None
            and _aware(n.created_at) >= cutoff
        ):
            return True
    return False


def remind_invitees(
    session_id: str, host_id: str, participant_ids: list[str] | None, db: DBSession
) -> dict:
    s = get_session_authorized(db, session_id, host_id, SessionAction.PARTICIPANT_REMIND)
    if s.status in ("completed", "cancelled"):
        raise HTTPException(status_code=400, detail="종료된 클래스에는 다시 알릴 수 없어요")

    participants = list(s.participants or [])
    by_id = {str(p.id): p for p in participants}
    if participant_ids is None:
        targets: list[tuple[str, object | None]] = [(str(p.id), p) for p in participants]
    else:
        targets = [(pid, by_id.get(str(pid))) for pid in dict.fromkeys(participant_ids)]

    results: list[dict] = []
    for pid, p in targets:
        if p is None:
            results.append({"participant_id": str(pid), "status": "not_found"})
            continue
        base = {"participant_id": str(p.id), "user_id": str(p.user_id) if p.user_id else None}
        if p.user_id is None:
            results.append({**base, "status": "skipped_no_account"})
            continue
        if p.is_waitlisted:
            results.append({**base, "status": "skipped_waitlisted"})
            continue
        if p.entered_at is not None:
            # SDD-209(B9/BE-11): 이미 입장한 참여자에게는 다시 알리지 않는다(B7 에서 미구현이던 항목).
            results.append({**base, "status": "skipped_entered"})
            continue
        if _recently_reminded(p.user_id, s.id, db):
            results.append({**base, "status": "skipped_cooldown"})
            continue
        notified = session_service._notify_participants_event(
            s, "session_invited", db,
            recipient_ids=[p.user_id],
            include_waitlisted=False,
            title="클래스에 입장해 주세요",
            body=s.title or "클래스",
            params={"remind": True},
        )
        mine = notified[0] if notified else {"in_app": "failed", "email": "not_requested"}
        status = {"queued": "queued", "skipped": "skipped_notification_off"}.get(mine["in_app"], "failed")
        results.append(
            {**base, "status": status, "channels": {"in_app": mine["in_app"], "email": mine["email"]}}
        )

    summary = {"queued": 0, "skipped": 0, "failed": 0}
    for r in results:
        if r["status"] == "queued":
            summary["queued"] += 1
        elif r["status"] in ("failed", "not_found"):
            summary["failed"] += 1
        else:
            summary["skipped"] += 1
    return {
        "session_id": str(s.id),
        "cooldown_sec": REMIND_COOLDOWN_SEC,
        "results": results,
        "summary": summary,
    }
