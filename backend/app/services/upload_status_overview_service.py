"""SDD-263 — 전체 회차 업로드 현황 목록(회차별 요약) 집계.

- 서버가 받은 것만 센다(`basis=server_received`). 점수·완료·보증 값은 만들지 않는다.
- 회차별 참여자 status 는 SDD-261 `_build_participant` 규칙을 그대로 재사용한다(상세와 어긋나지 않게).
- SQL 은 회차 수와 무관하게 후보 1 + 참여자 1 + feature 1 + raw 1 (캐시 적중 회차는 생략).
- 내부 결측은 윈도 함수 대신 스트림별 max-min+1-count (유일 제약 하에서 SDD-261 lag 계산과 같은 값).
- 계약 정본: specs/sdd-263-upload-status-overview/contract.md
"""

from __future__ import annotations

import hashlib
import json
import threading
import time
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session as DBSession

from app.models.class_program import Class
from app.models.eeg_feature import EEGFeatureWindow
from app.models.organization import Organization
from app.models.record import EEGRawChunk
from app.models.session import Session, SessionParticipant
from app.models.user import User
from app.models.user_org_membership import UserOrgMembership
from app.schemas.upload_status_overview import (
    OverviewItem,
    OverviewSummary,
    UploadStatusOverviewResponse,
)
from app.services.upload_status_service import (
    POST_END_ACTIVE_SEC,
    RECENT_RECEIVE_SEC,
    _aware,
    _build_participant,
    _i,
    _iso,
    _matches,
)

DEFAULT_LIMIT = 30
MAX_LIMIT = 50
DEFAULT_SINCE_DAYS = 30
MAX_SINCE_DAYS = 90
CANDIDATE_STATUSES = ("open", "in_progress", "completed")
BADGES = ("needs_attention", "uploading", "received_unreconciled", "no_data")
TTL_LIVE_SEC = 2.0
TTL_RECENT_SEC = 10.0
TTL_OLD_SEC = 300.0
_CACHE_MAX = 2048

_cache: dict[uuid.UUID, tuple[float, dict]] = {}
_cache_lock = threading.Lock()


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def _monotonic() -> float:
    return time.monotonic()


def clear_cache() -> None:
    with _cache_lock:
        _cache.clear()


@dataclass(frozen=True)
class OverviewResult:
    etag: str
    poll_interval_sec: int
    body: UploadStatusOverviewResponse | None  # None = If-None-Match 일치(304)


def _forbidden() -> HTTPException:
    return HTTPException(403, detail={"code": "upload_status_forbidden"})


def _not_found() -> HTTPException:
    return HTTPException(404, detail={"code": "upload_status_not_found"})


def parse_since(raw: str | None, now: datetime) -> datetime:
    """`YYYY-MM-DD` 또는 ISO datetime(UTC 가정). 기본 30일 전, 90일보다 오래되면 422."""
    floor = now - timedelta(days=MAX_SINCE_DAYS)
    if raw is None or raw == "":
        return now - timedelta(days=DEFAULT_SINCE_DAYS)
    try:
        value = datetime.fromisoformat(raw.replace("Z", "+00:00")) if len(raw) > 10 else datetime.combine(
            date.fromisoformat(raw), datetime.min.time())
    except ValueError:
        raise HTTPException(422, detail={"code": "upload_status_invalid_since"})
    since = _aware(value)
    if since < floor:
        raise HTTPException(422, detail={"code": "upload_status_invalid_since"})
    return since


# ---------------------------------------------------------------------------
# 후보 회차 (권한 범위 + 정렬 + 상한, 1 쿼리)
# ---------------------------------------------------------------------------

def _scope_orgs(actor_id: uuid.UUID, role: str):
    """활성 사용자·활성 membership·활성 기관의 org_id 서브쿼리."""
    return (
        select(UserOrgMembership.org_id)
        .join(User, User.id == UserOrgMembership.user_id)
        .join(Organization, Organization.id == UserOrgMembership.org_id)
        .where(UserOrgMembership.user_id == actor_id, UserOrgMembership.role == role,
               UserOrgMembership.status == "active", User.status == "active",
               Organization.deactivated_at.is_(None))
    )


