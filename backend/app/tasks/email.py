"""이메일 발송 — Resend REST API

개발 모드(debug=True): 콘솔 로그 출력
운영 모드: Resend로 실제 발송
"""

import logging

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

RESEND_API = "https://api.resend.com/emails"


def _mask_email(email: str) -> str:
    """로그용 이메일 마스킹 — 로컬파트 앞 2자만 남긴다. (예: br***@corp.com)"""
    if not email or "@" not in email:
        return "***"
    local, _, domain = email.partition("@")
    head = local[:2]
    return f"{head}{'*' * max(len(local) - 2, 1)}@{domain}"


def _send_email(to_email: str, subject: str, body_text: str, body_html: str | None = None) -> bool:
    """Resend로 이메일 발송. 실패 시 로그만 남기고 False 반환."""
    if settings.debug and not settings.resend_api_key:
        # SDD-016: 본문에는 초대 토큰·재설정 링크·OTP 등 비밀 값이 들어있으므로
        # 디버그 모드라도 본문을 로그에 남기지 않는다. 수신자와 제목, 길이만 기록한다.
        logger.info(
            f"[EMAIL DEBUG] To: {_mask_email(to_email)} | Subject: {subject} "
            f"| Body: <{len(body_text)}자 생략>"
        )
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
            logger.info(f"[EMAIL] 발송 성공 → {_mask_email(to_email)} (id={resp.json().get('id', '?')})")
            return True
        else:
            logger.error(f"[EMAIL] 발송 실패 → {_mask_email(to_email)}: {resp.status_code}")
            return False
    except Exception as e:
        logger.error(f"[EMAIL] 예외 발생 → {_mask_email(to_email)}: {e}")
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


