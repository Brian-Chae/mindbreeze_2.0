"""백엔드 비동기 작업과 정기 작업의 공용 Celery 진입점."""
from celery import Celery

from app.config import settings

celery_app = Celery(
    "mindbreeze",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=[
        "app.tasks.stt_task",
        "app.tasks.summary_task",
        "app.tasks.report_task",
        "app.tasks.video_task",
        "app.tasks.upgrade_narrative_cache",
        "app.tasks.outbox",
        "app.tasks.reminder_task",
        "app.tasks.session_task",
        "app.tasks.pipeline_outbox_task",
        # EEG-RAW-03 / EEG-RET-01: 스테일·보관기간 경과 raw 청크 정리 스윕.
        "app.tasks.eeg_raw_task",
    ],
)
# INFRA-08: 주기 작업의 단일 소스는 OS cron(배포 시 등록)이다.
#   — celery beat_schedule 은 제거했다. export-beat 서비스가 전체 스케줄을 중복 실행해
#     cron 과 이중 실행되는 문제가 있었고, 실제 실행 주체는 아래 *_cron.py 들이다
#     (upgrade_narrative_cache_cron.py 포함).

# SDD-071: 생체 데이터 패키지 생성은 별도 큐에서 실행한다.
celery_app.conf.include = list(celery_app.conf.include) + ['app.tasks.export_task']
celery_app.conf.task_routes = {
    'tasks.generate_data_export': {'queue': 'exports'},
    'tasks.cleanup_data_exports': {'queue': 'exports'},
}

