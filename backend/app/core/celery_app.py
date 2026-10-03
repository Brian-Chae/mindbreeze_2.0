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
    # SDD-097: 예약 클래스 리마인더 스윕 — ETA 유실/누락분을 주기적으로 보정한다.
    'sweep-session-reminders': {'task': 'tasks.sweep_session_reminders', 'schedule': 300.0},
    # SDD-095 후속: 리포트 생성 타임아웃 워치독 — processing 먹통을 주기적으로 마감한다.
    'sweep-stale-reports': {'task': 'tasks.sweep_stale_reports', 'schedule': 300.0},
    # SDD-100: open 상태 방치 세션 자동 취소 — 스테일 클래스 정리.
    'sweep-stale-open-sessions': {'task': 'tasks.sweep_stale_open_sessions', 'schedule': 300.0},
    # SDD-101: 종료 파이프라인 발행 아웃박스 재발행 — 발행 유실 복구.
    'process-pipeline-outbox': {'task': 'tasks.process_pipeline_outbox', 'schedule': 30.0},
}
