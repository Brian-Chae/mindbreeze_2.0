"""SDD-243 데이터 센터 일괄 반출: preview·작업 원장·큐·lease(B05).

- preview 가 대상(회차×참여자)·manifest revision·정책을 서버 원장에 고정하고, create 는 token 만으로 재인가를 생략하지 않는다.
- create = 행 잠금 아래 [멱등 → 활성 한도 → job+targets+요청 감사+dispatch outbox] 를 한 트랜잭션에 commit.
  commit 뒤 best-effort enqueue 를 시도하고 실패는 outbox 에 남겨 cron 이 재전달한다(Celery beat 신설 없음).
- worker 는 job claim + lease + fencing token 으로 중복 실행을 막는다. ZIP 생성(B06)은 `PACKAGE_BUILDER` 로 주입되며
  연결 전에는 작업을 failed(package_builder_unavailable)로 닫는다(가짜 ready 금지).
- 244 소유 영역(디코더·manifest 저장·biosignal 스키마)은 읽지 않고 `MeasurementBackend` 계약으로만 소비한다.
"""
import hashlib
import json
import logging
import math
import secrets
import socket
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Callable
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import and_, func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DBSession

from app.models.data_export import (DataExportAudit, DataExportDispatchOutbox, DataExportJob, DataExportPart,
                                    DataExportPreview, DataExportTarget)
from app.models.research import ResearchConsent
from app.models.session import Session, SessionParticipant
from app.models.user import User
from app.schemas import data_center as dc
from app.schemas import data_export as de
from app.services import export_reauth
from app.services.data_center_measurement import MeasurementBackend, ManifestView
from app.services.data_center_policy import (ResolvedContext, aware, authorize_purpose, authorize_selection, deny, normalize_reason,
                                             not_found, resolve_context, scoped_participants, selection_sessions)
from app.services.data_center_query import RAW_RETENTION_DAYS, SESSION_TIME, kst_range, measure_stats, now

logger = logging.getLogger(__name__)

ACTIVE = ('queued', 'preparing')
TERMINAL = ('ready', 'ready_with_warnings', 'failed', 'expired', 'cancelled')
LEASE_SECONDS = 300
OUTBOX_LEASE_SECONDS = 120
OUTBOX_BACKOFF_SECONDS = 60
PREVIEW_TARGET_SAMPLE = 200
PREVIEW_EXCLUSION_SAMPLE = 500
EST_FEATURE_ROW_BYTES = 256
RAW_SIGNALS = ('eeg_raw', 'ppg_raw', 'acc_raw')
SIGNAL_OF = {'eeg_raw': 'eeg', 'ppg_raw': 'ppg', 'acc_raw': 'acc'}
AVAIL_REASON = {'available': None, 'not_collected': 'not_collected', 'unsupported_client': 'unsupported_client',
                'expired': 'expired', 'withdrawn': 'withdrawn', 'lost': 'lost', 'unknown': 'unknown',
                'blocked': 'policy_blocked'}

# B06 이 주입하는 ZIP 생성기: (db, job, fencing_token) -> PackageOutcome. 연결 전에는 None.
PackageBuilder = Callable[[DBSession, DataExportJob, int], 'PackageOutcome']
PACKAGE_BUILDER: PackageBuilder | None = None


@dataclass
class PackageOutcome:
    parts: list[dict]  # {part_no, object_key, size_bytes, checksum, object_version?}
    warnings: list[str]
    expected_part_count: int


class StaleLease(Exception):
    """fencing token 이 낡았다 — 다른 worker 가 작업을 이어받았다."""


def set_package_builder(builder: PackageBuilder | None) -> None:
    global PACKAGE_BUILDER
    PACKAGE_BUILDER = builder


# ── 요청 정규화·해시 ────────────────────────────────────────────────────

def normalize_request(request: de.DataCenterExportRequest) -> dict:
    rng = request.range
    return {
        'scope': request.scope, 'target_id': str(request.target_id),
        'session_id': str(request.session_id) if request.session_id else None,
        'participant_ids': sorted(str(p) for p in request.participant_ids) if request.participant_ids else None,
        'range': {'date_from': rng.date_from, 'date_to': rng.date_to, 'batch_index': rng.batch_index,
                  'session_ids': sorted(str(s) for s in rng.session_ids) if rng.session_ids else None},
        'from_us': request.from_us, 'to_us': request.to_us, 'include': sorted(request.include),
        'eeg_format': request.eeg_format, 'include_raw_bin': request.include_raw_bin, 'identity': request.identity,
        'purpose': request.purpose, 'allow_partial': request.allow_partial,
    }


