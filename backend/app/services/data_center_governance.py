"""SDD-243 동의·보관·표준 데이터 읽기 투영(B03). 모든 함수는 **읽기 전용**이다.

- GET 에서 `run_retention_sweep`(dry_run 포함)을 호출하지 않는다. 그 함수는 실행 이력 행을 쓰기 때문이다.
  삭제 후보는 같은 규칙(세션 종료일 + RETENTION_RAW_DAYS, 연구 동의 게이트)을 순수 쿼리로 평가한다.
- 저장된 report/오류/키/경로는 allowlist 투영만 내보낸다. 연구 동의는 사용자·참여자 ID 와 역연결되지 않는다.
- 244 소유 파일(retention_sweep_service 등)은 수정하지 않는다. 규칙 상수는 복제하고 드리프트 테스트로 묶는다.
"""
import hashlib
import re
from datetime import datetime, timedelta
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.orm import Session as DBSession

from app.config import settings
from app.models.account_deletion import AccountDeletionLedger, AccountDeletionObject, AccountDeletionRequest
from app.models.normalization_baseline import NormalizationBaseline
from app.models.research import ResearchConsent
from app.models.research_export import ResearchExportBatch
from app.models.retention_sweep_run import RetentionSweepRun
from app.models.session import Session, SessionParticipant
from app.schemas import data_center as dc
from app.services.data_center_policy import ResolvedContext, aware, deny, not_found, require_platform, scoped_participants, \
    scoped_sessions
from app.services.data_center_query import (SESSION_TIME, filters_hash, kst_range, measure_stats, now, page, paginate)
from app.services.recording_consent_service import eeg_export_consent_clause, eeg_export_consented

# retention_sweep_service 의 규칙을 복제(드리프트 테스트로 동일성 검증)
NO_GATE_STATES = ('acked', 'withdrawn', 'blocked_withdrawn', 'not_applicable')
TARGET_STATUSES = ('completed', 'cancelled')
NEAR_DUE_DAYS = 7


def ref(prefix: str, value: object) -> str:
    """원 ID 를 노출하지 않는 단방향 참조(역연결 금지)."""
    return f'{prefix}-' + hashlib.sha256(f'dc-ref|{value}'.encode()).hexdigest()[:12]


def _count(value: object) -> dc.Count:
    return dc.Count(value=value) if isinstance(value, int) and not isinstance(value, bool) else \
        dc.Count(value=None, unavailable_reason='미확인')


def _range(q, col, query: dc.DataCenterQuery):
    start, end = kst_range(query.date_from, query.date_to)
    if start:
        q = q.filter(col >= start)
    if end:
        q = q.filter(col < end)
    return q


# ── #8 동의 ─────────────────────────────────────────────────────────────

def list_consents(db: DBSession, context: ResolvedContext, query: dc.DataCenterQuery, kind: str = 'collection'):
    if kind not in ('collection', 'research'):
        raise deny(422, 'kind_invalid', 'kind 는 collection 또는 research 입니다')
    flt = filters_hash(context, 'consents', query, kind=kind)
    if kind == 'research':
        if not context.is_platform:
            raise deny(403, 'research_forbidden', '연구 동의 현황은 플랫폼 관리자만 조회할 수 있습니다')
        sess_ids = scoped_sessions(db, context).with_entities(Session.id).statement
        q = db.query(ResearchConsent).filter(ResearchConsent.session_id.in_(sess_ids))
        if query.status == 'withdrawn':
            q = q.filter(ResearchConsent.withdrawn_at.isnot(None))
        elif query.status == 'agreed':
            q = q.filter(ResearchConsent.consented.is_(True), ResearchConsent.withdrawn_at.is_(None))
        elif query.status == 'none':
            q = q.filter(ResearchConsent.consented.is_(False), ResearchConsent.withdrawn_at.is_(None))
        q = _range(q, func.coalesce(ResearchConsent.consented_at, ResearchConsent.created_at), query)
        total = q.count()
        rows, nxt, as_of = paginate(q, func.coalesce(ResearchConsent.consented_at, ResearchConsent.created_at),
                                    ResearchConsent.id, query, flt, desc=query.sort != 'time_asc')
        items = [dc.ConsentItem(
            scope='research', session_id=c.session_id, participant_id=None, subject_ref=ref('R', c.id),
            notice_version=c.notice_version,
            state='withdrawn' if c.withdrawn_at else ('agreed' if c.consented else 'none'),
            at=aware(c.consented_at or c.created_at), export_state=c.export_state) for c, _ in rows]
        return page(items, nxt, total, as_of, flt)
    q = scoped_participants(db, context).join(Session, Session.id == SessionParticipant.session_id)
    if query.status == 'agreed':
        q = q.filter(eeg_export_consent_clause())
    elif query.status == 'none':
        q = q.filter(~eeg_export_consent_clause())
    q = _range(q, SESSION_TIME, query)
    total = q.count()
    rows, nxt, as_of = paginate(q, SESSION_TIME, SessionParticipant.id, query, flt, desc=query.sort != 'time_asc')
    stats = measure_stats(db, [p.id for p, _ in rows])
    items = [dc.ConsentItem(
        scope='collection', session_id=p.session_id, participant_id=p.id, subject_ref=ref('P', p.id),
        notice_version=None, state='agreed' if eeg_export_consented(p, has_data=stats[p.id].has_data) else 'none', at=aware(p.joined_at)) for p, _ in rows]
    return page(items, nxt, total, as_of, flt)


