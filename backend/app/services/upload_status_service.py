"""SDD-261 BE-1 — 회차 참여자별 서버 수신(저장·업로드) 현황 집계.

- 서버가 받은 것만 센다(`basis=server_received`). 기대 수·폰 대기량·완료 판정은 하지 않는다(null/unknown 고정).
- 수집 경로(live_ingest 등)는 건드리지 않는 읽기 전용 집계다.
- SQL 횟수는 인원수와 무관: 권한 1 + revision 1(=304 경로) + 본문 계산 시 참여자 1 + feature 1 + raw 1.
- 계약 정본: specs/sdd-261-upload-status-screens/contract.md
"""

from __future__ import annotations

import hashlib
import threading
import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import and_, case, exists, func, or_, select
from sqlalchemy.exc import InvalidRequestError
from sqlalchemy.orm import Session as DBSession

from app.config import settings
from app.models.biosignal import BiosignalArtifact
from app.models.class_program import Class
from app.models.eeg_feature import EEGFeatureWindow
from app.models.organization import Organization
from app.models.record import EEGRawChunk
from app.models.biosignal import BiosignalGapEvent
from app.models.session import Session, SessionBandDevice, SessionParticipant
from app.models.user import User
from app.models.user_org_membership import UserOrgMembership
from app.models.session_ingest_expected import SessionIngestExpected
from app.services import upload_metrics_service as metrics_svc
from app.services import upload_progress_service as progress_svc
from app.schemas.upload_status import (
    FeatureReceipt,
    PhoneReport,
    RawReceipt,
    RawSignalReceipt,
    UploadStatusParticipant,
    UploadStatusResponse,
    UploadStatusSummary,
)

SIGNALS = ("eeg", "ppg", "acc")
PENDING_STALE_SEC = 60
RECENT_RECEIVE_SEC = 90
POST_END_ACTIVE_SEC = 30 * 60
CACHE_TTL_SEC = 1.0
_CACHE_MAX = 512

_cache: dict[tuple[uuid.UUID, uuid.UUID], tuple[float, "UploadStatusResult"]] = {}
_cache_lock = threading.Lock()


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def _monotonic() -> float:
    return time.monotonic()


def clear_cache() -> None:
    with _cache_lock:
        _cache.clear()


def _aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def _iso(dt: datetime | None) -> str | None:
    dt = _aware(dt)
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ") if dt is not None else None


def _i(value) -> int:
    return int(value or 0)


@dataclass(frozen=True)
class UploadStatusResult:
    etag: str
    poll_interval_sec: int
    body: UploadStatusResponse | None  # None = If-None-Match 일치(304)


@dataclass(frozen=True)
class _Scope:
    status: str
    ended_at: datetime | None
    started_at: datetime | None = None   # SDD-265: 측정 길이 계산용


# ---------------------------------------------------------------------------
# 권한 (1 쿼리)
# ---------------------------------------------------------------------------

def _authorize(db: DBSession, actor: dict, class_id: uuid.UUID, session_id: uuid.UUID) -> _Scope:
    """401 은 get_current_user 가 처리한다. 존재 비공개는 404, 역할 부족은 403."""
    actor_id = uuid.UUID(str(actor["id"]))

    def member_of_class_org(role: str):
        return exists().where(
            UserOrgMembership.user_id == actor_id,
            UserOrgMembership.org_id == Class.organization_id,
            UserOrgMembership.role == role,
            UserOrgMembership.status == "active",
            UserOrgMembership.user_id == User.id,
            User.status == "active",
            Organization.id == UserOrgMembership.org_id,
            Organization.deactivated_at.is_(None),
        )

    actor_active = exists().where(User.id == actor_id, User.status == "active")
    row = db.execute(
        select(
            Session.status, Session.ended_at, Session.started_at, Session.host_id,
            member_of_class_org("org_admin").label("is_org_admin"),
            member_of_class_org("counselor").label("is_counselor"),
            actor_active.label("actor_active"),
        )
        .join(Class, Class.id == Session.class_id)
        .where(Session.id == session_id, Class.id == class_id,
               Session.hidden_at.is_(None), Class.hidden_at.is_(None))
    ).first()
    if row is None:
        raise HTTPException(404, detail={"code": "upload_status_not_found"})
    if not row.actor_active:
        raise HTTPException(403, detail={"code": "upload_status_forbidden"})
    role = actor.get("role")
    if role == "platform_admin":
        pass
    elif role == "org_admin":
        if not row.is_org_admin:
            raise HTTPException(404, detail={"code": "upload_status_not_found"})
    elif role == "counselor":
        if not row.is_counselor:
            raise HTTPException(404, detail={"code": "upload_status_not_found"})
        if row.host_id != actor_id:
            raise HTTPException(403, detail={"code": "upload_status_forbidden"})
    else:
        raise HTTPException(403, detail={"code": "upload_status_forbidden"})
    return _Scope(status=row.status, ended_at=row.ended_at, started_at=row.started_at)