def _hash(payload: object) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def raw_bin_state(context: ResolvedContext, request: de.DataCenterExportRequest) -> str:
    """원본 bin(v2 header 에 UUID/tick/UTC 포함)은 lossless 권한이 있을 때만. 기관·가명은 redacted packet view 로 대체."""
    if not request.include_raw_bin:
        return 'not_requested'
    allowed = context.is_platform and request.purpose == 'operations' and request.identity == 'identified'
    return 'included' if allowed else 'redacted_packet_view'


# ── preview ─────────────────────────────────────────────────────────────

def _research_state(db: DBSession, participant_ids: list[UUID]) -> dict[UUID, str]:
    out: dict[UUID, str] = {}
    if participant_ids:
        for rc in db.query(ResearchConsent).filter(ResearchConsent.participant_id.in_(participant_ids)).all():
            out[rc.participant_id] = 'withdrawn' if rc.withdrawn_at else ('agreed' if rc.consented else 'none')
    return out


def _session_selection(db: DBSession, selection, request: de.DataCenterExportRequest, context: ResolvedContext):
    """선택 회차 목록(시작시각+ID 오름차순). 회원·상담사 50회차 초과는 묵시 절삭 없이 413."""
    query = selection_sessions(db, selection)
    start, end = kst_range(request.range.date_from, request.range.date_to)
    if selection.scope == 'facilitator' and (not request.range.date_from or not request.range.date_to):
        raise deny(422, 'period_required', '상담사 단위는 시작일과 종료일이 필요합니다')
    if start:
        query = query.filter(SESSION_TIME >= start)
    if end:
        query = query.filter(SESSION_TIME < end)
    wanted = request.range.session_ids
    if wanted:
        wanted_set = set(wanted)
        if query.filter(Session.id.in_(wanted_set)).count() != len(wanted_set):
            raise not_found()
        query = query.filter(Session.id.in_(wanted_set))
    sessions = query.all()
    limit = context.policy.member_facilitator_max_sessions
    if selection.scope in ('member', 'facilitator'):
        total = len(sessions)
        if request.range.batch_index:
            first = (request.range.batch_index - 1) * limit
            sessions = sessions[first:first + limit]
            if not sessions:
                raise deny(422, 'batch_out_of_range', '선택한 묶음에 회차가 없습니다')
        elif total > limit:
            raise HTTPException(413, detail={'code': 'too_many_sessions', 'message': f'{limit}회차를 초과했습니다. 묶음 또는 기간을 선택해 주세요',
                                             'total': total, 'max': limit, 'batches': math.ceil(total / limit)})
    if not sessions:
        raise deny(422, 'no_sessions', '조건에 맞는 회차가 없습니다')
    return sessions


def _raw_deadline(raw_first: datetime | None) -> datetime | None:
    return raw_first + timedelta(days=RAW_RETENTION_DAYS) if raw_first else None


