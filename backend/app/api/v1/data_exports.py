"""SDD-071 인증 사용자 전용 분석용 다운로드 API."""
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.schemas.data_export import DataExportCreate, DataExportDownload, DataExportStatus
from app.services import export_service

router = APIRouter(tags=['data-exports'])


@router.post('/sessions/{session_id}/participants/{participant_id}/data-exports', status_code=202, response_model=DataExportStatus)
def create(session_id: UUID, participant_id: UUID, payload: DataExportCreate, response: Response,
           idempotency_key: str | None = Header(default=None, min_length=1, max_length=128),
           current_user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    response.headers['Cache-Control'] = 'no-store'
    try:
        job = export_service.create_export(db, UUID(current_user['id']), session_id, participant_id, payload, idempotency_key)
    except HTTPException as exc:
        export_service.audit_denied_request(db, current_user, session_id, participant_id, payload, exc.status_code)
        raise
    return export_service.status_payload(job)


@router.get('/data-exports/{export_id}', response_model=DataExportStatus)
def status(export_id: UUID, response: Response, current_user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    response.headers['Cache-Control'] = 'no-store'
    return export_service.status_payload(export_service.get_job(db, export_id, UUID(current_user['id'])))


@router.post('/data-exports/{export_id}/download-url', response_model=DataExportDownload)
def download(export_id: UUID, response: Response, current_user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    response.headers['Cache-Control'] = 'no-store'
    job = export_service.get_job(db, export_id, UUID(current_user['id']))
    return export_service.download_url(db, job)


# ── SDD-243 데이터 센터 일괄 반출 (/api/v1/data-center/exports) ───────────────────
from fastapi import Query  # noqa: E402

from app.api.v1.data_center import backend_dep, context_dep, query_dep  # noqa: E402
from app.core.redis import get_redis  # noqa: E402
from app.schemas import data_center as dc  # noqa: E402
from app.services.data_center_policy import deny as policy_deny  # noqa: E402
from app.schemas import data_export as de  # noqa: E402
from app.services import data_center_export as dcx  # noqa: E402
from app.services.data_center_measurement import MeasurementBackend  # noqa: E402
from app.services.data_center_policy import ResolvedContext  # noqa: E402

center_router = APIRouter(prefix='/data-center', tags=['data-center-exports'])


@center_router.post('/exports/preview', response_model=de.ExportPreview)
def preview(body: de.DataCenterExportRequest, ctx: ResolvedContext = Depends(context_dep),
            db: Session = Depends(get_db), backend: MeasurementBackend = Depends(backend_dep)):
    return dcx.preview_export(db, ctx, body, backend)


@center_router.post('/exports', status_code=202, response_model=de.DataCenterExportStatus)
def create_center_export(body: de.DataCenterExportCreate, ctx: ResolvedContext = Depends(context_dep),
                        idempotency_key: str | None = Header(default=None, min_length=1, max_length=128),
                        db: Session = Depends(get_db)):
    try:
        job = dcx.create_data_center_export(db, ctx, body.preview_token, body.reason, body.reauth_proof, idempotency_key)
    except HTTPException as exc:  # 거부도 영속 감사(무대상). 사유 원문은 trim 후 500자 이내만.
        code = exc.detail.get('code', 'error') if isinstance(exc.detail, dict) else 'error'
        dcx.audit_denied(db, ctx, exc.status_code, code, reason=(body.reason or '').strip()[:500] or None)
        raise
    return dcx.status_payload(db, job)


@center_router.get('/exports', response_model=de.DataCenterExportPage)
def list_center_exports(limit: int = Query(25, ge=1, le=100), cursor: str | None = Query(None, max_length=200),
                        ctx: ResolvedContext = Depends(context_dep), db: Session = Depends(get_db)):
    return dcx.list_exports(db, ctx, limit, cursor)


@center_router.get('/exports/{job_id}', response_model=de.DataCenterExportStatus)
def get_center_export(job_id: UUID, ctx: ResolvedContext = Depends(context_dep), db: Session = Depends(get_db)):
    return dcx.get_export(db, ctx, job_id)


@center_router.post('/exports/{job_id}/download-url', response_model=de.PartDownload)
def part_download_url(job_id: UUID, body: de.PartDownloadRequest, ctx: ResolvedContext = Depends(context_dep),
                      db: Session = Depends(get_db)):
    return dcx.issue_part_url(db, ctx, job_id, body.part_id, body.reauth_proof)


@center_router.get('/download-audits', response_model=dc.DataCenterPage[de.DownloadAuditItem])
def download_audits(actor_id: UUID | None = Query(None), event: str | None = Query(None, max_length=40),
                    role: str | None = Query(None, max_length=20), purpose: str | None = Query(None, max_length=20),
                    job_id: UUID | None = Query(None), query: dc.DataCenterQuery = Depends(query_dep),
                    ctx: ResolvedContext = Depends(context_dep), db: Session = Depends(get_db)):
    return dcx.list_audits(db, ctx, query, actor_id=actor_id, event=event, role=role, purpose=purpose, job_id=job_id)


@center_router.post('/export-reauth', response_model=de.ExportProof)
async def export_reauth_endpoint(body: de.ExportReauthRequest, request: Request, ctx: ResolvedContext = Depends(context_dep),
                                 current_user: dict = Depends(get_current_user), db: Session = Depends(get_db),
                                 redis=Depends(get_redis)):
    """반출 전용 재인증(5분). 실패는 계정 단위로 제한한다(무차별 대입 방지)."""
    from starlette.concurrency import run_in_threadpool
    from app.services import export_reauth, login_attempt_service as attempts
    key = f"dcx:{current_user['email']}"
    await attempts.check_login_lock(key, redis)
    if body.scope_org_id is not None and body.scope_org_id != ctx.scope_org_id:
        raise policy_deny(409, 'org_scope_mismatch', '요청한 기관이 현재 선택한 기관과 다릅니다')
    social_verified = False
    try:
        await run_in_threadpool(export_reauth.check_reauth_method, db, ctx, body)
        if body.social_proof:
            # 소셜 제공자 재로그인을 거쳐 발급된 data_export 전용 1회용 proof 만 인정한다(원자 소비).
            from app.services import social_reauth_service as sr
            try:
                await sr.consume_proof(redis, body.social_proof, str(ctx.actor_id), sr.PURPOSE_DATA_EXPORT)
            except HTTPException:
                raise policy_deny(403, 'reauth_invalid', '재인증이 만료되었거나 유효하지 않습니다')
            social_verified = True
        proof = await run_in_threadpool(export_reauth.issue_export_proof, db, ctx, body, social_verified=social_verified)
    except HTTPException as exc:
        if isinstance(exc.detail, dict) and exc.detail.get('code') == 'reauth_invalid':
            await attempts.record_failed_attempt(key, redis)
        raise
    await attempts.reset_attempts(key, redis)
    return proof