# ── #9~10 연구 배치 ─────────────────────────────────────────────────────

def _batch_error(raw: str | None) -> str | None:
    """원문 오류를 분류 코드로만 투영한다(경로·버킷·키 노출 금지)."""
    if not raw:
        return None
    low = raw.lower()
    if 'accessdenied' in low or '403' in low:
        return 'storage_denied'
    if 'timeout' in low or 'timed out' in low:
        return 'network_timeout'
    if 'throttl' in low or 'slowdown' in low:
        return 'throttled'
    return 'export_error'


def _batch_item(b: ResearchExportBatch) -> dict:
    return dict(batch_id=b.id, status=b.status, created_at=aware(b.created_at), uploaded_at=aware(b.uploaded_at),
                acked_at=aware(b.acked_at), file_count=b.file_count, total_bytes=b.total_bytes, attempt=b.attempt)


def list_research_batches(db: DBSession, context: ResolvedContext, query: dc.DataCenterQuery):
    require_platform(context)
    flt = filters_hash(context, 'research_batches', query)
    q = db.query(ResearchExportBatch)
    if query.status:
        q = q.filter(ResearchExportBatch.status == query.status)
    q = _range(q, ResearchExportBatch.created_at, query)
    total = q.count()
    rows, nxt, as_of = paginate(q, ResearchExportBatch.created_at, ResearchExportBatch.id, query, flt,
                                desc=query.sort != 'time_asc')
    return page([dc.ResearchBatchItem(**_batch_item(b)) for b, _ in rows], nxt, total, as_of, flt)


def research_batch_detail(db: DBSession, context: ResolvedContext, batch_id: UUID) -> dc.ResearchBatchDetail:
    require_platform(context)
    b = db.get(ResearchExportBatch, batch_id)
    if b is None:
        raise not_found()
    history = [dc.HoldingEvent(at=aware(b.created_at), kind='created', label='배치 생성', status=b.status)]
    if b.uploaded_at:
        history.append(dc.HoldingEvent(at=aware(b.uploaded_at), kind='uploaded', label='업로드 완료'))
    if b.acked_at:
        history.append(dc.HoldingEvent(at=aware(b.acked_at), kind='acked', label='수신 확인'))
    return dc.ResearchBatchDetail(**_batch_item(b), session_id=b.session_id, error_summary=_batch_error(b.last_error),
                                  history=history)


# ── #11~13 보관 ─────────────────────────────────────────────────────────