def preview_export(db: DBSession, context: ResolvedContext, request: de.DataCenterExportRequest,
                   backend: MeasurementBackend) -> de.ExportPreview:
    if request.scope_org_id is not None and request.scope_org_id != context.scope_org_id:
        raise deny(409, 'org_scope_mismatch', '요청한 기관이 현재 선택한 기관과 다릅니다')
    selection = authorize_selection(db, context, request, request.purpose, request.identity)
    sessions = _session_selection(db, selection, request, context)
    moment = now()
    include = set(request.include)
    want_raw = include & set(RAW_SIGNALS)
    exclusions: list[de.ExportExclusion] = []
    counts: Counter = Counter()
    targets: list[dict] = []
    pending, partial = 0, 0
    est_bytes = 0

    def exclude(reason: str, session_id=None, participant_id=None, signal=None) -> None:
        counts[reason] += 1
        if len(exclusions) < PREVIEW_EXCLUSION_SAMPLE:
            exclusions.append(de.ExportExclusion(session_id=session_id, participant_id=participant_id, signal=signal,
                                                 reason=reason))  # type: ignore[arg-type]

    eligible_sessions = []
    for s in sessions:
        if s.status != 'completed':
            exclude('not_completed', session_id=s.id)
        else:
            eligible_sessions.append(s)
    session_total = 0
    for s in eligible_sessions:
        pq = scoped_participants(db, context).filter(SessionParticipant.session_id == s.id)
        if selection.scope == 'member':
            pq = pq.filter(SessionParticipant.user_id == selection.target_id)
        elif selection.scope == 'participant':
            pq = pq.filter(SessionParticipant.id == selection.target_id)
        if selection.participant_ids:
            pq = pq.filter(SessionParticipant.id.in_(selection.participant_ids))
        parts = pq.order_by(SessionParticipant.joined_at, SessionParticipant.id).all()
        stats = measure_stats(db, [p.id for p in parts])
        research = _research_state(db, [p.id for p in parts]) if request.purpose == 'research' else {}
        session_has_target = False
        for p in parts:
            stat = stats[p.id]
            if not p.consent_eeg:
                exclude('consent_missing', s.id, p.id)
                continue
            if request.purpose == 'research' and research.get(p.id) != 'agreed':
                exclude('consent_missing', s.id, p.id)
                continue
            available: list[str] = []
            deadline: datetime | None = None
            manifest: ManifestView | None = None
            if want_raw:
                manifest = backend.get_manifest(s.id, p.id, None)
                if manifest is not None and manifest.close_state == 'pending_upload':
                    pending += 1
                    continue
                if manifest is not None and manifest.close_state in ('partial', 'unknown'):
                    partial += 1
            raw_deadline = _raw_deadline(stat.raw_first)
            for key in RAW_SIGNALS:
                if key not in include:
                    continue
                signal = SIGNAL_OF[key]
                if manifest is None:
                    exclude('manifest_not_connected', s.id, p.id, signal)
                    continue
                availability, _ = manifest.signals.get(signal, ('unknown', None))
                if availability != 'available':
                    exclude(AVAIL_REASON.get(availability) or 'unknown', s.id, p.id, signal)
                    continue
                if raw_deadline is not None and raw_deadline <= moment:
                    exclude('expired', s.id, p.id, signal)
                    continue
                available.append(key)
                if raw_deadline is not None and (deadline is None or raw_deadline < deadline):
                    deadline = raw_deadline
                if key == 'eeg_raw':
                    est_bytes += stat.raw_bytes
            if 'features' in include:
                if stat.feature_total > 0:
                    available.append('features')
                    est_bytes += stat.feature_total * EST_FEATURE_ROW_BYTES
                else:
                    exclude('not_collected' if p.band_connected else 'band_not_used', s.id, p.id, 'features')
            if 'indices' in include:
                snapshots = getattr(backend, 'indices', None)
                if snapshots is not None and manifest is not None:
                    available.append('indices')
                else:
                    exclude('manifest_not_connected', s.id, p.id, 'indices')
            if not available:  # 요청 항목별 제외 사유가 이미 기록돼 있다(사유 이중 집계 방지)
                continue
            targets.append({'session_id': s.id, 'participant_id': p.id,
                            'revision': manifest.revision if manifest else None, 'deadline': deadline})
            session_has_target = True
        if session_has_target:
            session_total += 1
    if pending:
        raise HTTPException(409, detail={'code': 'manifest_pending', 'message': '일부 측정 데이터가 아직 준비 중입니다',
                                         'pending': pending})
    if partial and not request.allow_partial:
        raise HTTPException(409, detail={'code': 'manifest_partial', 'message': '일부 측정이 부분 수신 상태입니다. 제외 범위를 확인한 뒤 allow_partial 로 다시 요청해 주세요',
                                         'partial': partial})
    policy = context.policy
    base = dict(scope=request.scope, purpose=request.purpose, identity=request.identity, as_of=moment,
                policy_version=policy.policy_version, policy_hash=policy.policy_hash,
                exclusion_counts=dict(counts), exclusions_truncated=sum(counts.values()) > len(exclusions),
                raw_bin=raw_bin_state(context, request),  # type: ignore[arg-type]
                extra_range_notices=['raw_bin_redacted_packet_view'] if raw_bin_state(context, request) == 'redacted_packet_view' else [])
    if not targets:
        return de.ExportPreview(preview_token='', expires_at=moment, request_hash='', session_count=0, participant_count=0,
                                targets=[], exclusions=exclusions, eligible=False, blocked_reason='no_eligible_targets', **base)
    normalized = normalize_request(request)
    target_key = [[str(t['session_id']), str(t['participant_id']), t['revision']] for t in targets]
    request_hash = _hash({'req': normalized, 'actor': str(context.actor_id), 'role': context.role,
                          'org': str(context.scope_org_id), 'targets': target_key, 'policy': policy.policy_hash})
    token = secrets.token_urlsafe(32)
    expires = moment + timedelta(seconds=policy.preview_ttl_seconds)
    est_parts = max(1, math.ceil(est_bytes * 1.1 / policy.part_max_bytes))
    preview = DataExportPreview(
        token_hash=_token_hash(token), actor_id=context.actor_id, role=context.role, scope_org_id=context.scope_org_id,
        export_scope=request.scope, target_id=request.target_id, purpose_type=request.purpose, identity=request.identity,
        request_hash=request_hash, request=normalized, as_of=moment, session_count=session_total,
        participant_count=len(targets), estimated_bytes=est_bytes, estimated_part_count=est_parts,
        exclusions=[e.model_dump(mode='json') for e in exclusions], exclusion_counts=dict(counts),
        policy_version=policy.policy_version, policy_hash=policy.policy_hash, expires_at=expires)
    db.add(preview)
    db.flush()
    batch: list[DataExportTarget] = []
    for ordinal, t in enumerate(targets, start=1):
        batch.append(DataExportTarget(preview_id=preview.id, ordinal=ordinal, session_id=t['session_id'],
                                      participant_id=t['participant_id'], manifest_revision=t['revision'],
                                      source_deadline=t['deadline'], consent_state='agreed'))
        if len(batch) >= 500:
            db.add_all(batch)
            db.flush()
            batch = []
    if batch:
        db.add_all(batch)
    db.commit()
    sample = [de.ExportTargetRef(ordinal=i + 1, session_id=t['session_id'], participant_id=t['participant_id'],
                                 manifest_revision=t['revision']) for i, t in enumerate(targets[:PREVIEW_TARGET_SAMPLE])]
    return de.ExportPreview(preview_token=token, expires_at=expires, request_hash=request_hash, session_count=session_total,
                            participant_count=len(targets), targets=sample, targets_truncated=len(targets) > len(sample),
                            exclusions=exclusions, estimated_bytes=est_bytes, estimated_part_count=est_parts, eligible=True,
                            **base)


