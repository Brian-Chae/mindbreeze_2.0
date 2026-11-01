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
from sqlalchemy import and_, case, func, or_, select
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
from app.services import upload_metrics_service as metrics_svc
from app.services import upload_progress_service as progress_svc
from app.services.upload_status_service import (
    POST_END_ACTIVE_SEC,
    RECENT_RECEIVE_SEC,
    _Scope,
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
SCAN_BATCH = 50          # needs_attention_only: 한 배치에서 검사하는 회차 수
MAX_SCAN_BATCHES = 4     # needs_attention_only: 1요청 최대 배치 수
CANDIDATE_STATUSES = ("open", "in_progress", "completed")
BADGES = ("needs_attention", "uploading", "received_unreconciled", "no_data")
TTL_LIVE_SEC = 2.0
TTL_RECENT_SEC = 10.0
TTL_OLD_SEC = 300.0
_CACHE_MAX = 2048

_cache: dict[tuple[uuid.UUID, uuid.UUID | None], tuple[float, dict]] = {}
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


def keyset_after(grp, eff, sid, cur: tuple):
    """정렬 키 (그룹 asc, 유효시각 desc, id asc) 에서 `cur` 다음 행만 고르는 조건."""
    g0, e0, id0 = cur
    return or_(grp > g0, and_(grp == g0, eff < e0), and_(grp == g0, eff == e0, sid > id0))


def effective_time():
    return func.coalesce(Session.started_at, Session.scheduled_at, Session.created_at)


def group_key():
    return case((Session.status == "in_progress", 0), else_=1)


def _candidates(db: DBSession, actor: dict, *, since: datetime, limit: int, org_id: uuid.UUID | None,
                class_id: uuid.UUID | None, cursor: tuple | None = None) -> list:
    """권한 범위 + 정렬 + 상한 1 쿼리. `total` 은 cursor 적용 **전** 전체 후보 수(윈도 카운트)."""
    actor_id = uuid.UUID(str(actor["id"]))
    role = actor.get("role")
    if role not in ("platform_admin", "org_admin", "counselor"):
        raise _forbidden()
    if org_id is not None and role != "platform_admin":
        _check_org_filter(db, actor_id, role, org_id)

    eff = effective_time()
    base = (
        select(
            Session.id.label("session_id"), Session.class_id, Session.status, Session.started_at,
            Session.ended_at, Session.title.label("session_title"), Session.seq,
            Class.title.label("class_title"), Class.organization_id, Organization.name.label("organization_name"),
            group_key().label("grp"), eff.label("eff"), func.count().over().label("total"),
        )
        .join(Class, Class.id == Session.class_id)
        .outerjoin(Organization, Organization.id == Class.organization_id)
        .where(Session.hidden_at.is_(None), Class.hidden_at.is_(None), Session.is_template.is_(False),
               Session.status.in_(CANDIDATE_STATUSES), eff >= since)
    )
    if role == "org_admin":
        base = base.where(Class.organization_id.in_(_scope_orgs(actor_id, "org_admin")))
    elif role == "counselor":
        base = base.where(Class.organization_id.in_(_scope_orgs(actor_id, "counselor")),
                          Session.host_id == actor_id)
    if org_id is not None:
        base = base.where(Class.organization_id == org_id)
    if class_id is not None:
        base = base.where(Session.class_id == class_id)
    inner = base.subquery()
    stmt = select(inner).order_by(inner.c.grp.asc(), inner.c.eff.desc(), inner.c.session_id.asc()).limit(limit)
    if cursor is not None:
        stmt = stmt.where(keyset_after(inner.c.grp, inner.c.eff, inner.c.session_id, cursor))
    return db.execute(stmt).all()


# ---------------------------------------------------------------------------
# 본문 집계 (참여자 1 + feature 1 + raw 1)
# ---------------------------------------------------------------------------

def _participants_bulk(db: DBSession, session_ids: list[uuid.UUID], user_id: uuid.UUID | None = None) -> dict[uuid.UUID, list]:
    p = SessionParticipant
    stmt = (
        select(p.session_id, p.id, p.user_id, p.guest_name, User.name, p.is_waitlisted, p.band_connected,
               p.report_included, p.eeg_collection_consented)
        .outerjoin(User, User.id == p.user_id)
        .where(p.session_id.in_(session_ids), p.removed_at.is_(None), p.waitlist_cancelled_at.is_(None),
               p.superseded_by_participant_id.is_(None))
    )
    if user_id is not None:   # SDD-265: 회원 본인 행만
        stmt = stmt.where(p.user_id == user_id)
    rows = db.execute(stmt).all()
    out: dict[uuid.UUID, list] = {}
    for row in rows:
        out.setdefault(row.session_id, []).append(row)
    return out


def _feature_bulk(db: DBSession, session_ids: list[uuid.UUID], participant_ids: list | None = None) -> dict[uuid.UUID, dict]:
    f = EEGFeatureWindow
    stmt = (
        select(f.session_id, f.participant_id, f.play_group_id,
               func.count().label("n"), func.min(f.window_index).label("lo"), func.max(f.window_index).label("hi"),
               func.max(f.created_at).label("last"))
        .where(f.session_id.in_(session_ids), f.participant_id.isnot(None))
        .group_by(f.session_id, f.participant_id, f.play_group_id)
    )
    if participant_ids is not None:
        stmt = stmt.where(f.participant_id.in_(participant_ids))
    rows = db.execute(stmt).all()
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


def _raw_bulk(db: DBSession, session_ids: list[uuid.UUID], participant_ids: list | None = None) -> dict[uuid.UUID, dict]:
    r = EEGRawChunk
    done = r.upload_status == "uploaded"
    failed = r.upload_status == "failed"
    pending = r.upload_status.notin_(("uploaded", "failed"))
    stmt = (
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
    )
    if participant_ids is not None:
        stmt = stmt.where(r.participant_id.in_(participant_ids))
    rows = db.execute(stmt).all()
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


def _summarize(prows: list, fstats: dict, rstats: dict, as_of: datetime, expected: dict | None = None,
               scope: _Scope | None = None, bstats: dict | None = None) -> dict:
    counts = {k: 0 for k in (*BADGES, "excluded")}
    band_not_connected = 0
    last: str | None = None
    progresses = []
    pms = []
    parts = []
    for pr in prows:
        part = _build_participant(pr, fstats.get(pr.id), rstats.get(pr.id, {}), as_of,
                                  (expected or {}).get(pr.id), scope)
        parts.append(part)
        progresses.append(part.progress)
        pms.append(metrics_svc.participant_metrics(part, (bstats or {}).get(pr.id)))
        counts[part.status] += 1
        if part.collection_state == "eligible" and not part.band_connected:
            band_not_connected += 1
        for ts in (part.feature.last_received_at, part.raw.last_received_at):
            if ts is not None and (last is None or ts > last):
                last = ts
    roll = metrics_svc.rollup(pms)
    return {"participants": len(prows), **counts, "band_not_connected": band_not_connected, "last_received_at": last,
            "progress": progress_svc.aggregate(progresses), "rollup": roll, "_parts": parts, "_pms": pms}


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


def _summaries(db: DBSession, cands: list, as_of: datetime, user_id: uuid.UUID | None = None) -> dict[uuid.UUID, dict]:
    """회차별 요약(캐시 TTL 규칙). `user_id` 가 있으면 그 사람 한 명 기준(SDD-265 회원 경로, 캐시 키 분리)."""
    now = _monotonic()
    out: dict[uuid.UUID, dict] = {}
    miss: list[uuid.UUID] = []
    with _cache_lock:
        for c in cands:
            hit = _cache.get((c.session_id, user_id))
            if hit is not None and now - hit[0] < _ttl(c.status, c.ended_at, as_of):
                out[c.session_id] = hit[1]
            else:
                miss.append(c.session_id)
    if miss:
        pbulk = _participants_bulk(db, miss, user_id)
        pids = [r.id for rows in pbulk.values() for r in rows] if user_id is not None else None
        fbulk = _feature_bulk(db, miss, pids)
        rbulk = _raw_bulk(db, miss, pids)
        ebulk = progress_svc.load_expected_by_session(db, miss)   # SDD-264: 기대량 1회 일괄
        bbulk = metrics_svc.load_bytes_by_session(db, miss)       # SDD-265: 도착 크기 1회 일괄
        scopes = {c.session_id: _Scope(status=c.status, ended_at=c.ended_at) for c in cands}
        fresh = {sid: _summarize(pbulk.get(sid, []), fbulk.get(sid, {}), rbulk.get(sid, {}), as_of, ebulk,
                                 scopes[sid], bbulk.get(sid, {})) for sid in miss}
        out.update(fresh)
        with _cache_lock:
            if len(_cache) + len(fresh) >= _CACHE_MAX:
                _cache.clear()
            for sid, sm in fresh.items():
                _cache[(sid, user_id)] = (now, sm)
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


def _etag(items: list[OverviewItem], total: int, limit: int, next_cursor: str | None = None) -> str:
    payload = json.dumps([[it.model_dump() for it in items], total, limit, next_cursor], sort_keys=True,
                         ensure_ascii=False)
    return f'W/"{hashlib.sha256(payload.encode()).hexdigest()[:32]}"'


def make_item(c, s: dict, badge: str, as_of: datetime) -> OverviewItem:
    roll = s["rollup"]
    return OverviewItem(
        session_id=str(c.session_id), class_id=str(c.class_id), class_title=c.class_title,
        session_title=c.session_title, seq=c.seq,
        organization_id=str(c.organization_id) if c.organization_id else None,
        organization_name=c.organization_name, session_status=c.status,
        started_at=_iso(c.started_at), ended_at=_iso(c.ended_at),
        participants=s["participants"], needs_attention=s["needs_attention"], uploading=s["uploading"],
        received_unreconciled=s["received_unreconciled"], no_data=s["no_data"], excluded=s["excluded"],
        band_not_connected=s["band_not_connected"], last_received_at=s["last_received_at"], status=badge,
        progress=s["progress"],
        participants_expected=roll.participants_expected, participants_arrived=roll.participants_arrived,
        bytes_arrived=roll.bytes_arrived, bytes_expected=roll.bytes_expected, bytes_basis=roll.bytes_basis,
        duration_min=metrics_svc.duration_minutes(c.started_at, c.ended_at, c.status, as_of),
        participant_minutes_total=roll.participant_minutes_total)


def _cursor_of(c) -> str:
    return metrics_svc.encode_cursor(int(c.grp), c.eff, c.session_id)


def _parse_cursor(raw: str | None):
    if raw is None or raw == "":
        return None
    try:
        return metrics_svc.decode_cursor(raw)
    except ValueError:
        raise HTTPException(422, detail={"code": "upload_status_invalid_cursor"})


def _page_plain(db, actor, *, as_of, since_dt, limit, org_id, class_id, cursor, status):
    """일반 페이지: limit+1 건을 읽어 has_more 를 정하고 limit 개로 자른다."""
    rows = _candidates(db, actor, since=since_dt, limit=limit + 1, org_id=org_id, class_id=class_id, cursor=cursor)
    total = _i(rows[0].total) if rows else 0
    has_more = len(rows) > limit
    cands = rows[:limit]
    summaries = _summaries(db, cands, as_of) if cands else {}
    items = []
    for c in cands:
        badge = _badge(summaries[c.session_id])
        if status is not None and badge != status:
            continue
        items.append(make_item(c, summaries[c.session_id], badge, as_of))
    return items, total, (_cursor_of(cands[-1]) if has_more else None), False


def _page_attention(db, actor, *, as_of, since_dt, limit, org_id, class_id, cursor):
    """확인할 곳 우선: 배지 needs_attention 회차만, 앞으로 훑어 limit 개를 채운다(배치 ≤ MAX_SCAN_BATCHES)."""
    matched: list[tuple] = []
    total = 0
    last_scanned = None
    exhausted = False
    for _ in range(MAX_SCAN_BATCHES):
        batch = _candidates(db, actor, since=since_dt, limit=SCAN_BATCH, org_id=org_id, class_id=class_id,
                            cursor=cursor)
        if batch:
            total = _i(batch[0].total) if not total else total
            summaries = _summaries(db, batch, as_of)
            for c in batch:
                if _badge(summaries[c.session_id]) == "needs_attention":
                    matched.append((c, summaries[c.session_id]))
            last_scanned = batch[-1]
            cursor = (int(last_scanned.grp), metrics_svc._aware(last_scanned.eff), last_scanned.session_id)
        if len(batch) < SCAN_BATCH:
            exhausted = True
            break
        if len(matched) > limit:
            break
    if len(matched) > limit:
        keep = matched[:limit]
        items = [make_item(c, sm, "needs_attention", as_of) for c, sm in keep]
        return items, total, _cursor_of(keep[-1][0]), False
    items = [make_item(c, sm, "needs_attention", as_of) for c, sm in matched]
    if exhausted or last_scanned is None:
        return items, total, None, False
    return items, total, _cursor_of(last_scanned), True    # 스캔 상한에서 멈춤: 이어서 조회


def load_overview(db: DBSession, actor: dict, *, limit: int = DEFAULT_LIMIT, since: str | None = None,
                  org_id: uuid.UUID | None = None, class_id: uuid.UUID | None = None,
                  status: str | None = None, if_none_match: str | None = None,
                  cursor: str | None = None, needs_attention_only: bool = False) -> OverviewResult:
    if needs_attention_only and status is not None:
        raise HTTPException(422, detail={"code": "upload_status_filter_conflict"})
    as_of = _utcnow()
    since_dt = parse_since(since, as_of)
    cur = _parse_cursor(cursor)
    if needs_attention_only:
        items, total, next_cursor, scan_limited = _page_attention(
            db, actor, as_of=as_of, since_dt=since_dt, limit=limit, org_id=org_id, class_id=class_id, cursor=cur)
    else:
        items, total, next_cursor, scan_limited = _page_plain(
            db, actor, as_of=as_of, since_dt=since_dt, limit=limit, org_id=org_id, class_id=class_id, cursor=cur,
            status=status)

    etag = _etag(items, total, limit, next_cursor)
    poll = _poll_interval(items, as_of)
    if _matches(if_none_match, etag):
        return OverviewResult(etag, poll, None)
    counts = {k: sum(1 for it in items if it.status == k) for k in BADGES}
    body = UploadStatusOverviewResponse(
        as_of=_iso(as_of), poll_interval_sec=poll, etag=etag, since=_iso(since_dt), limit=limit,
        total_candidates=total, truncated=total > limit,
        summary=OverviewSummary(sessions=len(items),
                                in_progress=sum(1 for it in items if it.session_status == "in_progress"), **counts),
        items=items, progress=progress_svc.merge([it.progress for it in items]),
        next_cursor=next_cursor, has_more=next_cursor is not None, scan_limited=scan_limited)
    return OverviewResult(etag, poll, body)