def list_retention_runs(db: DBSession, context: ResolvedContext, query: dc.DataCenterQuery):
    require_platform(context)
    flt = filters_hash(context, 'retention_runs', query)
    q = db.query(RetentionSweepRun)
    if query.status:
        q = q.filter(RetentionSweepRun.status == query.status)
    if query.kind in ('dry_run', 'execute'):
        q = q.filter(RetentionSweepRun.mode == query.kind)
    q = _range(q, RetentionSweepRun.started_at, query)
    total = q.count()
    rows, nxt, as_of = paginate(q, RetentionSweepRun.started_at, RetentionSweepRun.id, query, flt,
                                desc=query.sort != 'time_asc')
    items = [dc.RetentionRunItem(run_id=r.id, mode=r.mode, status=r.status, trigger=r.trigger,  # type: ignore[arg-type]
                                 started_at=aware(r.started_at), finished_at=aware(r.finished_at)) for r, _ in rows]
    return page(items, nxt, total, as_of, flt)


_SAFE_WORD = re.compile(r'^[a-z_]{1,40}$')


def retention_run_detail(db: DBSession, context: ResolvedContext, run_id: UUID) -> dc.RetentionRunDetail:
    require_platform(context)
    r = db.get(RetentionSweepRun, run_id)
    if r is None:
        raise not_found()
    rep = r.report if isinstance(r.report, dict) else {}
    cut = rep.get('cutoffs') if isinstance(rep.get('cutoffs'), dict) else {}
    raw, hold, pii = (rep.get(k) if isinstance(rep.get(k), dict) else {} for k in ('raw', 'research_hold', 'guest_pii'))
    summary = {
        'raw_sessions': _count(raw.get('sessions')), 'raw_eeg_chunks': _count(raw.get('eeg_raw_chunks')),
        'raw_bytes_known': _count(raw.get('bytes_known')), 'hold_participants': _count(hold.get('participants')),
        'hold_blocked': _count(hold.get('blocked')), 'hold_queued_for_export': _count(hold.get('queued_for_export')),
        'hold_overdue': _count(hold.get('overdue')), 'guest_pii_participants': _count(pii.get('participants')),
    }
    cutoff = None
    if isinstance(cut.get('evaluated_at'), str):
        try:
            cutoff = aware(datetime.fromisoformat(cut['evaluated_at']))
        except ValueError:
            cutoff = None
    blocked = rep.get('blocked_reason') if isinstance(rep.get('blocked_reason'), str) and \
        _SAFE_WORD.match(rep.get('blocked_reason', '')) else None
    err = None
    if r.error:
        head = r.error.split(':', 1)[0]
        err = head if re.match(r'^[A-Za-z]{1,40}$', head) else 'error'
    return dc.RetentionRunDetail(run_id=r.id, mode=r.mode, status=r.status, trigger=r.trigger,  # type: ignore[arg-type]
                                 started_at=aware(r.started_at), finished_at=aware(r.finished_at), cutoff_at=cutoff,
                                 blocked_reason=blocked, summary=summary, error_summary=err)


def list_retention_candidates(db: DBSession, context: ResolvedContext, query: dc.DataCenterQuery):
    """순수 평가: 세션 종료일 + 보관일수. 실행 함수·쓰기 없음."""
    require_platform(context)
    flt = filters_hash(context, 'retention_candidates', query)
    days = settings.retention_guest_pii_days if query.kind == 'guest_pii' else settings.retention_raw_days
    moment = now()
    horizon = moment - timedelta(days=days) + timedelta(days=NEAR_DUE_DAYS)
    ref_time = func.coalesce(Session.ended_at, Session.created_at)
    q = db.query(Session).filter(Session.status.in_(TARGET_STATUSES), Session.is_template.is_(False), ref_time < horizon)
    total = q.count()
    rows, nxt, as_of = paginate(q, ref_time, Session.id, query, flt, desc=False)
    ids = [s.id for s, _ in rows]
    held = {sid for (sid,) in db.query(ResearchConsent.session_id).filter(
        ResearchConsent.session_id.in_(ids), ResearchConsent.consented.is_(True), ResearchConsent.withdrawn_at.is_(None),
        ResearchConsent.export_state.notin_(NO_GATE_STATES)).all()} if ids and query.kind != 'guest_pii' else set()
    items = []
    for s, _ in rows:
        deadline = aware((s.ended_at or s.created_at)) + timedelta(days=days)
        if s.ended_at is None:
            reason = 'unknown_deadline'
        elif deadline > moment:
            reason = 'near_due'
        elif s.id in held:
            reason = 'research_hold'
        else:
            reason = 'due'
        items.append(dc.RetentionCandidate(kind=query.kind or 'eeg_raw', ref=ref('S', s.id), deadline=deadline,
                                           reason=reason))  # type: ignore[arg-type]
    return page(items, nxt, total, as_of, flt)