# ── create ──────────────────────────────────────────────────────────────

def _first_target(db: DBSession, *, job_id: UUID | None = None, preview_id: UUID | None = None):
    q = db.query(DataExportTarget.session_id, DataExportTarget.participant_id)
    q = q.filter(DataExportTarget.job_id == job_id) if job_id else q.filter(DataExportTarget.preview_id == preview_id)
    return q.order_by(DataExportTarget.ordinal).first()


def audit_dc(db: DBSession, job: DataExportJob, event: str, result: str, role: str | None = None) -> None:
    """일괄 작업 감사(요약 행). B07(M243-3)에서 전용 컬럼·대상 표로 교체한다. URL·비밀·생체값은 기록하지 않는다."""
    first = _first_target(db, job_id=job.id) or _first_target(db, preview_id=job.preview_id)
    if first is None:
        raise RuntimeError('audit target missing')
    db.add(DataExportAudit(export_id=job.id, user_id=job.user_id, role=role or job.requester_role, session_id=first[0],
                           participant_id=first[1], purpose=(job.reason or job.purpose)[:500],
                           policy_version=job.policy_version or '', event=event, result=result, size_bytes=job.size_bytes))


def _revalidate_targets(db: DBSession, context: ResolvedContext, *, preview_id: UUID | None = None,
                        job_id: UUID | None = None, purpose: str = 'operations') -> bool:
    """고정 대상이 지금도 모두 범위·동의 안에 있는지 set 연산으로 확인한다(하나라도 벗어나면 전체 차단)."""
    q = db.query(func.count(DataExportTarget.id))
    q = q.filter(DataExportTarget.job_id == job_id) if job_id else q.filter(DataExportTarget.preview_id == preview_id)
    total = q.scalar() or 0
    valid_ids = scoped_participants(db, context).filter(SessionParticipant.consent_eeg.is_(True)).with_entities(
        SessionParticipant.id).statement
    vq = db.query(func.count(DataExportTarget.id)).filter(DataExportTarget.participant_id.in_(valid_ids))
    vq = vq.filter(DataExportTarget.job_id == job_id) if job_id else vq.filter(DataExportTarget.preview_id == preview_id)
    if (vq.scalar() or 0) != total:
        return False
    if purpose == 'research':
        agreed = db.query(ResearchConsent.participant_id).filter(ResearchConsent.consented.is_(True),
                                                                  ResearchConsent.withdrawn_at.is_(None)).statement
        rq = db.query(func.count(DataExportTarget.id)).filter(DataExportTarget.participant_id.in_(agreed))
        rq = rq.filter(DataExportTarget.job_id == job_id) if job_id else rq.filter(DataExportTarget.preview_id == preview_id)
        return (rq.scalar() or 0) == total
    return True


def _expires_for(db: DBSession, preview_id: UUID, context: ResolvedContext, moment: datetime) -> datetime:
    expires = moment + timedelta(seconds=context.policy.artifact_ttl_seconds)
    earliest = db.query(func.min(DataExportTarget.source_deadline)).filter(DataExportTarget.preview_id == preview_id).scalar()
    if earliest is not None:
        earliest = aware(earliest)
        expires = min(expires, earliest)
    return expires