# ---------------------------------------------------------------------------
# revision (1 쿼리) — 변경 지문 + 폴링 주기 입력
# ---------------------------------------------------------------------------

def _revision(db: DBSession, session_id: uuid.UUID, as_of: datetime) -> dict:
    cutoff = as_of - timedelta(seconds=PENDING_STALE_SEC)
    f, r, p, E = EEGFeatureWindow, EEGRawChunk, SessionParticipant, SessionIngestExpected
    not_done = r.upload_status.notin_(("uploaded", "failed"))

    def fscalar(expr):
        return select(expr).where(f.session_id == session_id).scalar_subquery()

    def rscalar(expr):
        return select(expr).where(r.session_id == session_id).scalar_subquery()

    def pscalar(expr):
        return select(expr).where(p.session_id == session_id, p.removed_at.is_(None),
                                  p.waitlist_cancelled_at.is_(None),
                                  p.superseded_by_participant_id.is_(None)).scalar_subquery()

    def flag(col):
        return func.coalesce(func.sum(case((col.is_(True), 1), else_=0)), 0)

    row = db.execute(select(
        fscalar(func.count()).label("f_count"),
        fscalar(func.max(f.created_at)).label("f_max"),
        rscalar(func.count()).label("r_count"),
        rscalar(func.coalesce(func.sum(case((r.upload_status == "uploaded", 1), else_=0)), 0)).label("r_up"),
        rscalar(func.coalesce(func.sum(case((r.upload_status == "failed", 1), else_=0)), 0)).label("r_fail"),
        rscalar(func.max(r.created_at)).label("r_created_max"),
        rscalar(func.max(r.uploaded_at)).label("r_up_max"),
        rscalar(func.coalesce(func.sum(case((not_done, 1), else_=0)), 0)).label("r_pending"),
        rscalar(func.coalesce(func.sum(case((and_(not_done, r.created_at <= cutoff), 1), else_=0)), 0)).label("r_stale"),
        pscalar(func.count()).label("p_count"),
        pscalar(flag(p.band_connected)).label("p_band"),
        pscalar(flag(p.report_included)).label("p_report"),
        pscalar(flag(p.is_waitlisted)).label("p_wait"),
        pscalar(func.coalesce(func.sum(case((p.eeg_collection_consented.is_(True), 1),
                                            (p.eeg_collection_consented.is_(False), 2), else_=0)), 0)).label("p_consent"),
        # SDD-264: 기대량 보고 지문 — 보고만 바뀌어도 ETag 가 바뀐다.
        select(func.count()).where(E.session_id == session_id).scalar_subquery().label("e_count"),
        select(func.max(E.updated_at)).where(E.session_id == session_id).scalar_subquery().label("e_max"),
        select(func.coalesce(func.sum(E.feature + func.coalesce(E.raw_eeg, 0) + func.coalesce(E.raw_ppg, 0)
                                      + func.coalesce(E.raw_acc, 0)), 0)).where(E.session_id == session_id)
        .scalar_subquery().label("e_sum"),
        select(func.coalesce(func.sum(case((E.final.is_(True), 1), else_=0)), 0))
        .where(E.session_id == session_id).scalar_subquery().label("e_final"),
        # SDD-265: 도착 크기 지문 — 바이트만 바뀌어도 ETag 가 바뀐다.
        rscalar(func.coalesce(func.sum(case((r.upload_status == "uploaded", func.coalesce(r.size_bytes, 0)),
                                            else_=0)), 0)).label("r_bytes"),
        select(func.coalesce(func.sum(BiosignalArtifact.size_bytes), 0))
        .where(BiosignalArtifact.session_id == session_id, BiosignalArtifact.upload_status == "uploaded")
        .scalar_subquery().label("a_bytes"),
    )).one()
    return dict(row._mapping)


