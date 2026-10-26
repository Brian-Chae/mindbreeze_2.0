"""SDD-071 export 전용 큐 작업 및 만료 객체 정리."""
from uuid import UUID

from app.core.celery_app import celery_app
from app.core.database import SessionLocal
from app.services import data_center_runtime
from app.services.export_service import cleanup_expired, run_export

# SDD-243/244 통합: 워커 프로세스에도 실제 raw 반출 어댑터·측정 backend 를 등록한다(fake 로 폴백하지 않음).
data_center_runtime.install()


@celery_app.task(name='tasks.generate_data_export', soft_time_limit=1200, time_limit=1500)
def generate_data_export(export_id: str) -> None:
    with SessionLocal() as db:
        run_export(UUID(export_id), db)


@celery_app.task(name='tasks.cleanup_data_exports', soft_time_limit=240, time_limit=300)
def cleanup_data_exports() -> int:
    with SessionLocal() as db:
        from app.services import data_center_export
        data_center_export.expire_jobs(db)  # SDD-243: 상태 전이만(객체 삭제는 승인된 cleanup 에서 별도)
        return cleanup_expired(db)
