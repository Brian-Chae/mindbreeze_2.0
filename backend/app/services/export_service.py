"""SDD-071 작업 생성·권한·게시·만료 상태 전이."""
import hashlib
import json
import logging
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session as DBSession

from app.models.data_export import DataExportAudit, DataExportJob
from app.models.eeg_feature import EEGFeatureWindow
from app.models.record import Report
from app.models.session import Session, SessionParticipant
from app.models.user import User
from app.schemas.data_export import DataExportCreate
from app.services import storage_service
from app.services.export_package import build_package, sha256_file

logger = logging.getLogger(__name__)
READY = ('ready', 'ready_with_warnings')
POLICY = 'p0-service-analysis-1'


def now() -> datetime:
    return datetime.now(timezone.utc)


def utc(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def audit(db: DBSession, job: DataExportJob, event: str, result: str, role: str | None = None) -> None:
    db.add(DataExportAudit(export_id=job.id, user_id=job.user_id, role=role or job.requester_role,
                           session_id=job.session_id, participant_id=job.participant_id, purpose=job.purpose,
                           policy_version=job.consent_policy_version, event=event, result=result, size_bytes=job.size_bytes))


def audit_denied_request(db: DBSession, current_user: dict, session_id: UUID, participant_id: UUID,
                         payload: DataExportCreate, status_code: int) -> None:
    db.rollback()
    db.add(DataExportAudit(user_id=UUID(current_user['id']), role=current_user['role'],
                           session_id=session_id, participant_id=participant_id, purpose=payload.purpose,
                           policy_version=POLICY, event='request_denied', result=f'http_{status_code}'))
    db.commit()


def authorize(db: DBSession, user_id: UUID, session_id: UUID, participant_id: UUID, *, lock: bool = False):
    user_query = db.query(User).populate_existing()
    if lock:
        user_query = user_query.with_for_update()
    user = user_query.filter(User.id == user_id).first()
    if user is None or user.status != 'active':
        raise HTTPException(403, '활성 계정만 데이터를 다운로드할 수 있습니다')
    if user.role == 'org_admin':
        raise HTTPException(403, '기관 귀속 정책 미확정으로 기관 관리자의 데이터 다운로드는 지원하지 않습니다')
    if user.role not in ('counselor', 'platform_admin'):
        raise HTTPException(403, '데이터 다운로드 권한이 없습니다')
    session_query = db.query(Session).populate_existing()
    if lock:
        session_query = session_query.with_for_update()
    session = session_query.filter(Session.id == session_id).first()
    if not session or (user.role == 'counselor' and session.host_id != user.id):
        raise HTTPException(404, '대상을 찾을 수 없습니다')
    participant_query = db.query(SessionParticipant).populate_existing()
    if lock:
        participant_query = participant_query.with_for_update()
    participant = participant_query.filter(
        SessionParticipant.id == participant_id, SessionParticipant.session_id == session.id,
    ).first()
    if not participant:
        raise HTTPException(404, '대상을 찾을 수 없습니다')
    if session.status != 'completed':
        raise HTTPException(409, '종료된 세션만 다운로드할 수 있습니다')
    # 동의가 없는 경우에만 저장 원천을 확인한다. 미측정 메타데이터는 다운로드 가능하다.
    if not participant.consent_eeg:
        feature = db.query(EEGFeatureWindow.id).filter(EEGFeatureWindow.session_id == session.id,
                                                     EEGFeatureWindow.participant_id == participant.id).first()
        reports = db.query(Report.content).filter(Report.session_id == session.id, Report.participant_id == participant.id)
        sensitive_report = any(isinstance(content, dict) and isinstance(content.get('eeg'), dict)
                               and any(content['eeg'].get(key) for key in ('metrics', 'timeline', 'narrative'))
                               for (content,) in reports.yield_per(100))
        if feature or sensitive_report:
            raise HTTPException(403, 'EEG 동의가 확인되지 않아 다운로드할 수 없습니다')
    return user, session, participant


def create_export(db: DBSession, user_id: UUID, session_id: UUID, participant_id: UUID,
                  payload: DataExportCreate, idempotency_key: str | None) -> DataExportJob:
    # 요청자 행 잠금으로 동시 생성/멱등키 경쟁을 직렬화한다.
    db.query(User).filter(User.id == user_id).with_for_update().first()
    user, _, participant = authorize(db, user_id, session_id, participant_id)
    fingerprint = hashlib.sha256(json.dumps({'session_id': str(session_id), 'participant_id': str(participant_id),
                                             **payload.model_dump()}, sort_keys=True).encode()).hexdigest()
    if idempotency_key:
        existing = db.query(DataExportJob).filter_by(user_id=user_id, idempotency_key=idempotency_key).first()
        if existing:
            if existing.request_hash != fingerprint:
                raise HTTPException(409, '같은 Idempotency-Key에 다른 요청을 사용할 수 없습니다')
            return existing
    if db.query(DataExportJob.id).filter(DataExportJob.user_id == user_id,
                                        DataExportJob.status.in_(('queued', 'preparing'))).first():
        raise HTTPException(429, '진행 중인 데이터 다운로드 작업이 있습니다')
    job = DataExportJob(user_id=user_id, requester_role=user.role, session_id=session_id, participant_id=participant_id,
                        include=payload.include, purpose=payload.purpose, idempotency_key=idempotency_key,
                        request_hash=fingerprint, consent_eeg=participant.consent_eeg,
                        expires_at=now() + timedelta(hours=24), updated_at=now())
    db.add(job)
    db.flush()
    audit(db, job, 'requested', 'queued')
    db.commit()
    from app.tasks.export_task import generate_data_export
    try:
        generate_data_export.apply_async(args=[str(job.id)], queue='exports')
    except Exception:
        job.status = 'failed'
        job.error_code = 'queue_unavailable'
        job.updated_at = now()
        audit(db, job, 'failed', job.error_code)
        db.commit()
    return job


def get_job(db: DBSession, export_id: UUID, user_id: UUID) -> DataExportJob:
    job = db.query(DataExportJob).populate_existing().filter_by(id=export_id, user_id=user_id).first()
    if not job:
        raise HTTPException(404, '작업을 찾을 수 없습니다')
    _, _, participant = authorize(db, user_id, job.session_id, job.participant_id, lock=True)
    if job.consent_eeg and not participant.consent_eeg:
        raise HTTPException(403, 'EEG 동의가 변경되어 다운로드할 수 없습니다')
    if utc(job.expires_at) <= now() and job.status != 'expired':
        job.status = 'expired'
        job.updated_at = now()
        audit(db, job, 'expired', 'expired')
        db.commit()
    return job


def status_payload(job: DataExportJob) -> dict:
    return {'export_id': str(job.id), 'status': job.status, 'stage': job.status, 'target_count': 1,
            'completed_count': job.completed_count, 'size_bytes': job.size_bytes, 'warnings': job.warnings,
            'error_code': job.error_code, 'expires_at': utc(job.expires_at), 'snapshot_at': job.snapshot_at,
            'status_url': f'/api/v1/data-exports/{job.id}'}


def download_url(db: DBSession, job: DataExportJob) -> dict:
    remaining = int((utc(job.expires_at) - now()).total_seconds())
    if remaining < 1 or job.status == 'expired':
        raise HTTPException(410, '패키지 보관기한이 지났습니다. 새로 요청해 주세요')
    if job.status not in READY or not job.object_key:
        raise HTTPException(409, '다운로드 파일이 아직 준비되지 않았습니다')
    ttl = min(300, remaining)
    try:
        url = storage_service.generate_presigned_get(job.object_key, expires_in=ttl, expires_at=utc(job.expires_at))
    except storage_service.ExportStorageError:
        audit(db, job, 'url_failed', 'storage_unavailable')
        db.commit()
        raise HTTPException(503, '다운로드 저장소를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요') from None
    # URL 문자열은 감사 원장이나 로그에 기록하지 않는다.
    audit(db, job, 'url_issued', 'issued', db.get(User, job.user_id).role)
    db.commit()
    return {'url': url, 'expires_at': min(now() + timedelta(seconds=ttl), utc(job.expires_at))}


def _delete_object(db: DBSession, job: DataExportJob) -> None:
    if not job.object_key:
        return
    try:
        storage_service.delete_export(job.object_key)
    except storage_service.ExportStorageError:
        audit(db, job, 'delete_failed', 'storage_unavailable')
    else:
        job.object_key = None
        audit(db, job, 'deleted', 'deleted')
    db.commit()


def run_export(export_id: UUID, db: DBSession) -> None:
    # 조건부 UPDATE는 중복 Celery 메시지가 같은 작업을 동시에 게시하지 못하게 한다.
    claimed = db.query(DataExportJob).filter(DataExportJob.id == export_id, DataExportJob.status == 'queued').update(
        {'status': 'preparing', 'updated_at': now()}, synchronize_session=False)
    db.commit()
    if not claimed:
        return
    try:
        # PostgreSQL에서 feature/report를 동일한 원천 스냅샷으로 읽는다.
        if db.get_bind().dialect.name == 'postgresql':
            db.connection(execution_options={'isolation_level': 'REPEATABLE READ'})
        job = db.get(DataExportJob, export_id, populate_existing=True)
        user, session, participant = authorize(db, job.user_id, job.session_id, job.participant_id)
        if job.consent_eeg and not participant.consent_eeg:
            raise HTTPException(403, 'consent_changed')
        if utc(job.expires_at) <= now():
            raise ValueError('expired')
        job.snapshot_at = now()
        job.object_key = f'data-exports/{job.id}/data.zip'
        with tempfile.TemporaryDirectory(prefix='mb-export-') as temp:
            path, warnings = build_package(db, job, session, participant, Path(temp))
            job.size_bytes = path.stat().st_size
            job.checksum = sha256_file(path)
            job.warnings = warnings
            db.commit()  # S3 네트워크 작업 동안 원천 읽기 트랜잭션을 유지하지 않는다.
            object_key = job.object_key
            db.commit()  # expire_on_commit 후 속성 로드 트랜잭션도 닫는다.
            storage_service.upload_export(str(path), object_key)
            db.expire_all()
            job = db.get(DataExportJob, export_id)
            user, _, participant = authorize(db, job.user_id, job.session_id, job.participant_id, lock=True)
            if job.consent_eeg and not participant.consent_eeg:
                raise HTTPException(403, 'consent_changed')
            if utc(job.expires_at) <= now():
                raise ValueError('expired')
            if job.status != 'preparing':
                _delete_object(db, job)
                return
            job.status = 'ready_with_warnings' if warnings else 'ready'
            job.completed_count = 1
            job.updated_at = now()
            audit(db, job, 'completed', job.status, user.role)
            db.commit()
    except Exception as exc:
        db.rollback()
        job = db.get(DataExportJob, export_id, populate_existing=True)
        if not job:
            return
        if isinstance(exc, storage_service.ExportStorageError):
            code = 'storage_unavailable'
        elif isinstance(exc, HTTPException):
            code = 'access_revoked'
        elif isinstance(exc, ValueError) and str(exc) in ('export_size_limit', 'expired'):
            code = str(exc)
        else:
            code = 'generation_failed'
        job.status = 'expired' if code == 'expired' else 'failed'
        job.error_code = code
        job.updated_at = now()
        audit(db, job, 'failed', code)
        db.commit()
        # 원문 데이터나 SDK 예외(서명 URL 포함 가능)를 로그에 남기지 않는다.
        logger.warning('data_export_failed export_id=%s code=%s', export_id, code)
        _delete_object(db, job)


def cleanup_expired(db: DBSession) -> int:
    """주기 작업: 만료 객체 명시 삭제, 실패한 삭제는 다음 주기에 재시도."""
    count = 0
    candidates = db.query(DataExportJob).filter(
        ((DataExportJob.expires_at <= now()) & (DataExportJob.status != 'expired')) |
        (DataExportJob.status.in_(('failed', 'cancelled', 'expired')) & DataExportJob.object_key.is_not(None)) |
        ((DataExportJob.status.in_(('queued', 'preparing'))) & (DataExportJob.updated_at <= now() - timedelta(minutes=30)))
    ).order_by(DataExportJob.updated_at, DataExportJob.id).limit(100).all()
    for job in candidates:
        if utc(job.expires_at) <= now() and job.status != 'expired':
            job.status = 'expired'
            audit(db, job, 'expired', 'expired')
        elif job.status in ('queued', 'preparing'):
            job.status = 'failed'
            job.error_code = 'worker_timeout'
            audit(db, job, 'failed', job.error_code)
        job.updated_at = now()
        db.commit()
        if job.object_key:
            _delete_object(db, job)
            count += 1
    return count
