"""SDD-192: 웹 푸시(VAPID) 발송기.

- pywebpush 로 구독 endpoint 에 암호화 payload 를 전송한다. 외부 계정 불필요(VAPID 키 한 쌍).
- `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` 중 하나라도 없으면 `is_configured()` 가 False 이고
  발송은 **시도조차 하지 않는다**.
- 개인키·구독 endpoint 전체는 로그에 남기지 않는다(`mask_token` 만).
- 반환형은 FCM 발송기와 같은 `PushResult` — push_task 가 플랫폼 무관하게 처리한다.
"""

import json
import logging

from app.config import settings
from app.services.device_service import mask_token
from app.services.push_service import PushResult

logger = logging.getLogger(__name__)

REQUEST_TIMEOUT_SEC = 10
# 구독이 사라졌다는 뜻의 HTTP 상태 — 즉시 해지한다.
GONE_STATUS_CODES = frozenset({404, 410})


def is_configured() -> bool:
    return bool(settings.vapid_public_key) and bool(settings.vapid_private_key)


def public_key() -> str:
    return settings.vapid_public_key


def build_payload(*, title: str, body: str, data: dict[str, str]) -> str:
    """SW 가 읽는 JSON. 값은 모두 문자열(비식별 payload 규약 유지)."""
    return json.dumps(
        {"title": title, "body": body, "data": {str(k): str(v) for k, v in data.items()}},
        ensure_ascii=False,
    )


def send_to_subscription(
    endpoint: str, p256dh: str | None, auth: str | None, *, title: str, body: str, data: dict[str, str]
) -> PushResult:
    """단일 웹 구독 발송. 미설정·키 누락이면 시도하지 않고 실패 결과를 돌려준다."""
    if not is_configured():
        return PushResult(ok=False, error="웹 푸시 미설정")
    if not p256dh or not auth:
        return PushResult(ok=False, error="구독 키 없음", token_invalid=True)

    from pywebpush import WebPushException, webpush

    try:
        webpush(
            subscription_info={"endpoint": endpoint, "keys": {"p256dh": p256dh, "auth": auth}},
            data=build_payload(title=title, body=body, data=data),
            vapid_private_key=settings.vapid_private_key,
            vapid_claims={"sub": settings.vapid_subject},
            ttl=60 * 60,
            timeout=REQUEST_TIMEOUT_SEC,
        )
    except WebPushException as exc:
        status = getattr(getattr(exc, "response", None), "status_code", None)
        invalid = status in GONE_STATUS_CODES
        logger.warning(
            "[web_push_service] 발송 실패 sub=%s status=%s", mask_token(endpoint), status
        )
        return PushResult(ok=False, error=f"WebPush {status or 'error'}", token_invalid=invalid)
    except Exception as exc:  # noqa: BLE001 — 키/endpoint 내용은 로그에 남기지 않는다
        logger.warning(
            "[web_push_service] 전송 오류 sub=%s reason=%s", mask_token(endpoint), type(exc).__name__
        )
        return PushResult(ok=False, error=f"전송 오류({type(exc).__name__})")
    return PushResult(ok=True)
