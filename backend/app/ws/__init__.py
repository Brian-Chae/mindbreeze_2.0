"""WebSocket (Socket.IO) — 네임스페이스 모음

WS-01: Celery 워커와 웹 프로세스가 서로 다른 프로세스이므로, 워커가 emit 해도
웹 프로세스가 관리하는 소켓으로 전달되려면 Redis 메시지 큐(manager)가 필요하다.
Redis 미연결(로컬/테스트) 환경에서는 예외 없이 인메모리로만 동작하도록 graceful 하게 처리한다.
"""

import logging
import os
import socket
import sys
from urllib.parse import urlparse

import socketio

from app.config import settings

logger = logging.getLogger(__name__)

# WS-01: Celery 워커 ↔ 웹 프로세스 간 broadcast 를 잇는 Redis 채널명
REDIS_CHANNEL = "mindbreeze"


def _running_under_pytest() -> bool:
    """pytest 수집·실행 중이면 True.

    테스트는 외부 Redis 에 의존하지 않아야 한다(결정적·hermetic). 운영 기동(uvicorn/celery)에는
    pytest 모듈이 로드되지 않으므로 이 가드의 영향이 없다.
    """
    return "pytest" in sys.modules or "PYTEST_CURRENT_TEST" in os.environ


def _redis_reachable(url: str, timeout: float = 0.5) -> bool:
    """Redis 주소로 TCP 연결이 가능한지 짧은 타임아웃으로 확인한다.

    테스트(Redis 미기동) 환경에서 import 단계에 manager 를 부착하지 않도록 하기 위함이다.
    실제 Redis 프로토콜 핸드셰이크까지는 하지 않고, 포트 개방 여부만 빠르게 확인한다.
    """
    try:
        parsed = urlparse(url)
        host = parsed.hostname or "localhost"
        port = parsed.port or 6379
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except Exception:
        return False


def _build_client_manager():
    """Redis manager 부착 여부를 결정한다.

    - redis_url 미설정: 로그만 남기고 반환 None(인메모리 manager 로 단일 프로세스 동작).
    - pytest 실행 중: 로그만 남기고 반환 None → 테스트가 외부 Redis 에 의존하지 않는다.
    - 연결 불가(Redis 미기동): 로그만 남기고 반환 None → emit 이 예외 없이 로깅만 된다.
    - 연결 가능(운영): AsyncRedisManager 를 부착해 Celery 워커의 emit 이 웹 소켓으로 전달된다.
    """
    url = (settings.redis_url or "").strip()
    if not url:
        logger.warning(
            "[WS] redis_url 미설정 — Redis manager 없이 인메모리로 동작(다중 프로세스 broadcast 불가)"
        )
        return None
    if _running_under_pytest():
        logger.info("[WS] pytest 환경 — Redis manager 없이 인메모리로 동작(테스트 격리)")
        return None
    if not _redis_reachable(url):
        logger.warning(
            "[WS] Redis 연결 불가 — Redis manager 없이 인메모리로 동작(다중 프로세스 broadcast 비활성)"
        )
        return None
    try:
        manager = socketio.AsyncRedisManager(url, channel=REDIS_CHANNEL)
        logger.info("[WS] AsyncRedisManager 부착 완료 (channel=%s)", REDIS_CHANNEL)
        return manager
    except Exception as exc:  # pragma: no cover - 방어적 폴백
        logger.warning("[WS] Redis manager 초기화 실패 — 인메모리로 동작: %s", exc)
        return None


sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins="*",
    ping_interval=20,
    ping_timeout=40,
    client_manager=_build_client_manager(),
)

from app.ws import chat_namespace  # noqa: F401,E402
from app.ws.record_namespace import register_record_namespace  # noqa: E402
from app.ws.session_live_namespace import register_session_live_namespace  # noqa: E402

# circular import 방지: import 대신 함수 호출로 등록
register_record_namespace(sio)
register_session_live_namespace(sio)

asgi_app = socketio.ASGIApp(sio, socketio_path="socket.io")
