"""이메일 발송 Celery 태스크

개발 단계: 콘솔 로그 출력
운영: SMTP/SES 연동
"""

import logging

logger = logging.getLogger(__name__)

# Celery 앱 import (지연 import로 순환 참조 방지)
# from app.tasks.celery_app import celery_app


def send_otp_email(to_email: str, otp_code: str):
    """OTP 코드 이메일 발송"""
    # TODO: 운영 환경에서 Celery 태스크로 전환
    # @celery_app.task
    # def _send_otp_email(to_email: str, otp_code: str):
    #     ...
    logger.info(f"[EMAIL] OTP 발송 → {to_email}: {otp_code}")
    return True


def send_password_reset_email(to_email: str, reset_link: str):
    """비밀번호 재설정 링크 이메일 발송"""
    logger.info(f"[EMAIL] 비밀번호 재설정 링크 발송 → {to_email}: {reset_link}")
    return True
