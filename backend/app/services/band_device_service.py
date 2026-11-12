"""SDD-326 — 밴드 시리얼 보고(UPSERT)·역조회.

- 현재 기기: ``session_participants.linkband_device_id`` (가장 최근 보고 값).
- 이력: ``session_band_devices`` (참가자×시리얼 1행, 재보고는 last_seen 갱신).
- 시리얼은 기기 식별자 — 로그에는 접두 + 끝 4자만 남기고 에러 응답에 원문을 에코하지 않는다.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DBSession, aliased

from app.models.class_program import Class
from app.models.biosignal import BiosignalGapEvent
from app.models.live_state import CaptureStream
from app.models.session import Session, SessionBandDevice, SessionParticipant
from app.models.user import User
from app.models.user_org_membership import UserOrgMembership
from app.schemas.band_device import (
    BandDeviceReportRequest,
    BandDeviceUsageItem,
    BandDeviceUsageResponse,
    SERIAL_PATTERN,
    normalize_serial,
)

logger = logging.getLogger(__name__)

USAGE_LIMIT = 200


def _now() -> datetime:
    return datetime.now(timezone.utc)


def mask_serial(serial: str | None) -> str:
    """로그용 마스킹 — 접두 3자 + 끝 4자만."""
    if not serial:
        return "-"
    if len(serial) <= 7:
        return "***"
    return f"{serial[:3]}…{serial[-4:]}"


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


def report_band_device(
    session_id: str, payload: BandDeviceReportRequest, db: DBSession,
    *, entry_credential: str | None, current_user_id: str | None,
) -> dict:
    """본인 참가자의 밴드 시리얼 보고. 멱등. 회차 종료 후 늦은 보고도 이력만 갱신하며 거부하지 않는다."""
    from app.services import session_service

    sid = session_service._to_uuid(session_id)
    if not db.query(Session.id).filter(Session.id == sid).first():
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")
    participant = session_service.resolve_participant_actor(
        sid, db, entry_credential=entry_credential, current_user_id=current_user_id, allow_completed=True,
    )
    serial = payload.serial  # 스키마가 정규화·검증 완료
    now = _now()
    row = (
        db.query(SessionBandDevice)
        .filter(SessionBandDevice.participant_id == participant.id, SessionBandDevice.serial == serial)
        .first()
    )
    if row is None:
        try:
            with db.begin_nested():
                db.add(SessionBandDevice(
                    id=uuid.uuid4(), session_id=sid, participant_id=participant.id, serial=serial,
                    firmware=payload.firmware, platform=payload.platform, first_seen_at=now, last_seen_at=now,
                ))
        except IntegrityError:  # 동시 보고 경합 — UNIQUE 가 1행을 보장, 상대 행을 갱신
            row = (
                db.query(SessionBandDevice)
                .filter(SessionBandDevice.participant_id == participant.id, SessionBandDevice.serial == serial)
                .first()
            )
    if row is not None:
        row.last_seen_at = now
        row.platform = payload.platform
        if payload.firmware:
            row.firmware = payload.firmware
    participant.linkband_device_id = serial
    db.commit()
    logger.info("[band-device] session=%s participant=%s serial=%s platform=%s",
                sid, participant.id, mask_serial(serial), payload.platform)
    return {"ok": True}


def _scope_clause(db: DBSession, actor: dict):
    """호출자 권한 범위의 회차 조건. 허용 역할이 아니면 403."""
    role = actor.get("role")
    actor_id = uuid.UUID(str(actor["id"]))
    if role == "platform_admin":
        return None
    if role == "counselor":
        return Session.host_id == actor_id
    if role == "org_admin":
        org_ids = select(UserOrgMembership.org_id).where(
            UserOrgMembership.user_id == actor_id,
            UserOrgMembership.role == "org_admin",
            UserOrgMembership.status == "active",
        )
        return Class.organization_id.in_(org_ids)
    raise HTTPException(status_code=403, detail="이 작업을 수행할 권한이 없습니다")


def band_device_usage(db: DBSession, actor: dict, serial: str) -> BandDeviceUsageResponse:
    """시리얼이 쓰인 (회차, 참가자) 목록 + 참가자별 capture_stream 세대 수·교체 수. 읽기 전용."""
    normalized = normalize_serial(serial)
    if not SERIAL_PATTERN.fullmatch(normalized):
        raise HTTPException(status_code=422, detail="serial 형식이 올바르지 않습니다")
    scope = _scope_clause(db, actor)

    d, p, s = SessionBandDevice, SessionParticipant, Session
    streams = (
        select(
            CaptureStream.participant_id.label("pid"),
            func.count().label("n"),
            func.coalesce(func.sum(case((CaptureStream.status == "superseded", 1), else_=0)), 0).label("sup"),
        )
        .group_by(CaptureStream.participant_id)
        .subquery()
    )
    q = (
        select(
            d, s.id.label("sid"), s.title, s.started_at, s.scheduled_at,
            p.guest_name, p.user_id, p.linkband_device_id, User.name.label("uname"),
            streams.c.n, streams.c.sup,
        )
        .join(p, p.id == d.participant_id)
        .join(s, s.id == d.session_id)
        .outerjoin(Class, Class.id == s.class_id)
        .outerjoin(User, User.id == p.user_id)
        .outerjoin(streams, streams.c.pid == d.participant_id)
        .where(d.serial == normalized)
        .order_by(d.last_seen_at.desc())
        .limit(USAGE_LIMIT + 1)
    )
    if scope is not None:
        q = q.where(scope)
    rows = db.execute(q).all()
    truncated = len(rows) > USAGE_LIMIT
    gaps = _gap_breakdown(db, [r[0] for r in rows[:USAGE_LIMIT]])
    items = []
    for r in rows[:USAGE_LIMIT]:
        dev = r[0]
        started = r.started_at or r.scheduled_at
        items.append(BandDeviceUsageItem(
            session_id=str(r.sid), session_title=r.title, session_started_at=_iso(started),
            participant_id=str(dev.participant_id),
            display_name=(r.uname or r.guest_name or None) if r.user_id else (r.guest_name or None),
            firmware=dev.firmware, platform=dev.platform,
            first_seen_at=_iso(dev.first_seen_at) or "", last_seen_at=_iso(dev.last_seen_at) or "",
            is_current=(r.linkband_device_id == dev.serial),
            stream_count=int(r.n or 0), superseded_count=int(r.sup or 0),
            gap_count=sum(gaps.get(dev.id, {}).values()), gap_reasons=gaps.get(dev.id, {}),
        ))
    return BandDeviceUsageResponse(serial=normalized, items=items, truncated=truncated)


def _gap_breakdown(db: DBSession, devs: list[SessionBandDevice]) -> dict[uuid.UUID, dict[str, int]]:
    """이력 행별 측정 끊김 사유 집계 — 쿼리 1회(N+1 없음).

    구간은 서버 수신 시각(created_at) 기준: 참가자 시리얼이 1개면 제한 없음(보고 전 끊김 포함),
    여러 개면 [이 행 first_seen_at, 같은 참가자의 다음 시리얼 first_seen_at).
    """
    if not devs:
        return {}
    d, d2, g = SessionBandDevice, aliased(SessionBandDevice), BiosignalGapEvent
    n_serials = select(func.count()).where(d2.participant_id == d.participant_id).correlate(d).scalar_subquery()
    next_first = (select(func.min(d2.first_seen_at))
                  .where(d2.participant_id == d.participant_id, d2.first_seen_at > d.first_seen_at)
                  .correlate(d).scalar_subquery())
    q = (
        select(d.id, g.reason, func.count().label("n"))
        .join(g, and_(g.participant_id == d.participant_id,
                      or_(n_serials == 1, g.created_at >= d.first_seen_at),
                      or_(next_first.is_(None), g.created_at < next_first)))
        .where(d.id.in_([x.id for x in devs]))
        .group_by(d.id, g.reason)
    )
    out: dict[uuid.UUID, dict[str, int]] = {}
    for did, reason, n in db.execute(q).all():
        out.setdefault(did, {})[reason] = int(n)
    return out