def _progress_time_key(rev: dict, scope: _Scope, as_of: datetime) -> str | None:
    """SDD-264: 정체(120초)·종료 30분 유예는 시간 경과로 판정이 바뀌므로, 기대량이 보고된 활성 구간에서만
    30초 버킷을 ETag 에 넣는다(조용한 완료 회차는 304 유지). 유예 경과는 불리언으로 별도 반영."""
    if not _i(rev["e_count"]):
        return None
    ended = _aware(scope.ended_at)
    since_end = (as_of - ended).total_seconds() if ended is not None else None
    grace_over = since_end is not None and since_end >= POST_END_ACTIVE_SEC
    active = scope.status != "completed" or since_end is None or since_end < POST_END_ACTIVE_SEC + 600
    bucket = int(as_of.timestamp() // 30) if active else "-"
    pending_after = since_end is not None and since_end >= progress_svc.FINAL_PENDING_AFTER_END_SEC   # SDD-267
    return f"{bucket}:{int(grace_over)}:{int(pending_after)}"


def _abnormal_over(scope: _Scope, as_of: datetime) -> int:
    """SDD-278: 종료 후 기한(24h) 경과 여부. 폰 보고가 없는 회차도 기한 시점에 ETag 가 바뀌어야 304 로 고착되지 않는다."""
    ended = _aware(scope.ended_at)
    return int(scope.status == "completed" and ended is not None
               and (as_of - ended).total_seconds() >= settings.upload_abnormal_exit_after_sec)


def _etag(rev: dict, scope: _Scope, as_of: datetime | None = None) -> str:
    parts = [rev["f_count"], _iso(rev["f_max"]), rev["r_count"], rev["r_up"], rev["r_fail"], _iso(rev["r_created_max"]),
             _iso(rev["r_up_max"]), rev["r_pending"], rev["r_stale"], rev["p_count"], rev["p_band"], rev["p_report"],
             rev["p_wait"], rev["p_consent"], rev["e_count"], _iso(rev["e_max"]), rev["e_sum"], rev["e_final"], rev["r_bytes"], rev["a_bytes"],
             scope.status, _iso(scope.ended_at), _progress_time_key(rev, scope, as_of) if as_of else None,
             _abnormal_over(scope, as_of) if as_of else None]
    digest = hashlib.sha256("|".join("" if v is None else str(v) for v in parts).encode()).hexdigest()[:32]
    return f'W/"{digest}"'


def _poll_interval(scope: _Scope, rev: dict, as_of: datetime) -> int:
    status = scope.status
    if status == "in_progress":
        return 3
    if status == "open":
        return 5
    if status == "cancelled":
        return 60
    if status != "completed":
        return 10
    ended = _aware(scope.ended_at)
    if ended is None or (as_of - ended).total_seconds() > POST_END_ACTIVE_SEC:
        return 60
    last = max([t for t in (_aware(rev["f_max"]), _aware(rev["r_up_max"])) if t is not None], default=None)
    recent = last is not None and (as_of - last).total_seconds() <= RECENT_RECEIVE_SEC
    return 7 if _i(rev["r_pending"]) > 0 or recent else 60


# ---------------------------------------------------------------------------
# 본문 집계 (3 쿼리)
# ---------------------------------------------------------------------------

def _gap(index_col, *partition):
    """같은 stream 안 이웃 index 사이의 빈 칸 수(index - 이전 index - 1). 첫 행은 NULL."""
    return index_col - func.lag(index_col).over(partition_by=partition, order_by=index_col) - 1


def _participants(db: DBSession, session_id: uuid.UUID) -> list:
    p = SessionParticipant
    return db.execute(
        select(p.id, p.user_id, p.guest_name, User.name, p.is_waitlisted, p.band_connected, p.report_included,
               p.eeg_collection_consented, p.linkband_device_id.label("band_serial"),
               SessionBandDevice.firmware.label("band_firmware"),
               select(func.count()).select_from(BiosignalGapEvent)
               .where(BiosignalGapEvent.participant_id == p.id).correlate(p).scalar_subquery().label("band_gap_count"))
        .outerjoin(User, User.id == p.user_id)
        # SDD-326: 현재 기기의 펌웨어(참가자×시리얼 UNIQUE 라 행 중복 없음, 쿼리 수 증가 0)
        .outerjoin(SessionBandDevice, and_(SessionBandDevice.participant_id == p.id,
                                           SessionBandDevice.serial == p.linkband_device_id))
        .where(p.session_id == session_id, p.removed_at.is_(None), p.waitlist_cancelled_at.is_(None),
               p.superseded_by_participant_id.is_(None))
    ).all()


def _feature_stats(db: DBSession, session_id: uuid.UUID) -> dict:
    f = EEGFeatureWindow
    gap = _gap(f.window_index, f.participant_id, f.play_group_id).label("gap")
    inner = (
        select(f.participant_id, f.play_group_id, f.created_at, gap)
        .where(f.session_id == session_id, f.participant_id.isnot(None))
        .subquery()
    )
    rows = db.execute(
        select(
            inner.c.participant_id,
            func.count().label("received"),
            func.coalesce(func.sum(case((inner.c.play_group_id.is_(None), 1), else_=0)), 0).label("legacy"),
            func.coalesce(func.sum(case((and_(inner.c.play_group_id.isnot(None), inner.c.gap > 0), inner.c.gap),
                                        else_=0)), 0).label("missing"),
            func.max(inner.c.created_at).label("last"),
        ).group_by(inner.c.participant_id)
    ).all()
    return {r.participant_id: r for r in rows}


def _raw_stats(db: DBSession, session_id: uuid.UUID) -> dict:
    r = EEGRawChunk
    gap = _gap(r.chunk_index, r.participant_id, r.signal_type, r.stream_id, r.segment_id).label("gap")
    inner = (
        select(r.participant_id, r.signal_type, r.upload_status, r.created_at, r.uploaded_at, gap)
        .where(r.session_id == session_id, r.participant_id.isnot(None))
        .subquery()
    )
    done = inner.c.upload_status == "uploaded"
    failed = inner.c.upload_status == "failed"
    pending = inner.c.upload_status.notin_(("uploaded", "failed"))
    rows = db.execute(
        select(
            inner.c.participant_id, inner.c.signal_type,
            func.count().label("registered"),
            func.coalesce(func.sum(case((done, 1), else_=0)), 0).label("uploaded"),
            func.coalesce(func.sum(case((failed, 1), else_=0)), 0).label("failed"),
            func.coalesce(func.sum(case((pending, 1), else_=0)), 0).label("pending"),
            func.coalesce(func.sum(case((inner.c.gap > 0, inner.c.gap), else_=0)), 0).label("missing"),
            func.min(case((pending, inner.c.created_at))).label("oldest_pending"),
            func.max(case((done, func.coalesce(inner.c.uploaded_at, inner.c.created_at)))).label("last"),
        ).group_by(inner.c.participant_id, inner.c.signal_type)
    ).all()
    out: dict = {}
    for row in rows:
        out.setdefault(row.participant_id, {})[row.signal_type] = row
    return out


def _build_participant(prow, fstat, rstats: dict, as_of: datetime, expected_row=None,
                       scope: _Scope | None = None) -> UploadStatusParticipant:
    waitlisted = bool(prow.is_waitlisted)
    consent = prow.eeg_collection_consented
    collection = "excluded" if (waitlisted or consent is False) else ("eligible" if consent is True else "unknown")

    feature = FeatureReceipt(
        received=_i(fstat.received) if fstat else 0,
        legacy_count=_i(fstat.legacy) if fstat else 0,
        internal_missing=_i(fstat.missing) if fstat else 0,
        last_received_at=_iso(fstat.last) if fstat else None,
    )
    signals: list[RawSignalReceipt] = []
    raw_last: datetime | None = None
    failed = pending = registered = uploaded = raw_missing = 0
    stale = False
    for name in SIGNALS:
        s = rstats.get(name)
        if s is None:
            signals.append(RawSignalReceipt(signal_type=name, registered=0, uploaded=0, pending=0, failed=0,
                                            internal_missing=0, oldest_pending_at=None))
            continue
        signals.append(RawSignalReceipt(
            signal_type=name, registered=_i(s.registered), uploaded=_i(s.uploaded), pending=_i(s.pending),
            failed=_i(s.failed), internal_missing=_i(s.missing), oldest_pending_at=_iso(s.oldest_pending)))
        registered += _i(s.registered)
        uploaded += _i(s.uploaded)
        failed += _i(s.failed)
        pending += _i(s.pending)
        raw_missing += _i(s.missing)
        oldest = _aware(s.oldest_pending)
        if oldest is not None and (as_of - oldest).total_seconds() >= PENDING_STALE_SEC:
            stale = True
        last = _aware(s.last)
        if last is not None and (raw_last is None or last > raw_last):
            raw_last = last

    reasons: list[str] = []
    if failed > 0:
        reasons.append("raw_failed")
    if feature.internal_missing > 0:
        reasons.append("feature_internal_gap")
    if raw_missing > 0:
        reasons.append("raw_internal_gap")
    if stale:
        reasons.append("raw_pending_stale")

    has_data = feature.received > 0 or registered > 0
    if reasons:
        status = "needs_attention"
    elif collection == "excluded" and not has_data:
        status = "excluded"
        reasons = ["waitlisted" if waitlisted else "collection_excluded"]
    elif pending > 0:
        status, reasons = "uploading", ["raw_pending"]
    elif feature.received > 0 or uploaded > 0:
        status = "received_unreconciled"
    else:
        status = "no_data"
    if has_data and waitlisted:
        reasons.append("waitlisted_now")
    elif has_data and collection == "excluded":
        reasons.append("collection_excluded_now")

    # SDD-264: 폰 보고 기대량 대비 수신 — 기존 status/reasons 는 건드리지 않고 병렬 블록으로 채운다.
    snap = progress_svc.snapshot_of(expected_row)
    feature_last = _aware(fstat.last) if fstat and fstat.last else None
    last_any = max([t for t in (feature_last, raw_last) if t is not None], default=None)
    progress = progress_svc.build_participant_progress(progress_svc.ProgressInput(
        excluded=collection == "excluded", has_data=has_data, expected=snap,
        feature_received=feature.received,
        raw_received={s.signal_type: s.uploaded for s in signals}, raw_failed=failed,
        last_received_at=last_any,
        session_status=scope.status if scope else "in_progress", ended_at=scope.ended_at if scope else None,
        as_of=as_of, abnormal_after_sec=settings.upload_abnormal_exit_after_sec))
    phone_report = None
    if snap is not None:
        feature.expected = snap.feature
        feature.expected_basis = "phone_report"
        feature.completeness = "all_received" if feature.received >= snap.feature else "short"
        for s in signals:
            s.expected = snap.raw.get(s.signal_type)
        if all(s.expected is not None for s in signals):
            raw_complete = all(s.uploaded >= s.expected for s in signals)
            raw_completeness = "all_received" if raw_complete else "short"
        else:
            raw_completeness = "unknown"
        phone_report = PhoneReport(reported_at=_iso(expected_row.reported_at), final=snap.final)
    else:
        raw_completeness = "unknown"

    return UploadStatusParticipant(
        participant_id=str(prow.id),
        display_name=(prow.name or prow.guest_name or None) if prow.user_id else (prow.guest_name or None),
        is_guest=prow.user_id is None,
        participation_status="waitlisted" if waitlisted else "active",
        collection_state=collection,
        band_connected=bool(prow.band_connected),
        report_included=bool(prow.report_included),
        feature=feature,
        raw=RawReceipt(signals=signals, last_received_at=_iso(raw_last), completeness=raw_completeness),
        phone_report=phone_report,
        status=status,
        reasons=reasons,
        progress=progress,
        # 개요 목록(_participants_bulk)의 행에는 없는 열 — 없으면 None
        band_serial=getattr(prow, "band_serial", None),
        band_firmware=getattr(prow, "band_firmware", None),
        band_gap_count=getattr(prow, "band_gap_count", None),
    )


def _compute_body(db: DBSession, class_id: uuid.UUID, session_id: uuid.UUID, scope: _Scope, as_of: datetime,
                  etag: str, poll: int) -> UploadStatusResponse:
    prows = _participants(db, session_id)
    fstats = _feature_stats(db, session_id)
    rstats = _raw_stats(db, session_id)
    expected = progress_svc.load_expected_by_session(db, [session_id])
    bstats = metrics_svc.load_bytes_by_session(db, [session_id]).get(session_id, {})   # SDD-265
    items = [_build_participant(pr, fstats.get(pr.id), rstats.get(pr.id, {}), as_of, expected.get(pr.id), scope)
             for pr in prows]
    pms = []
    for pr, it in zip(prows, items):
        pm = metrics_svc.participant_metrics(it, bstats.get(pr.id))
        it.bytes_arrived = pm.bytes_arrived
        it.measured_min = pm.windows // 60
        pms.append(pm)
    roll = metrics_svc.rollup(pms)
    items.sort(key=lambda it: it.participant_id)
    counts = {k: 0 for k in ("needs_attention", "uploading", "received_unreconciled", "no_data", "excluded")}
    for it in items:
        counts[it.status] += 1
    return UploadStatusResponse(
        class_id=str(class_id), session_id=str(session_id), session_status=scope.status, as_of=_iso(as_of),
        poll_interval_sec=poll, etag=etag,
        summary=UploadStatusSummary(participants=len(items), **counts), participants=items,
        progress=progress_svc.aggregate([it.progress for it in items]),
        participants_expected=roll.participants_expected, participants_arrived=roll.participants_arrived,
        bytes_arrived=roll.bytes_arrived, bytes_expected=roll.bytes_expected, bytes_basis=roll.bytes_basis,
        duration_min=metrics_svc.duration_minutes(scope.started_at, scope.ended_at, scope.status, as_of),
        participant_minutes_total=roll.participant_minutes_total,
    )


@contextmanager
def _consistent_read(db: DBSession):
    """PostgreSQL 에서는 read-only REPEATABLE READ 한 트랜잭션으로 revision·본문을 같은 스냅샷에서 읽는다.

    권한 확인 트랜잭션을 먼저 끝낸 뒤 시작한다. 외부에서 트랜잭션을 관리하는 세션(시험 하네스 등)이면 기본 격리로 폴백한다.
    """
    if db.get_bind().dialect.name != "postgresql":
        yield
        return
    try:
        db.rollback()
        db.connection(execution_options={"isolation_level": "REPEATABLE READ", "postgresql_readonly": True})
    except InvalidRequestError:
        yield
        return
    try:
        yield
    finally:
        db.rollback()


def _matches(if_none_match: str | None, etag: str) -> bool:
    if not if_none_match:
        return False
    if if_none_match.strip() == "*":
        return True
    weak = lambda v: v.strip().removeprefix("W/")  # noqa: E731
    return any(weak(token) == weak(etag) for token in if_none_match.split(","))


# ---------------------------------------------------------------------------
# 진입점
# ---------------------------------------------------------------------------

def load_upload_status(db: DBSession, actor: dict, class_id: uuid.UUID, session_id: uuid.UUID,
                       if_none_match: str | None = None) -> UploadStatusResult:
    """권한 확인(캐시 앞) → 1초 TTL 캐시 → revision(304 판정) → 본문 계산."""
    scope = _authorize(db, actor, class_id, session_id)
    key = (class_id, session_id)
    now = _monotonic()
    with _cache_lock:
        hit = _cache.get(key)
    if hit is not None and now - hit[0] < CACHE_TTL_SEC:
        cached = hit[1]
        return UploadStatusResult(cached.etag, cached.poll_interval_sec,
                                  None if _matches(if_none_match, cached.etag) else cached.body)

    as_of = _utcnow()
    with _consistent_read(db):
        rev = _revision(db, session_id, as_of)
        etag = _etag(rev, scope, as_of)
        poll = _poll_interval(scope, rev, as_of)
        if _matches(if_none_match, etag):
            return UploadStatusResult(etag, poll, None)
        body = _compute_body(db, class_id, session_id, scope, as_of, etag, poll)
    result = UploadStatusResult(etag, poll, body)
    if CACHE_TTL_SEC > 0:
        with _cache_lock:
            if len(_cache) >= _CACHE_MAX:
                for stale_key in [k for k, (ts, _) in _cache.items() if now - ts >= CACHE_TTL_SEC]:
                    _cache.pop(stale_key, None)
                if len(_cache) >= _CACHE_MAX:
                    _cache.clear()
            _cache[key] = (now, result)
    return result


def get_upload_status(db: DBSession, actor: dict, class_id: uuid.UUID, session_id: uuid.UUID) -> UploadStatusResponse:
    result = load_upload_status(db, actor, class_id, session_id)
    assert result.body is not None
    return result.body