def create_data_center_export(db: DBSession, context: ResolvedContext, preview_token: str, reason: str,
                              reauth_proof: str | None, idempotency_key: str | None) -> DataExportJob:
    if not idempotency_key:
        raise deny(422, 'idempotency_key_required', 'Idempotency-Key 헤더가 필요합니다')
    policy = context.policy
    reason = normalize_reason(reason, policy)
    # 요청자 행 잠금으로 동시 생성·멱등키 경쟁·활성 한도를 직렬화한다(PG). 한도는 설정값이라 partial unique 로 고정하지 않는다.
    db.query(User).filter(User.id == context.actor_id).with_for_update().first()
    existing = db.query(DataExportJob).filter(DataExportJob.user_id == context.actor_id,
                                              DataExportJob.idempotency_key == idempotency_key).first()
    preview = db.query(DataExportPreview).filter(DataExportPreview.token_hash == _token_hash(preview_token)).first()
    if preview is None or preview.actor_id != context.actor_id or preview.role != context.role \
            or preview.scope_org_id != context.scope_org_id:
        if existing is not None and existing.kind == 'data_center':
            raise deny(409, 'request_hash_mismatch', '같은 Idempotency-Key에 다른 요청을 사용할 수 없습니다')
        raise not_found()
    if existing is not None:
        if existing.kind != 'data_center' or existing.request_hash != preview.request_hash:
            raise deny(409, 'request_hash_mismatch', '같은 Idempotency-Key에 다른 요청을 사용할 수 없습니다')
        return existing
    moment = now()
    if preview.consumed_job_id is not None:
        raise deny(409, 'preview_consumed', '이미 사용한 preview 입니다. 새로 요청해 주세요')
    if aware(preview.expires_at) <= moment:
        raise deny(409, 'preview_expired', 'preview 가 만료되었습니다. 다시 확인해 주세요')
    # 최신 정책·권한 재검사(preview 이후 변경은 전체 차단)
    if preview.policy_hash != policy.policy_hash:
        raise deny(409, 'policy_changed', '정책이 변경되었습니다. 새 preview 를 요청해 주세요')
    authorize_purpose(context, preview.purpose_type, preview.identity)
    if not _revalidate_targets(db, context, preview_id=preview.id, purpose=preview.purpose_type):
        raise deny(409, 'scope_changed', '대상의 권한·동의가 변경되었습니다. 새 preview 를 요청해 주세요')
    export_reauth.verify_export_proof(db, context, reauth_proof, request_hash=preview.request_hash,
                                      purpose=preview.purpose_type)
    active = db.query(DataExportJob).filter(DataExportJob.user_id == context.actor_id,
                                            DataExportJob.status.in_(ACTIVE)).order_by(DataExportJob.created_at).all()
    if len(active) >= policy.max_active_jobs_per_actor:
        raise HTTPException(429, detail={'code': 'active_job_exists', 'message': '진행 중인 데이터 다운로드 작업이 있습니다',
                                         'export_id': str(active[0].id)})
    job = DataExportJob(
        user_id=context.actor_id, requester_role=context.role, session_id=None, participant_id=None,
        include=preview.request.get('include', []), purpose=reason, idempotency_key=idempotency_key,
        request_hash=preview.request_hash, status='queued', schema_version='data-center-package-v1',
        consent_policy_version=policy.policy_version, consent_eeg=None, expires_at=_expires_for(db, preview.id, context, moment),
        updated_at=moment, kind='data_center', scope_org_id=context.scope_org_id, export_scope=preview.export_scope,
        identity=preview.identity, purpose_type=preview.purpose_type, reason=reason, policy_version=policy.policy_version,
        policy_hash=policy.policy_hash, preview_id=preview.id, target_count=preview.session_count,
        participant_total=preview.participant_count, expected_part_count=preview.estimated_part_count)
    db.add(job)
    try:
        db.flush()
    except IntegrityError:  # 동시에 같은 키로 만든 요청 — 먼저 만든 쪽을 돌려준다
        db.rollback()
        winner = db.query(DataExportJob).filter(DataExportJob.user_id == context.actor_id,
                                                DataExportJob.idempotency_key == idempotency_key).first()
        if winner is not None and winner.request_hash == preview.request_hash:
            return winner
        raise deny(409, 'request_hash_mismatch', '같은 Idempotency-Key에 다른 요청을 사용할 수 없습니다') from None
    db.query(DataExportTarget).filter(DataExportTarget.preview_id == preview.id).update(
        {DataExportTarget.job_id: job.id}, synchronize_session=False)
    preview.consumed_job_id = job.id
    audit_dc(db, job, 'requested', 'queued')  # 감사 insert 실패는 예외로 전파되어 생성 전체를 롤백(fail closed)
    db.add(DataExportDispatchOutbox(job_id=job.id, status='pending', next_attempt_at=moment))
    db.commit()
    try_dispatch(db, job.id)
    return job


