"""생체 신호 고아 산출물·미종료 capture_stream 정리 sweep.

배경: 측정 중 앱이 강제 종료(재설치 등)되면 presign 만 받고 업로드되지 않은 산출물(pending)이
재실행된 앱의 큐에도 없어 영영 올라오지 않는다. 그러면 manifest close_state 가 pending_upload 에 갇힌다.

- 회차가 끝난 뒤 유예(ORPHAN_GRACE_SECONDS) 안에 올라오지 않은 pending 산출물을
  upload_status='failed' + failure_reason='abandoned_orphan' 으로 종결한다(스키마 변경 없음).
  manifest 평가는 이를 lost 로 보아 partial(일부 누락 완료)로 넘긴다.
  늦게 도착한 presign/ack 는 기존 경로 그대로 failed→pending→uploaded 로 복구되고 manifest 도 다시 complete 로 수렴한다.
- 회차 종료 cutoff 후 close deadline 이 지났는데 closed_at 이 비어 있는 ended stream 에 종료 시각을 기록한다.
  status 는 바꾸지 않는다(ingest 판정은 status 와 cutoff 를 함께 본다).
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, or_
from sqlalchemy.orm import Session as DBSession

from app.models.biosignal import BiosignalArtifact, BiosignalManifestCurrent
from app.models.live_state import CaptureStream
from app.models.session import Session as SessionModel
from app.services import biosignal_manifest_service
from app.services.session_live_commands import CLOSE_DEADLINE_SECONDS

logger = logging.getLogger(__name__)

# 회차 종료 후 close deadline(24h)과 같다 — 앱은 그 안에 오프라인 큐를 비우는 것이 계약이다.
ORPHAN_GRACE_SECONDS = CLOSE_DEADLINE_SECONDS
CLOSE_REASON_DEADLINE = "close_deadline_expired"
# 회차 종료(cutoff) 후 클라이언트가 capture.close 를 보낼 시간. 지나도 closed_at 이 비면 서버가 종료 시각을 기록한다(24h 를 기다리지 않는다).
CLOSE_GRACE_SECONDS = 30 * 60
CLOSE_REASON_NO_CLIENT_CLOSE = "session_ended_no_client_close"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def abandon_orphan_artifacts(db: DBSession, *, now: datetime | None = None, limit: int = 1000) -> dict:
    now = now or _now()
    cutoff = now - timedelta(seconds=ORPHAN_GRACE_SECONDS)
    rows = (
        db.query(BiosignalArtifact)
        .join(SessionModel, SessionModel.id == BiosignalArtifact.session_id)
        .filter(
            BiosignalArtifact.upload_status == "pending",
            BiosignalArtifact.created_at < cutoff,
            # 회차가 끝났고(ended_at 이 있으면 그 시각, 없으면 완료/취소 상태) 유예가 지난 것만
            or_(
                SessionModel.ended_at < cutoff,
                and_(SessionModel.ended_at.is_(None), SessionModel.status.in_(("completed", "cancelled"))),
            ),
        )
        .order_by(BiosignalArtifact.created_at)
        .limit(limit)
        .all()
    )
    touched: set[tuple] = set()
    for row in rows:
        row.upload_status, row.failure_reason = "failed", biosignal_manifest_service.ABANDONED_REASON
        touched.add((row.session_id, row.participant_id))
    db.flush()
    refreshed = 0
    for sid, pid in touched:
        cur = db.get(BiosignalManifestCurrent, (sid, pid))
        before = cur.revision if cur else 0
        biosignal_manifest_service.refresh_if_closing(db, sid, pid)  # close intent 가 있을 때만 새 revision
        db.flush()
        cur = db.get(BiosignalManifestCurrent, (sid, pid))
        refreshed += 1 if cur and cur.revision != before else 0
    db.commit()
    if rows:
        logger.info("[biosignal-orphan] abandoned=%d participants=%d manifest_revisions=%d", len(rows), len(touched), refreshed)
    return {"abandoned": len(rows), "participants": len(touched), "manifest_revisions": refreshed}


def close_expired_ended_streams(db: DBSession, *, now: datetime | None = None, limit: int = 1000) -> dict:
    now = now or _now()
    grace_cutoff = now - timedelta(seconds=CLOSE_GRACE_SECONDS)
    rows = (
        db.query(CaptureStream)
        .filter(
            CaptureStream.status == "ended",
            CaptureStream.closed_at.is_(None),
            CaptureStream.close_deadline_at.isnot(None),
            or_(
                CaptureStream.close_deadline_at < now,
                and_(CaptureStream.cutoff_at.isnot(None), CaptureStream.cutoff_at < grace_cutoff),
            ),
        )
        .limit(limit)
        .all()
    )
    for s in rows:
        if s.close_deadline_at < now:
            s.closed_at, s.close_reason = s.close_deadline_at, CLOSE_REASON_DEADLINE
        else:
            s.closed_at, s.close_reason = s.cutoff_at + timedelta(seconds=CLOSE_GRACE_SECONDS), CLOSE_REASON_NO_CLIENT_CLOSE
    db.commit()
    if rows:
        logger.info("[biosignal-orphan] ended stream closed_at 기록=%d", len(rows))
    return {"streams_closed": len(rows)}


def run_sweep(db: DBSession, *, now: datetime | None = None) -> dict:
    return {**abandon_orphan_artifacts(db, now=now), **close_expired_ended_streams(db, now=now)}
