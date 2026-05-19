"""이메일 발송 — AWS SES (boto3)

개발 모드(debug=True): 콘솔 로그 출력
운영 모드: SES로 실제 발송
"""

import logging

import boto3
from botocore.exceptions import ClientError

from app.config import settings

logger = logging.getLogger(__name__)


def _send_email(to_email: str, subject: str, body_text: str) -> bool:
    """SES로 이메일 발송. 실패 시 로그만 남기고 False 반환."""
    if settings.debug:
        logger.info(f"[EMAIL] To: {to_email} | Subject: {subject}")
        logger.info(f"[EMAIL] Body: {body_text[:200]}")
        return True

    try:
        client = boto3.client("ses", region_name=settings.aws_region)
        client.send_email(
            Source=settings.ses_from_email,
            Destination={"ToAddresses": [to_email]},
            Message={
                "Subject": {"Data": subject, "Charset": "UTF-8"},
                "Body": {"Text": {"Data": body_text, "Charset": "UTF-8"}},
            },
        )
        logger.info(f"[EMAIL] 발송 성공 → {to_email}")
        return True
    except ClientError as e:
        logger.error(f"[EMAIL] 발송 실패 → {to_email}: {e}")
        return False


def send_otp_email(to_email: str, otp_code: str):
    """OTP 코드 이메일 발송"""
    subject = "[MIND BREEZE] 이메일 인증 코드"
    body = (
        f"안녕하세요, MIND BREEZE입니다.\n\n"
        f"이메일 인증 코드: {otp_code}\n\n"
        f"이 코드는 10분간 유효합니다.\n"
        f"본인이 요청하지 않은 경우 이 메일을 무시해주세요.\n\n"
        f"감사합니다.\n"
        f"MIND BREEZE 팀"
    )
    return _send_email(to_email, subject, body)


def send_password_reset_email(to_email: str, reset_link: str):
    """비밀번호 재설정 링크 이메일 발송"""
    subject = "[MIND BREEZE] 비밀번호 재설정"
    body = (
        f"안녕하세요, MIND BREEZE입니다.\n\n"
        f"비밀번호 재설정을 요청하셨습니다.\n"
        f"아래 링크를 클릭하여 새 비밀번호를 설정해주세요:\n\n"
        f"{reset_link}\n\n"
        f"이 링크는 30분간 유효합니다.\n"
        f"본인이 요청하지 않은 경우 이 메일을 무시해주세요.\n\n"
        f"감사합니다.\n"
        f"MIND BREEZE 팀"
    )
    return _send_email(to_email, subject, body)
