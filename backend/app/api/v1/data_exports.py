"""SDD-071 인증 사용자 전용 분석용 다운로드 API."""
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Response
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

from app.api.v1.data_center import backend_dep, context_dep  # noqa: E402
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
    job = dcx.create_data_center_export(db, ctx, body.preview_token, body.reason, body.reauth_proof, idempotency_key)
    return dcx.status_payload(db, job)


@center_router.get('/exports', response_model=de.DataCenterExportPage)
def list_center_exports(limit: int = Query(25, ge=1, le=100), cursor: str | None = Query(None, max_length=200),
                        ctx: ResolvedContext = Depends(context_dep), db: Session = Depends(get_db)):
    return dcx.list_exports(db, ctx, limit, cursor)


@center_router.get('/exports/{job_id}', response_model=de.DataCenterExportStatus)
def get_center_export(job_id: UUID, ctx: ResolvedContext = Depends(context_dep), db: Session = Depends(get_db)):
    return dcx.get_export(db, ctx, job_id)
