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
# 서사 캐시의 주기적 업그레이드는 upgrade_narrative_cache_cron.py가 cron에서 실행한다.

# SDD-071: 생체 데이터 패키지 생성은 별도 큐에서 실행한다.
celery_app.conf.include = list(celery_app.conf.include) + ['app.tasks.export_task']
celery_app.conf.task_routes = {
    'tasks.generate_data_export': {'queue': 'exports'},
    'tasks.cleanup_data_exports': {'queue': 'exports'},
}
celery_app.conf.beat_schedule = {
    'cleanup-data-exports': {'task': 'tasks.cleanup_data_exports', 'schedule': 60.0},
}
