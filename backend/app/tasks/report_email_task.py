"""SDD-029: 기존 Celery 패턴과 Resend 발송 함수를 재사용한다."""
from celery import Celery
from app.config import settings

# 명시적 Redis 브로커로 실행: celery -A app.tasks.report_email_task:email_app worker
email_app = Celery("report_email", broker=settings.redis_url)
email_app.conf.broker_connection_timeout = 3


@email_app.task(name="tasks.report_email", autoretry_for=(RuntimeError,), retry_backoff=True,
                retry_kwargs={"max_retries": 3})
def report_email_task(report_id: str) -> None:
    from app.core.database import SessionLocal
    from app.services.report_email_service import deliver_report_email
    with SessionLocal() as db:
        if deliver_report_email(report_id, db) == "failed":
            raise RuntimeError("리포트 메일 발송 실패")