def _check_org_filter(db: DBSession, actor_id: uuid.UUID, role: str, org_id: uuid.UUID) -> None:
    ok = db.execute(_scope_orgs(actor_id, role).where(UserOrgMembership.org_id == org_id)).first()
    if ok is None:
        raise _not_found()


def _candidates(db: DBSession, actor: dict, *, since: datetime, limit: int, org_id: uuid.UUID | None,
                class_id: uuid.UUID | None) -> list:
    actor_id = uuid.UUID(str(actor["id"]))
    role = actor.get("role")
    if role not in ("platform_admin", "org_admin", "counselor"):
        raise _forbidden()
    if org_id is not None and role != "platform_admin":
        _check_org_filter(db, actor_id, role, org_id)

    effective = func.coalesce(Session.started_at, Session.scheduled_at, Session.created_at)
    stmt = (
        select(
            Session.id.label("session_id"), Session.class_id, Session.status, Session.started_at,
            Session.ended_at, Session.title.label("session_title"), Session.seq,
            Class.title.label("class_title"), Class.organization_id, Organization.name.label("organization_name"),
            func.count().over().label("total"),
        )
        .join(Class, Class.id == Session.class_id)
        .outerjoin(Organization, Organization.id == Class.organization_id)
        .where(Session.hidden_at.is_(None), Class.hidden_at.is_(None), Session.is_template.is_(False),
               Session.status.in_(CANDIDATE_STATUSES), effective >= since)
        .order_by(case((Session.status == "in_progress", 0), else_=1), effective.desc(), Session.id.asc())
        .limit(limit)
    )
    if role == "org_admin":
        stmt = stmt.where(Class.organization_id.in_(_scope_orgs(actor_id, "org_admin")))
    elif role == "counselor":
        stmt = stmt.where(Class.organization_id.in_(_scope_orgs(actor_id, "counselor")),
                          Session.host_id == actor_id)
    if org_id is not None:
        stmt = stmt.where(Class.organization_id == org_id)
    if class_id is not None:
        stmt = stmt.where(Session.class_id == class_id)
    return db.execute(stmt).all()


# ---------------------------------------------------------------------------
# 본문 집계 (참여자 1 + feature 1 + raw 1)
# ---------------------------------------------------------------------------

def _participants_bulk(db: DBSession, session_ids: list[uuid.UUID]) -> dict[uuid.UUID, list]:
    p = SessionParticipant
    rows = db.execute(
        select(p.session_id, p.id, p.user_id, p.guest_name, User.name, p.is_waitlisted, p.band_connected,
               p.report_included, p.eeg_collection_consented)
        .outerjoin(User, User.id == p.user_id)
        .where(p.session_id.in_(session_ids), p.removed_at.is_(None), p.waitlist_cancelled_at.is_(None),
               p.superseded_by_participant_id.is_(None))
    ).all()
    out: dict[uuid.UUID, list] = {}
    for row in rows:
        out.setdefault(row.session_id, []).append(row)
    return out


def _feature_bulk(db: DBSession, session_ids: list[uuid.UUID]) -> dict[uuid.UUID, dict]:
    f = EEGFeatureWindow
    rows = db.execute(
        select(f.session_id, f.participant_id, f.play_group_id,
               func.count().label("n"), func.min(f.window_index).label("lo"), func.max(f.window_index).label("hi"),
               func.max(f.created_at).label("last"))
        .where(f.session_id.in_(session_ids), f.participant_id.isnot(None))
        .group_by(f.session_id, f.participant_id, f.play_group_id)
    ).all()
    acc: dict[uuid.UUID, dict] = {}
    for r in rows:
        slot = acc.setdefault(r.session_id, {}).setdefault(
            r.participant_id, SimpleNamespace(received=0, legacy=0, missing=0, last=None))
        slot.received += _i(r.n)
        if r.play_group_id is None:
            slot.legacy += _i(r.n)
        else:
            slot.missing += max(_i(r.hi) - _i(r.lo) + 1 - _i(r.n), 0)
        if r.last is not None and (slot.last is None or _aware(r.last) > _aware(slot.last)):
            slot.last = r.last
    return acc


