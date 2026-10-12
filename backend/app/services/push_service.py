"""SDD-190: FCM HTTP v1 푸시 발송기.

- 인증: 서비스 계정 OAuth2(google-auth, scope `firebase.messaging`). 액세스 토큰은
  google-auth 가 캐시·갱신하므로 Credentials 객체를 모듈에 1회 보관한다.
- 설정(`FCM_PROJECT_ID`, `FCM_SERVICE_ACCOUNT_JSON`) 중 하나라도 없으면
  `is_configured()` 가 False 이고, 발송은 **시도조차 하지 않는다**(자격증명 부재 환경 안전).
- iOS 는 FCM 을 통해 APNs 로 전달된다 — APNs 직접 연동은 없다.
- 토큰 값·서비스 계정 키는 로그에 남기지 않는다(`device_service.mask_token` 만).
"""

import json
import logging
import os
from dataclasses import dataclass

import httpx

from app.config import settings
from app.services.device_service import mask_token

logger = logging.getLogger(__name__)

FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging"
FCM_ENDPOINT = "https://fcm.googleapis.com/v1/projects/{project_id}/messages:send"
REQUEST_TIMEOUT_SEC = 10.0

# 토큰 자체가 무효라는 뜻의 FCM 오류 코드 — 해당 토큰을 즉시 해지한다.
INVALID_TOKEN_ERRORS = frozenset({"UNREGISTERED", "INVALID_ARGUMENT"})

_credentials = None


@dataclass
class PushResult:
    """1개 토큰에 대한 발송 결과. error 는 토큰 값이 섞이지 않은 비식별 문자열."""

    ok: bool
    error: str | None = None
    token_invalid: bool = False


def is_configured() -> bool:
    """프로젝트 ID + 서비스 계정이 모두 설정됐는지. False 면 발송 경로를 타지 않는다."""
    return bool(settings.fcm_project_id) and bool(settings.fcm_service_account_json)


def _service_account_info() -> dict:
    """설정값을 파일 경로 또는 JSON 문자열 중 맞는 쪽으로 해석해 dict 로 돌려준다."""
    raw = settings.fcm_service_account_json
    stripped = raw.strip()
    if stripped.startswith("{"):
        return json.loads(stripped)
    if not os.path.exists(stripped):
        raise RuntimeError("FCM 서비스 계정 설정이 JSON 도 파일 경로도 아닙니다")
    with open(stripped, encoding="utf-8") as fp:
        return json.load(fp)


def _get_access_token() -> str:
    """서비스 계정으로 OAuth2 액세스 토큰 발급(만료 시 갱신)."""
    global _credentials

    from google.auth.transport.requests import Request as GoogleAuthRequest
    from google.oauth2 import service_account

    if _credentials is None:
        _credentials = service_account.Credentials.from_service_account_info(
            _service_account_info(), scopes=[FCM_SCOPE]
        )
    if not _credentials.valid:
        _credentials.refresh(GoogleAuthRequest())
    return _credentials.token


def reset_credentials_cache() -> None:
    """설정이 바뀐 경우(테스트 포함) 캐시된 Credentials 를 버린다."""
    global _credentials
    _credentials = None


def _extract_error(response: httpx.Response) -> tuple[str, bool]:
    """(비식별 사유, 토큰 무효 여부) — 응답 본문의 FCM status 코드만 읽는다."""
    status_code = response.status_code
    code = ""
    try:
        body = response.json()
        error = body.get("error", {}) if isinstance(body, dict) else {}
        code = str(error.get("status") or "")
    except ValueError:
        code = ""

    token_invalid = status_code == 404 or code in INVALID_TOKEN_ERRORS
    reason = f"FCM {status_code}" + (f" {code}" if code else "")
    return reason, token_invalid


def build_message(token: str, *, title: str, body: str, data: dict[str, str]) -> dict:
    """FCM v1 메시지 본문. data 값은 모두 문자열이어야 한다(FCM 규격)."""
    return {
        "message": {
            "token": token,
            "notification": {"title": title, "body": body},
            "data": {str(k): str(v) for k, v in data.items()},
        }
    }


def send_to_token(token: str, *, title: str, body: str, data: dict[str, str]) -> PushResult:
    """단일 토큰 발송. 미설정이면 시도하지 않고 실패(비발송) 결과를 돌려준다."""
    if not is_configured():
        return PushResult(ok=False, error="FCM 미설정")

    url = FCM_ENDPOINT.format(project_id=settings.fcm_project_id)
    try:
        access_token = _get_access_token()
    except Exception as exc:  # noqa: BLE001 — 키 내용은 로그에 남기지 않는다
        logger.error("[push_service] 액세스 토큰 발급 실패: %s", type(exc).__name__)
        return PushResult(ok=False, error=f"인증 실패({type(exc).__name__})")

    try:
        with httpx.Client(timeout=REQUEST_TIMEOUT_SEC) as http:
            response = http.post(
                url,
                json=build_message(token, title=title, body=body, data=data),
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": "application/json; charset=UTF-8",
                },
            )
    except httpx.HTTPError as exc:
        logger.warning(
            "[push_service] 전송 오류 token=%s reason=%s", mask_token(token), type(exc).__name__
        )
        return PushResult(ok=False, error=f"전송 오류({type(exc).__name__})")

    if response.status_code == 200:
        return PushResult(ok=True)

    reason, token_invalid = _extract_error(response)
    logger.warning("[push_service] 발송 실패 token=%s reason=%s", mask_token(token), reason)
    return PushResult(ok=False, error=reason, token_invalid=token_invalid)