# ── #14 계정 삭제 ───────────────────────────────────────────────────────

def list_account_deletions(db: DBSession, context: ResolvedContext, query: dc.DataCenterQuery):
    require_platform(context)
    source = query.kind or 'ledger'
    if source not in ('ledger', 'request'):
        raise deny(422, 'kind_invalid', 'kind 는 ledger 또는 request 입니다')
    flt = filters_hash(context, 'account_deletions', query, source=source)
    if source == 'request':
        q = db.query(AccountDeletionRequest)
        if query.status:
            q = q.filter(AccountDeletionRequest.status == query.status)
        q = _range(q, AccountDeletionRequest.created_at, query)
        total = q.count()
        rows, nxt, as_of = paginate(q, AccountDeletionRequest.created_at, AccountDeletionRequest.id, query, flt,
                                    desc=query.sort != 'time_asc')
        # 이메일·IP 는 노출하지 않고, 이메일로 계정/원장에 연결하지 않는다.
        items = [dc.AccountDeletionItem(source='request', ref=ref('Q', r.id), status=r.status,
                                        received_at=aware(r.created_at), grace_until=None) for r, _ in rows]
        return page(items, nxt, total, as_of, flt)
    q = db.query(AccountDeletionLedger)
    if query.status:
        q = q.filter(AccountDeletionLedger.status == query.status)
    q = _range(q, AccountDeletionLedger.deleted_at, query)
    total = q.count()
    rows, nxt, as_of = paginate(q, AccountDeletionLedger.deleted_at, AccountDeletionLedger.id, query, flt,
                                desc=query.sort != 'time_asc')
    ids = [r.id for r, _ in rows]
    counts: dict[UUID, dict[str, int]] = {}
    if ids:
        for lid, st, n in db.query(AccountDeletionObject.ledger_id, AccountDeletionObject.status, func.count()).filter(
                AccountDeletionObject.ledger_id.in_(ids)).group_by(AccountDeletionObject.ledger_id,
                                                                    AccountDeletionObject.status).all():
            counts.setdefault(lid, {})[st] = n
    items = []
    for r, _ in rows:
        reasons = {k: v for k, v in (r.retained_reasons or {}).items()
                   if isinstance(v, int) and not isinstance(v, bool) and _SAFE_WORD.match(str(k))}
        items.append(dc.AccountDeletionItem(source='ledger', ref=ref('L', r.id), status=r.status,
                                            received_at=aware(r.deleted_at), grace_until=aware(r.purge_after),
                                            retained_reasons=reasons, object_counts=counts.get(r.id, {})))
    return page(items, nxt, total, as_of, flt)


# ── #15 표준 baseline ───────────────────────────────────────────────────

def list_baselines(db: DBSession, context: ResolvedContext, query: dc.DataCenterQuery):
    require_platform(context)
    flt = filters_hash(context, 'baselines', query)
    q = db.query(NormalizationBaseline)
    if query.status in ('active', 'inactive'):
        q = q.filter(NormalizationBaseline.is_active.is_(query.status == 'active'))
    q = _range(q, NormalizationBaseline.created_at, query)
    total = q.count()
    rows, nxt, as_of = paginate(q, NormalizationBaseline.created_at, NormalizationBaseline.id, query, flt,
                                desc=query.sort != 'time_asc', id_cast=int)
    # 사용자·장비 ID·성별·생년월일·개별 feature(closed/open) 는 투영하지 않는다.
    items = [dc.BaselineItem(baseline_id=b.id, pipeline_version=b.pipeline_version, is_active=bool(b.is_active),
                             created_at=aware(b.created_at)) for b, _ in rows]
    return page(items, nxt, total, as_of, flt)