def _raw_bulk(db: DBSession, session_ids: list[uuid.UUID]) -> dict[uuid.UUID, dict]:
    r = EEGRawChunk
    done = r.upload_status == "uploaded"
    failed = r.upload_status == "failed"
    pending = r.upload_status.notin_(("uploaded", "failed"))
    rows = db.execute(
        select(
            r.session_id, r.participant_id, r.signal_type, r.stream_id, r.segment_id,
            func.count().label("n"), func.min(r.chunk_index).label("lo"), func.max(r.chunk_index).label("hi"),
            func.coalesce(func.sum(case((done, 1), else_=0)), 0).label("uploaded"),
            func.coalesce(func.sum(case((failed, 1), else_=0)), 0).label("failed"),
            func.coalesce(func.sum(case((pending, 1), else_=0)), 0).label("pending"),
            func.min(case((pending, r.created_at))).label("oldest_pending"),
            func.max(case((done, func.coalesce(r.uploaded_at, r.created_at)))).label("last"),
        )
        .where(r.session_id.in_(session_ids), r.participant_id.isnot(None))
        .group_by(r.session_id, r.participant_id, r.signal_type, r.stream_id, r.segment_id)
    ).all()
    acc: dict[uuid.UUID, dict] = {}
    for x in rows:
        slot = acc.setdefault(x.session_id, {}).setdefault(x.participant_id, {}).setdefault(
            x.signal_type, SimpleNamespace(registered=0, uploaded=0, failed=0, pending=0, missing=0,
                                           oldest_pending=None, last=None))
        slot.registered += _i(x.n)
        slot.uploaded += _i(x.uploaded)
        slot.failed += _i(x.failed)
        slot.pending += _i(x.pending)
        slot.missing += max(_i(x.hi) - _i(x.lo) + 1 - _i(x.n), 0)
        if x.oldest_pending is not None and (
                slot.oldest_pending is None or _aware(x.oldest_pending) < _aware(slot.oldest_pending)):
            slot.oldest_pending = x.oldest_pending
        if x.last is not None and (slot.last is None or _aware(x.last) > _aware(slot.last)):
            slot.last = x.last
    return acc


def _summarize(prows: list, fstats: dict, rstats: dict, as_of: datetime) -> dict:
    counts = {k: 0 for k in (*BADGES, "excluded")}
    band_not_connected = 0
    last: str | None = None
    for pr in prows:
        part = _build_participant(pr, fstats.get(pr.id), rstats.get(pr.id, {}), as_of)
        counts[part.status] += 1
        if part.collection_state == "eligible" and not part.band_connected:
            band_not_connected += 1
        for ts in (part.feature.last_received_at, part.raw.last_received_at):
            if ts is not None and (last is None or ts > last):
                last = ts
    return {"participants": len(prows), **counts, "band_not_connected": band_not_connected, "last_received_at": last}


def _badge(s: dict) -> str:
    for key in BADGES[:3]:
        if s[key] > 0:
            return key
    return "no_data"


def _ttl(status: str, ended_at: datetime | None, now_utc: datetime) -> float:
    if status == "in_progress":
        return TTL_LIVE_SEC
    ended = _aware(ended_at)
    if ended is not None and (now_utc - ended).total_seconds() <= POST_END_ACTIVE_SEC:
        return TTL_RECENT_SEC
    return TTL_OLD_SEC


