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
