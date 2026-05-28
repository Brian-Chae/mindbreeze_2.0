"""이메일 발송 — Resend REST API

개발 모드(debug=True): 콘솔 로그 출력
운영 모드: Resend로 실제 발송
"""

import logging

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

RESEND_API = "https://api.resend.com/emails"


def _send_email(to_email: str, subject: str, body_text: str, body_html: str | None = None) -> bool:
    """Resend로 이메일 발송. 실패 시 로그만 남기고 False 반환."""
    if settings.debug and not settings.resend_api_key:
        logger.info(f"[EMAIL DEBUG] To: {to_email} | Subject: {subject}")
        logger.info(f"[EMAIL DEBUG] Body: {body_text[:200]}")
        return True

    payload: dict = {
        "from": settings.resend_from_email,
        "to": [to_email],
        "subject": subject,
        "text": body_text,
    }
    if body_html:
        payload["html"] = body_html

    try:
        with httpx.Client(timeout=10) as client:
            resp = client.post(
                RESEND_API,
                headers={
                    "Authorization": f"Bearer {settings.resend_api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
        if resp.is_success:
            logger.info(f"[EMAIL] 발송 성공 → {to_email} (id={resp.json().get('id', '?')})")
            return True
        else:
            logger.error(f"[EMAIL] 발송 실패 → {to_email}: {resp.status_code} {resp.text[:200]}")
            return False
    except Exception as e:
        logger.error(f"[EMAIL] 예외 발생 → {to_email}: {e}")
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


def send_invite_email(to_email: str, invite_url: str, counselor_name: str, counselor_code: str):
    """내담자 초대 이메일 발송 (HTML 템플릿)"""
    subject = f"[MIND BREEZE] {counselor_name} 상담사님의 초대"

    body_text = (
        f"안녕하세요, MIND BREEZE입니다.\n\n"
        f"{counselor_name} 상담사님께서 MIND BREEZE에 초대하셨습니다.\n\n"
        f"상담사 코드: {counselor_code}\n\n"
        f"아래 링크를 클릭하여 가입하시면 자동으로 상담사-내담자 관계가 연결됩니다:\n\n"
        f"{invite_url}\n\n"
        f"이 초대 링크는 7일간 유효합니다.\n"
        f"본인이 요청하지 않은 경우 이 메일을 무시해주세요.\n\n"
        f"감사합니다.\n"
        f"MIND BREEZE 팀"
    )

    body_html = f"""\
<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:linear-gradient(135deg,#0F0A1A 0%,#1A0F2E 50%,#0D1B2A 100%);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Apple SD Gothic Neo',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;">
  <tr>
    <td align="center">
      <!-- Logo -->
      <table cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
        <tr>
          <td align="center">
            <img src="http://dev.mindbreeze.looxidlabs.com/mb-design/assets/logo_symbol_dark.svg" width="52" height="24" alt="MIND BREEZE" style="filter:brightness(0) invert(1);display:block;margin:0 auto 12px;" />
            <div style="font-size:15px;font-weight:600;color:#E8D5F8;letter-spacing:2px;">MIND BREEZE</div>
          </td>
        </tr>
      </table>

      <!-- Main Card -->
      <table cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:rgba(255,255,255,0.08);border-radius:20px;border:1px solid rgba(255,255,255,0.12);padding:40px 32px;backdrop-filter:blur(12px);">
        <!-- Header -->
        <tr>
          <td style="padding-bottom:24px;text-align:center;">
            <div style="font-size:20px;font-weight:700;color:#FFFFFF;line-height:1.4;">
              {counselor_name} 상담사님의 초대
            </div>
            <div style="font-size:14px;color:#A78BFA;margin-top:8px;">
              MIND BREEZE에서 상담을 시작하세요
            </div>
          </td>
        </tr>

        <!-- Counselor Code -->
        <tr>
          <td style="padding-bottom:28px;">
            <table cellpadding="0" cellspacing="0" width="100%" style="background:rgba(95,0,128,0.2);border-radius:14px;border:1px solid rgba(95,0,128,0.3);padding:20px 0;">
              <tr>
                <td align="center">
                  <div style="font-size:12px;color:#A78BFA;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;">상담사 코드</div>
                  <div style="font-size:32px;font-weight:800;color:#C38BFF;letter-spacing:12px;font-family:'SF Mono','Menlo','Consolas',monospace;">{counselor_code}</div>
                  <div style="font-size:12px;color:#7C6F9A;margin-top:8px;">온보딩 시 이 코드를 입력하세요</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- CTA Button -->
        <tr>
          <td align="center" style="padding-bottom:24px;">
            <a href="{invite_url}" style="display:inline-block;padding:14px 40px;background:#5F0080;color:#FFFFFF;font-size:16px;font-weight:700;text-decoration:none;border-radius:40px;letter-spacing:1px;">
              MIND BREEZE 시작하기
            </a>
          </td>
        </tr>

        <!-- Link fallback -->
        <tr>
          <td align="center" style="padding-bottom:20px;">
            <div style="font-size:12px;color:#7C6F9A;">
              버튼이 작동하지 않으면 아래 링크를 복사하세요
            </div>
            <div style="font-size:11px;color:#5F4A7A;word-break:break-all;margin-top:6px;">
              {invite_url}
            </div>
          </td>
        </tr>

        <!-- Divider -->
        <tr>
          <td style="padding-bottom:20px;">
            <div style="height:1px;background:rgba(255,255,255,0.08);"></div>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td align="center">
            <div style="font-size:11px;color:#5F4A7A;line-height:1.6;">
              이 초대 링크는 7일간 유효합니다.<br>
              본인이 요청하지 않은 경우 이 메일을 무시해주세요.
            </div>
            <div style="font-size:10px;color:#3D2E54;margin-top:12px;">
              © Looxid Labs · MIND BREEZE
            </div>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>"""

    return _send_email(to_email, subject, body_text, body_html)