def _summaries(db: DBSession, cands: list, as_of: datetime) -> dict[uuid.UUID, dict]:
    now = _monotonic()
    out: dict[uuid.UUID, dict] = {}
    miss: list[uuid.UUID] = []
    with _cache_lock:
        for c in cands:
            hit = _cache.get(c.session_id)
            if hit is not None and now - hit[0] < _ttl(c.status, c.ended_at, as_of):
                out[c.session_id] = hit[1]
            else:
                miss.append(c.session_id)
    if miss:
        pbulk = _participants_bulk(db, miss)
        fbulk = _feature_bulk(db, miss)
        rbulk = _raw_bulk(db, miss)
        fresh = {sid: _summarize(pbulk.get(sid, []), fbulk.get(sid, {}), rbulk.get(sid, {}), as_of) for sid in miss}
        out.update(fresh)
        with _cache_lock:
            if len(_cache) + len(fresh) >= _CACHE_MAX:
                _cache.clear()
            for sid, s in fresh.items():
                _cache[sid] = (now, s)
    return out


# ---------------------------------------------------------------------------
# 진입점
# ---------------------------------------------------------------------------

def _poll_interval(items: list[OverviewItem], as_of: datetime) -> int:
    if any(it.session_status == "in_progress" for it in items):
        return 3
    for it in items:
        ended = _aware(datetime.fromisoformat(it.ended_at.replace("Z", "+00:00"))) if it.ended_at else None
        if ended is None or (as_of - ended).total_seconds() > POST_END_ACTIVE_SEC:
            continue
        last = datetime.fromisoformat(it.last_received_at.replace("Z", "+00:00")) if it.last_received_at else None
        if it.uploading > 0 or (last is not None and (as_of - last).total_seconds() <= RECENT_RECEIVE_SEC):
            return 7
    return 60


def _etag(items: list[OverviewItem], total: int, limit: int) -> str:
    payload = json.dumps([[it.model_dump() for it in items], total, limit], sort_keys=True, ensure_ascii=False)
    return f'W/"{hashlib.sha256(payload.encode()).hexdigest()[:32]}"'


def load_overview(db: DBSession, actor: dict, *, limit: int = DEFAULT_LIMIT, since: str | None = None,
                  org_id: uuid.UUID | None = None, class_id: uuid.UUID | None = None,
                  status: str | None = None, if_none_match: str | None = None) -> OverviewResult:
    as_of = _utcnow()
    since_dt = parse_since(since, as_of)
    cands = _candidates(db, actor, since=since_dt, limit=limit, org_id=org_id, class_id=class_id)
    total = _i(cands[0].total) if cands else 0
    summaries = _summaries(db, cands, as_of) if cands else {}

    items: list[OverviewItem] = []
    for c in cands:
        s = summaries[c.session_id]
        badge = _badge(s)
        if status is not None and badge != status:
            continue
        items.append(OverviewItem(
            session_id=str(c.session_id), class_id=str(c.class_id), class_title=c.class_title,
            session_title=c.session_title, seq=c.seq,
            organization_id=str(c.organization_id) if c.organization_id else None,
            organization_name=c.organization_name, session_status=c.status,
            started_at=_iso(c.started_at), ended_at=_iso(c.ended_at),
            participants=s["participants"], needs_attention=s["needs_attention"], uploading=s["uploading"],
            received_unreconciled=s["received_unreconciled"], no_data=s["no_data"], excluded=s["excluded"],
            band_not_connected=s["band_not_connected"], last_received_at=s["last_received_at"], status=badge))

    etag = _etag(items, total, limit)
    poll = _poll_interval(items, as_of)
    if _matches(if_none_match, etag):
        return OverviewResult(etag, poll, None)
    counts = {k: sum(1 for it in items if it.status == k) for k in BADGES}
    body = UploadStatusOverviewResponse(
        as_of=_iso(as_of), poll_interval_sec=poll, etag=etag, since=_iso(since_dt), limit=limit,
        total_candidates=total, truncated=total > limit,
        summary=OverviewSummary(sessions=len(items),
                                in_progress=sum(1 for it in items if it.session_status == "in_progress"), **counts),
        items=items)
    return OverviewResult(etag, poll, body)