def enqueue_job(job_id: UUID) -> None:
    from app.tasks.export_task import generate_data_export
    generate_data_export.apply_async(args=[str(job_id)], queue='exports')


def try_dispatch(db: DBSession, job_id: UUID, *, enqueue: Callable[[UUID], None] | None = None) -> bool:
    """commit 직후 best-effort 전달. 실패해도 job 은 queued 로 남고 outbox 가 재전달한다."""
    enqueue = enqueue or enqueue_job
    moment = now()
    claimed = db.query(DataExportDispatchOutbox).filter(
        DataExportDispatchOutbox.job_id == job_id, DataExportDispatchOutbox.status == 'pending').update(
        {'status': 'delivering', 'lease_expires_at': moment + timedelta(seconds=OUTBOX_LEASE_SECONDS),
         'attempts': DataExportDispatchOutbox.attempts + 1}, synchronize_session=False)
    db.commit()
    if not claimed:
        return False
    try:
        enqueue(job_id)
    except Exception as exc:  # noqa: BLE001 — 브로커 장애는 outbox 가 흡수한다
        logger.warning('data_center_export_enqueue_failed job=%s err=%s', job_id, type(exc).__name__)
        db.query(DataExportDispatchOutbox).filter(DataExportDispatchOutbox.job_id == job_id).update(
            {'status': 'pending', 'next_attempt_at': now() + timedelta(seconds=OUTBOX_BACKOFF_SECONDS),
             'last_error': type(exc).__name__[:200], 'lease_expires_at': None}, synchronize_session=False)
        db.commit()
        return False
    db.query(DataExportDispatchOutbox).filter(DataExportDispatchOutbox.job_id == job_id).update(
        {'status': 'published', 'published_at': now(), 'lease_expires_at': None, 'last_error': None},
        synchronize_session=False)
    db.commit()
    return True


def redeliver_outbox(db: DBSession, *, limit: int = 50, enqueue: Callable[[UUID], None] | None = None,
                     moment: datetime | None = None) -> dict:
    """cron: pending / delivering(lease 만료) 재전달 + lease 가 만료된 preparing 작업의 재실행 큐 복구."""
    moment = moment or now()
    # 1) 전달 중 죽은 항목 복구
    db.query(DataExportDispatchOutbox).filter(
        DataExportDispatchOutbox.status == 'delivering', DataExportDispatchOutbox.lease_expires_at < moment).update(
        {'status': 'pending'}, synchronize_session=False)
    # 2) 실행 중 worker 가 죽어 lease 가 만료된 작업은 다시 큐에 올린다(claim 은 만료 lease 만 인수)
    stalled = [jid for (jid,) in db.query(DataExportJob.id).filter(
        DataExportJob.kind == 'data_center', DataExportJob.status == 'preparing',
        DataExportJob.lease_expires_at < moment, DataExportJob.expires_at > moment).limit(limit).all()]
    if stalled:
        db.query(DataExportDispatchOutbox).filter(DataExportDispatchOutbox.job_id.in_(stalled),
                                                  DataExportDispatchOutbox.status == 'published').update(
            {'status': 'pending', 'next_attempt_at': moment}, synchronize_session=False)
    db.commit()
    due = [jid for (jid,) in db.query(DataExportDispatchOutbox.job_id).filter(
        DataExportDispatchOutbox.status == 'pending',
        or_(DataExportDispatchOutbox.next_attempt_at.is_(None), DataExportDispatchOutbox.next_attempt_at <= moment)
    ).order_by(DataExportDispatchOutbox.created_at).limit(limit).all()]
    delivered = sum(1 for jid in due if try_dispatch(db, jid, enqueue=enqueue))
    return {'due': len(due), 'delivered': delivered, 'stalled_recovered': len(stalled)}


# ── 조회 ────────────────────────────────────────────────────────────────

def _owned_job(db: DBSession, context: ResolvedContext, export_id: UUID) -> DataExportJob:
    job = db.query(DataExportJob).populate_existing().filter(
        DataExportJob.id == export_id, DataExportJob.kind == 'data_center',
        DataExportJob.user_id == context.actor_id).first()
    # 본인 + 현재 기관 작업만(다른 기관을 선택한 상태에서는 같은 관리자의 작업도 보이지 않는다)
    if job is None or job.scope_org_id != context.scope_org_id:
        raise not_found()
    return job


