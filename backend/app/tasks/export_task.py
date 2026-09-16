"""SDD-071 export 전용 큐 작업 및 만료 객체 정리."""
from uuid import UUID

from app.core.celery_app import celery_app
from app.core.database import SessionLocal
from app.services.export_service import cleanup_expired, run_export


@celery_app.task(name='tasks.generate_data_export', soft_time_limit=1200, time_limit=1500)
def generate_data_export(export_id: str) -> None:
    with SessionLocal() as db:
        run_export(UUID(export_id), db)


@celery_app.task(name='tasks.cleanup_data_exports', soft_time_limit=240, time_limit=300)
def cleanup_data_exports() -> int:
    with SessionLocal() as db:
        return cleanup_expired(db)
