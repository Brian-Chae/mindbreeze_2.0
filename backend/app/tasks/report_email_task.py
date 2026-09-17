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


# SDD-073: 가입 신청 운영 알림. mindbreeze-email-worker 가 이 모듈(email_app)을
# 로드하므로 같은 앱 인스턴스에 태스크를 등록해야 worker 가 소비한다.
@email_app.task(name="tasks.signup_application_notice", autoretry_for=(RuntimeError,),
                retry_backoff=True, retry_kwargs={"max_retries": 3})
def signup_notice_task(application_id: str) -> None:
    from app.core.database import SessionLocal
    from app.services.signup_application_service import deliver_signup_notice
    with SessionLocal() as db:
        if deliver_signup_notice(application_id, db) == "failed":
            raise RuntimeError("가입 신청 알림 메일 발송 실패")


# SDD-081: 기관 해제 → 개인 상담소 전환 안내 메일. email_app 에 등록해야
# mindbreeze-email-worker 가 소비한다 (signup_notice 와 동일 패턴).
@email_app.task(name="tasks.org_removed_notice", autoretry_for=(RuntimeError,),
                retry_backoff=True, retry_kwargs={"max_retries": 3})
def org_removed_notice_task(user_id: str, org_name: str, office_name: str) -> None:
    from app.core.database import SessionLocal
    from app.services.personal_office_service import deliver_org_removed_notice
    with SessionLocal() as db:
        if deliver_org_removed_notice(user_id, org_name, office_name, db) == "failed":
            raise RuntimeError("기관 해제 안내 메일 발송 실패")