def _expire_if_due(db: DBSession, job: DataExportJob) -> None:
    if job.status not in ('expired', 'failed', 'cancelled') and aware(job.expires_at) <= now():
        job.status = 'expired'
        job.updated_at = now()
        db.query(DataExportPart).filter(DataExportPart.job_id == job.id, DataExportPart.status != 'expired').update(
            {'status': 'expired', 'updated_at': now()}, synchronize_session=False)
        audit_dc(db, job, 'expired', 'expired')
        db.commit()


def status_payload(db: DBSession, job: DataExportJob) -> de.DataCenterExportStatus:
    parts = db.query(DataExportPart).filter(DataExportPart.job_id == job.id).order_by(DataExportPart.part_no).all()
    return de.DataCenterExportStatus(
        export_id=job.id, status=job.status, scope=job.export_scope, purpose=job.purpose_type, identity=job.identity,  # type: ignore[arg-type]
        session_count=job.target_count, participant_count=job.participant_total or 0, completed_count=job.completed_count,
        parts=[de.ExportPartStatus(part_id=p.id, part_no=p.part_no, status=p.status, size_bytes=p.size_bytes) for p in parts],  # type: ignore[arg-type]
        expected_part_count=job.expected_part_count, warnings=list(job.warnings or []), error_code=job.error_code,
        created_at=aware(job.created_at), expires_at=aware(job.expires_at), policy_version=job.policy_version or '')


def get_export(db: DBSession, context: ResolvedContext, export_id: UUID) -> de.DataCenterExportStatus:
    job = _owned_job(db, context, export_id)
    _expire_if_due(db, job)
    return status_payload(db, job)


def list_exports(db: DBSession, context: ResolvedContext, limit: int, cursor: str | None) -> de.DataCenterExportPage:
    q = db.query(DataExportJob).filter(DataExportJob.kind == 'data_center', DataExportJob.user_id == context.actor_id)
    q = q.filter(DataExportJob.scope_org_id.is_(None)) if context.scope_org_id is None else \
        q.filter(DataExportJob.scope_org_id == context.scope_org_id)
    if cursor:
        try:
            stamp, cid = cursor.split('|', 1)
            key, cur = datetime.fromisoformat(stamp), UUID(cid)
        except ValueError:
            raise deny(400, 'invalid_cursor', '잘못된 cursor 입니다') from None
        q = q.filter(or_(DataExportJob.created_at < key, and_(DataExportJob.created_at == key, DataExportJob.id < cur)))
    rows = q.order_by(DataExportJob.created_at.desc(), DataExportJob.id.desc()).limit(limit + 1).all()
    more = len(rows) > limit
    rows = rows[:limit]
    for job in rows:
        _expire_if_due(db, job)
    nxt = f'{rows[-1].created_at.isoformat()}|{rows[-1].id}' if more and rows else None
    return de.DataCenterExportPage(items=[status_payload(db, j) for j in rows], next_cursor=nxt)


# ── worker: claim / lease / fencing ─────────────────────────────────────

def worker_id() -> str:
    return f'{socket.gethostname()}:{secrets.token_hex(4)}'[:64]


def claim_job(db: DBSession, export_id: UUID, owner: str | None = None, moment: datetime | None = None) -> int | None:
    """queued 이거나 lease 가 만료된 preparing 만 인수한다. 반환값은 이 worker 의 fencing token."""
    moment = moment or now()
    owner = owner or worker_id()
    updated = db.query(DataExportJob).filter(
        DataExportJob.id == export_id, DataExportJob.kind == 'data_center', DataExportJob.expires_at > moment,
        or_(DataExportJob.status == 'queued',
            and_(DataExportJob.status == 'preparing', DataExportJob.lease_expires_at < moment))
    ).update({'status': 'preparing', 'lease_owner': owner, 'lease_expires_at': moment + timedelta(seconds=LEASE_SECONDS),
              'fencing_token': DataExportJob.fencing_token + 1, 'updated_at': moment}, synchronize_session=False)
    if not updated:
        db.rollback()
        return None
    token = db.query(DataExportJob.fencing_token).filter(DataExportJob.id == export_id).scalar()
    db.commit()
    return int(token)


def renew_lease(db: DBSession, export_id: UUID, token: int) -> None:
    n = db.query(DataExportJob).filter(DataExportJob.id == export_id, DataExportJob.fencing_token == token,
                                       DataExportJob.status == 'preparing').update(
        {'lease_expires_at': now() + timedelta(seconds=LEASE_SECONDS)}, synchronize_session=False)
    db.commit()
    if not n:
        raise StaleLease()


