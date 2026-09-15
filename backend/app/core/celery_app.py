"""백엔드 비동기 작업과 정기 작업의 공용 Celery 진입점."""
from celery import Celery

from app.config import settings

celery_app = Celery(
    "mindbreeze",
    broker=settings.redis_url,
    include=[
        "app.tasks.stt_task",
        "app.tasks.summary_task",
        "app.tasks.report_task",
        "app.tasks.upgrade_narrative_cache",
    ],
)
celery_app.conf.beat_schedule = {
    "upgrade-narrative-cache-daily": {
        "task": "tasks.upgrade_narrative_cache",
        "schedule": 24 * 60 * 60,
        "kwargs": {"limit": 5},
    },
}