def send_invite_email(to_email: str, invite_url: str, counselor_name: str):
    """내담자 초대 이메일 발송 (HTML 템플릿).

    - 상담사 코드는 더 이상 사용하지 않으므로 표시하지 않는다.
    - 로고는 이메일 클라이언트에서 CSS filter/외부 이미지 차단으로 깨질 수 있어
      텍스트 로고로 대체한다 (기관/상담사 초대 메일과 동일한 밝은 테마).
    """
    subject = f"[MIND BREEZE] {counselor_name} 상담사님의 초대"

    body_text = (
        f"안녕하세요, MIND BREEZE입니다.\n\n"
        f"{counselor_name} 상담사님께서 MIND BREEZE에 초대하셨습니다.\n\n"
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
<body style="margin:0;padding:0;background:#F4F1F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Apple SD Gothic Neo',sans-serif;color:#1F1630;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;background:#F4F1F8;">
  <tr>
    <td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border:1px solid #E9E2F2;border-radius:24px;overflow:hidden;box-shadow:0 10px 30px rgba(31,22,48,0.08);">
        <tr>
          <td style="padding:32px 32px 20px;background:linear-gradient(135deg,#21112F 0%,#4A1F6A 100%);text-align:center;">
            <div style="font-size:13px;line-height:20px;font-weight:700;letter-spacing:1.6px;color:#DCC8F2;">MIND BREEZE</div>
            <div style="margin-top:10px;font-size:26px;line-height:36px;font-weight:800;color:#FFFFFF;">내담자 초대</div>
            <div style="margin-top:8px;font-size:14px;line-height:22px;color:#E9DDF8;">가입하면 상담사-내담자 관계가 자동으로 연결됩니다.</div>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 32px 32px;">
            <div style="font-size:16px;line-height:26px;color:#2A1C3D;">안녕하세요.</div>
            <div style="margin-top:12px;font-size:15px;line-height:24px;color:#4A3B5F;">
              <strong style="color:#2A1C3D;">{counselor_name}</strong> 상담사님께서 MIND BREEZE에 초대하셨습니다.<br>
              아래 버튼을 눌러 가입을 완료하세요.
            </div>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;background:#F7F3FB;border:1px solid #E7DCF5;border-radius:16px;">
              <tr>
                <td style="padding:18px 20px;">
                  <div style="font-size:12px;line-height:18px;font-weight:700;letter-spacing:1px;color:#7A4FB0;text-transform:uppercase;">안내</div>
                  <div style="margin-top:8px;font-size:14px;line-height:22px;color:#5C4A73;">이 초대 링크는 7일간 유효합니다.</div>
                </td>
              </tr>
            </table>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:28px;">
              <tr>
                <td align="center">
                  <a href="{invite_url}" style="display:inline-block;background:#5F0080;color:#FFFFFF;text-decoration:none;font-size:16px;line-height:24px;font-weight:800;padding:14px 28px;border-radius:999px;">
                    초대 수락하기
                  </a>
                </td>
              </tr>
            </table>
            <div style="margin-top:24px;font-size:13px;line-height:21px;color:#7A6A90;">
              버튼이 작동하지 않으면 아래 링크를 복사해서 브라우저에 붙여넣어 주세요.
            </div>
            <div style="margin-top:8px;font-size:12px;line-height:20px;color:#6A4A92;word-break:break-all;">
              {invite_url}
            </div>
            <div style="margin-top:24px;padding-top:20px;border-top:1px solid #EFE8F7;font-size:13px;line-height:22px;color:#7A6A90;">
              본인이 요청하지 않았다면 이 메일을 무시해 주세요.
            </div>
            <div style="margin-top:24px;font-size:14px;line-height:22px;color:#4A3B5F;">
              감사합니다.<br>MIND BREEZE 드림
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


def send_org_invite_email(
    to_email: str,
    invite_link: str,
    *,
    admin_name: str,
    org_name: str,
    expires_days: int,
) -> bool:
    """기관 담당자 초대 — 비밀번호 설정 링크 발송 (SDD-016).

    임시 비밀번호를 보내지 않고, 일회용 설정 링크만 전달한다.
    """
    subject = "[MIND BREEZE] 기관 담당자 계정 비밀번호 설정 안내"
    body_text = (
        f"{admin_name}님, 안녕하세요.\n\n"
        f"MIND BREEZE에 '{org_name}' 기관 담당자로 등록되었습니다.\n"
        f"아래 링크에서 비밀번호를 설정하시면 계정이 활성화됩니다.\n\n"
        f"{invite_link}\n\n"
        f"· 이 링크는 {expires_days}일간 유효하며 한 번만 사용할 수 있습니다.\n"
        f"· 링크가 만료된 경우 플랫폼 관리자에게 재발송을 요청해 주세요.\n"
        f"· 본인이 요청하지 않았다면 이 메일을 무시해 주세요.\n\n"
        f"감사합니다.\nMIND BREEZE 드림"
    )
    body_html = f"""\
<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#F4F1F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Apple SD Gothic Neo',sans-serif;color:#1F1630;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;background:#F4F1F8;">
  <tr>
    <td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border:1px solid #E9E2F2;border-radius:24px;overflow:hidden;box-shadow:0 10px 30px rgba(31,22,48,0.08);">
        <tr>
          <td style="padding:32px 32px 20px;background:linear-gradient(135deg,#21112F 0%,#4A1F6A 100%);text-align:center;">
            <div style="font-size:13px;line-height:20px;font-weight:700;letter-spacing:1.6px;color:#DCC8F2;">MIND BREEZE</div>
            <div style="margin-top:10px;font-size:26px;line-height:36px;font-weight:800;color:#FFFFFF;">기관 담당자 계정 초대</div>
            <div style="margin-top:8px;font-size:14px;line-height:22px;color:#E9DDF8;">비밀번호를 설정하면 바로 관리자 페이지에 접속할 수 있습니다.</div>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 32px 32px;">
            <div style="font-size:16px;line-height:26px;color:#2A1C3D;">{admin_name}님, 안녕하세요.</div>
            <div style="margin-top:12px;font-size:15px;line-height:24px;color:#4A3B5F;">
              MIND BREEZE에 <strong style="color:#2A1C3D;">{org_name}</strong> 기관 담당자로 등록되었습니다.<br>
              아래 버튼에서 비밀번호를 설정하시면 계정이 활성화됩니다.
            </div>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;background:#F7F3FB;border:1px solid #E7DCF5;border-radius:16px;">
              <tr>
                <td style="padding:18px 20px;">
                  <div style="font-size:12px;line-height:18px;font-weight:700;letter-spacing:1px;color:#7A4FB0;text-transform:uppercase;">안내</div>
                  <div style="margin-top:8px;font-size:14px;line-height:22px;color:#5C4A73;">
                    이 링크는 {expires_days}일간 유효하며 1회만 사용할 수 있습니다.
                  </div>
                </td>
              </tr>
            </table>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:28px;">
              <tr>
                <td align="center">
                  <a href="{invite_link}" style="display:inline-block;background:#5F0080;color:#FFFFFF;text-decoration:none;font-size:16px;line-height:24px;font-weight:800;padding:14px 28px;border-radius:999px;">
                    비밀번호 설정하기
                  </a>
                </td>
              </tr>
            </table>
            <div style="margin-top:24px;font-size:13px;line-height:21px;color:#7A6A90;">
              버튼이 작동하지 않으면 아래 링크를 복사해서 브라우저에 붙여넣어 주세요.
            </div>
            <div style="margin-top:8px;font-size:12px;line-height:20px;color:#6A4A92;word-break:break-all;">
              {invite_link}
            </div>
            <div style="margin-top:24px;padding-top:20px;border-top:1px solid #EFE8F7;font-size:13px;line-height:22px;color:#7A6A90;">
              • 본인이 요청하지 않았다면 이 메일을 무시해 주세요.<br>
              • 링크가 만료된 경우 플랫폼 관리자에게 재발송을 요청해 주세요.
            </div>
            <div style="margin-top:24px;font-size:14px;line-height:22px;color:#4A3B5F;">
              감사합니다.<br>MIND BREEZE 드림
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


def send_counselor_invite_email(
    to_email: str,
    invite_link: str,
    *,
    admin_name: str,
    org_name: str,
    expires_days: int,
) -> bool:
    """상담사 초대 — 비밀번호 설정 링크 발송 (SDD-017).

    기관 담당자가 이름+이메일로 초대한 상담사에게 보내는 메일이다.
    org 담당자 초대와 동일한 HTML 버튼형 템플릿을 쓰되 카피만 '상담사 초대'로 바꾼다.
    ``admin_name`` 은 수신자(상담사) 본인의 이름이다.
    """
    subject = "[MIND BREEZE] 상담사 계정 비밀번호 설정 안내"
    body_text = (
        f"{admin_name}님, 안녕하세요.\n\n"
        f"MIND BREEZE에 '{org_name}' 기관 소속 상담사로 초대되었습니다.\n"
        f"아래 링크에서 비밀번호를 설정하시면 계정이 활성화됩니다.\n\n"
        f"{invite_link}\n\n"
        f"· 이 링크는 {expires_days}일간 유효하며 한 번만 사용할 수 있습니다.\n"
        f"· 링크가 만료된 경우 기관 담당자에게 재발송을 요청해 주세요.\n"
        f"· 본인이 요청하지 않았다면 이 메일을 무시해 주세요.\n\n"
        f"감사합니다.\nMIND BREEZE 드림"
    )
    body_html = f"""\
<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#F4F1F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Apple SD Gothic Neo',sans-serif;color:#1F1630;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;background:#F4F1F8;">
  <tr>
    <td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border:1px solid #E9E2F2;border-radius:24px;overflow:hidden;box-shadow:0 10px 30px rgba(31,22,48,0.08);">
        <tr>
          <td style="padding:32px 32px 20px;background:linear-gradient(135deg,#21112F 0%,#4A1F6A 100%);text-align:center;">
            <div style="font-size:13px;line-height:20px;font-weight:700;letter-spacing:1.6px;color:#DCC8F2;">MIND BREEZE</div>
            <div style="margin-top:10px;font-size:26px;line-height:36px;font-weight:800;color:#FFFFFF;">상담사 계정 초대</div>
            <div style="margin-top:8px;font-size:14px;line-height:22px;color:#E9DDF8;">비밀번호를 설정하면 바로 상담사 대시보드에 접속할 수 있습니다.</div>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 32px 32px;">
            <div style="font-size:16px;line-height:26px;color:#2A1C3D;">{admin_name}님, 안녕하세요.</div>
            <div style="margin-top:12px;font-size:15px;line-height:24px;color:#4A3B5F;">
              MIND BREEZE에 <strong style="color:#2A1C3D;">{org_name}</strong> 기관 소속 상담사로 초대되었습니다.<br>
              아래 버튼에서 비밀번호를 설정하시면 계정이 활성화됩니다.
            </div>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;background:#F7F3FB;border:1px solid #E7DCF5;border-radius:16px;">
              <tr>
                <td style="padding:18px 20px;">
                  <div style="font-size:12px;line-height:18px;font-weight:700;letter-spacing:1px;color:#7A4FB0;text-transform:uppercase;">안내</div>
                  <div style="margin-top:8px;font-size:14px;line-height:22px;color:#5C4A73;">
                    이 링크는 {expires_days}일간 유효하며 1회만 사용할 수 있습니다.
                  </div>
                </td>
              </tr>
            </table>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:28px;">
              <tr>
                <td align="center">
                  <a href="{invite_link}" style="display:inline-block;background:#5F0080;color:#FFFFFF;text-decoration:none;font-size:16px;line-height:24px;font-weight:800;padding:14px 28px;border-radius:999px;">
                    비밀번호 설정하기
                  </a>
                </td>
              </tr>
            </table>
            <div style="margin-top:24px;font-size:13px;line-height:21px;color:#7A6A90;">
              버튼이 작동하지 않으면 아래 링크를 복사해서 브라우저에 붙여넣어 주세요.
            </div>
            <div style="margin-top:8px;font-size:12px;line-height:20px;color:#6A4A92;word-break:break-all;">
              {invite_link}
            </div>
            <div style="margin-top:24px;padding-top:20px;border-top:1px solid #EFE8F7;font-size:13px;line-height:22px;color:#7A6A90;">
              • 본인이 요청하지 않았다면 이 메일을 무시해 주세요.<br>
              • 링크가 만료된 경우 기관 담당자에게 재발송을 요청해 주세요.
            </div>
            <div style="margin-top:24px;font-size:14px;line-height:22px;color:#4A3B5F;">
              감사합니다.<br>MIND BREEZE 드림
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


def send_client_invite_email(
    to_email: str,
    invite_link: str,
    *,
    client_name: str,
    counselor_name: str,
    expires_days: int,
) -> bool:
    """플랫폼 관리자가 수동 추가한 내담자에게 보내는 비밀번호 설정 초대 메일 (SDD-020).

    기존 ``send_invite_email`` (상담사 코드 기반 /invite 가입 링크) 과 달리,
    이미 pending 계정이 생성된 상태이므로 ``/set-password`` 링크로 비밀번호를
    설정하면 곧바로 계정이 활성화된다. org/상담사 초대와 동일한 밝은 테마의
    버튼형 템플릿을 재사용하되 카피만 내담자용으로 바꾼다.
    """
    subject = "[MIND BREEZE] 회원 계정 비밀번호 설정 안내"
    body_text = (
        f"{client_name}님, 안녕하세요.\n\n"
        f"MIND BREEZE에 {counselor_name} 상담사님의 회원으로 초대되었습니다.\n"
        f"아래 링크에서 비밀번호를 설정하시면 계정이 활성화됩니다.\n\n"
        f"{invite_link}\n\n"
        f"· 이 링크는 {expires_days}일간 유효하며 한 번만 사용할 수 있습니다.\n"
        f"· 링크가 만료된 경우 담당 상담사 또는 관리자에게 재발송을 요청해 주세요.\n"
        f"· 본인이 요청하지 않았다면 이 메일을 무시해 주세요.\n\n"
        f"감사합니다.\nMIND BREEZE 드림"
    )
    body_html = f"""\
<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#F4F1F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Apple SD Gothic Neo',sans-serif;color:#1F1630;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;background:#F4F1F8;">
  <tr>
    <td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border:1px solid #E9E2F2;border-radius:24px;overflow:hidden;box-shadow:0 10px 30px rgba(31,22,48,0.08);">
        <tr>
          <td style="padding:32px 32px 20px;background:linear-gradient(135deg,#21112F 0%,#4A1F6A 100%);text-align:center;">
            <div style="font-size:13px;line-height:20px;font-weight:700;letter-spacing:1.6px;color:#DCC8F2;">MIND BREEZE</div>
            <div style="margin-top:10px;font-size:26px;line-height:36px;font-weight:800;color:#FFFFFF;">회원 계정 초대</div>
            <div style="margin-top:8px;font-size:14px;line-height:22px;color:#E9DDF8;">비밀번호를 설정하면 바로 서비스를 이용할 수 있습니다.</div>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 32px 32px;">
            <div style="font-size:16px;line-height:26px;color:#2A1C3D;">{client_name}님, 안녕하세요.</div>
            <div style="margin-top:12px;font-size:15px;line-height:24px;color:#4A3B5F;">
              MIND BREEZE에 <strong style="color:#2A1C3D;">{counselor_name}</strong> 상담사님의 회원으로 초대되었습니다.<br>
              아래 버튼에서 비밀번호를 설정하시면 계정이 활성화됩니다.
            </div>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:28px;">
              <tr>
                <td align="center">
                  <a href="{invite_link}" style="display:inline-block;background:#5F0080;color:#FFFFFF;text-decoration:none;font-size:16px;line-height:24px;font-weight:800;padding:14px 28px;border-radius:999px;">
                    비밀번호 설정하기
                  </a>
                </td>
              </tr>
            </table>
            <div style="margin-top:24px;font-size:13px;line-height:21px;color:#7A6A90;">
              버튼이 작동하지 않으면 아래 링크를 복사해서 브라우저에 붙여넣어 주세요.
            </div>
            <div style="margin-top:8px;font-size:12px;line-height:20px;color:#6A4A92;word-break:break-all;">
              {invite_link}
            </div>
            <div style="margin-top:24px;padding-top:20px;border-top:1px solid #EFE8F7;font-size:13px;line-height:22px;color:#7A6A90;">
              • 이 링크는 {expires_days}일간 유효하며 1회만 사용할 수 있습니다.<br>
              • 본인이 요청하지 않았다면 이 메일을 무시해 주세요.
            </div>
            <div style="margin-top:24px;font-size:14px;line-height:22px;color:#4A3B5F;">
              감사합니다.<br>MIND BREEZE 드림
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