def _finish(db: DBSession, export_id: UUID, token: int, values: dict) -> None:
    """fencing token 이 일치하고 아직 preparing 일 때만 종료 상태로 전이한다."""
    n = db.query(DataExportJob).filter(DataExportJob.id == export_id, DataExportJob.fencing_token == token,
                                       DataExportJob.status == 'preparing').update(
        {**values, 'updated_at': now(), 'lease_owner': None, 'lease_expires_at': None}, synchronize_session=False)
    if not n:
        db.rollback()
        raise StaleLease()


def finalize_success(db: DBSession, export_id: UUID, token: int, outcome: PackageOutcome) -> None:
    """모든 part 가 게시·검증된 뒤에만 ready 로 전이한다(B06 이 호출)."""
    if not outcome.parts or len(outcome.parts) != outcome.expected_part_count:
        raise ValueError('part count mismatch')
    for spec in outcome.parts:
        row = db.query(DataExportPart).filter(DataExportPart.job_id == export_id,
                                              DataExportPart.part_no == spec['part_no']).first()
        if row is None:
            row = DataExportPart(job_id=export_id, part_no=spec['part_no'])
            db.add(row)
        row.object_key, row.size_bytes, row.checksum = spec['object_key'], spec['size_bytes'], spec['checksum']
        row.object_version = spec.get('object_version')
        row.status, row.updated_at = 'ready', now()
    status = 'ready_with_warnings' if outcome.warnings else 'ready'
    _finish(db, export_id, token, {'status': status, 'warnings': outcome.warnings, 'completed_count': len(outcome.parts),
                                   'expected_part_count': outcome.expected_part_count,
                                   'size_bytes': sum(int(p['size_bytes']) for p in outcome.parts)})
    job = db.get(DataExportJob, export_id, populate_existing=True)
    audit_dc(db, job, 'ready', status)
    db.commit()


def _fail(db: DBSession, export_id: UUID, token: int, code: str) -> None:
    _finish(db, export_id, token, {'status': 'expired' if code == 'expired' else 'failed', 'error_code': code})
    job = db.get(DataExportJob, export_id, populate_existing=True)
    audit_dc(db, job, 'failed', code)
    db.commit()
    logger.warning('data_center_export_failed export_id=%s code=%s', export_id, code)


def run_job(db: DBSession, export_id: UUID, *, owner: str | None = None) -> None:
    token = claim_job(db, export_id, owner)
    if token is None:
        return
    try:
        job = db.get(DataExportJob, export_id, populate_existing=True)
        if aware(job.expires_at) <= now():
            return _fail(db, export_id, token, 'expired')
        try:
            context = resolve_context(db, job.user_id, job.scope_org_id)
            authorize_purpose(context, job.purpose_type, job.identity)
        except HTTPException:
            return _fail(db, export_id, token, 'access_revoked')
        if context.policy.policy_hash != job.policy_hash:
            return _fail(db, export_id, token, 'policy_changed')
        if not _revalidate_targets(db, context, job_id=export_id, purpose=job.purpose_type):
            return _fail(db, export_id, token, 'scope_changed')
        builder = PACKAGE_BUILDER
        if builder is None:
            return _fail(db, export_id, token, 'package_builder_unavailable')
        outcome = builder(db, job, token)
        finalize_success(db, export_id, token, outcome)
    except StaleLease:
        logger.info('data_center_export_stale_lease export_id=%s', export_id)
    except Exception:  # noqa: BLE001 — 원문 데이터·예외 메시지는 로그에 싣지 않는다
        db.rollback()
        try:
            _fail(db, export_id, token, 'generation_failed')
        except StaleLease:
            pass


def expire_jobs(db: DBSession, *, limit: int = 100) -> int:
    """만료 도달 작업의 상태만 expired 로 전이한다. 객체 삭제는 승인된 cleanup 흐름에서 별도(여기서 삭제하지 않음)."""
    moment = now()
    jobs = db.query(DataExportJob).filter(DataExportJob.kind == 'data_center', DataExportJob.expires_at <= moment,
                                          DataExportJob.status.notin_(('expired',))).limit(limit).all()
    for job in jobs:
        if job.status in ('queued', 'preparing', 'ready', 'ready_with_warnings'):
            job.status = 'expired'
            job.lease_expires_at = None
            job.updated_at = moment
            db.query(DataExportPart).filter(DataExportPart.job_id == job.id).update(
                {'status': 'expired', 'updated_at': moment}, synchronize_session=False)
            audit_dc(db, job, 'expired', 'expired')
    db.commit()
    return len(jobs)
