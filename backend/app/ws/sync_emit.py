"""동기 컨텍스트(Celery·FastAPI 스레드풀)용 Socket.IO 외부 프로세스 emit.

기존에는 동기 코드가 호출마다 `asyncio.run(sio.emit(...))` 로 새 이벤트 루프를 만들었는데,
`sio` 의 AsyncRedisManager 가 첫 루프에 묶인 Redis 연결을 재사용해
`RuntimeError: ... attached to a different loop` 가 반복됐다.
python-socketio 의 외부 프로세스 emit(동기 `RedisManager(write_only=True)`)은
루프와 무관하게 Redis 로 publish 하고, 웹 프로세스의 AsyncRedisManager 가 구독해 클라이언트에 전달한다.

Redis 미사용 환경(redis_url 미설정·pytest·연결 불가)에서는 아무것도 하지 않고 False 를 반환한다.
"""

import logging
import threading
from datetime import datetime

import socketio

from app.config import settings
from app.ws import REDIS_CHANNEL, _redis_reachable, _running_under_pytest

logger = logging.getLogger(__name__)

NAMESPACE = "/record"

_manager = None
_manager_lock = threading.Lock()


def _get_manager():
    """write_only RedisManager 를 모듈 수준에서 지연 생성·재사용한다. 불가하면 None."""
    global _manager
    if _manager is not None:
        return _manager
    url = (settings.redis_url or "").strip()
    if not url or _running_under_pytest() or not _redis_reachable(url):
        return None
    with _manager_lock:
        if _manager is None:
            _manager = socketio.RedisManager(url, channel=REDIS_CHANNEL, write_only=True)
    return _manager


def _emit(event: str, body: dict, room: str) -> bool:
    manager = _get_manager()
    if manager is None:
        logger.debug("[ws.sync_emit] Redis manager 없음 — %s emit 생략 (%s)", event, room)
        return False
    try:
        manager.emit(event, body, namespace=NAMESPACE, room=room)
    except Exception:  # noqa: BLE001 — WS 실패가 파이프라인을 막지 않는다.
        logger.warning("[ws.sync_emit] %s emit 실패 (%s)", event, room, exc_info=True)
        return False
    return True


def emit_report_progress_sync(session_id: str, payload: dict) -> bool:
    body = dict(payload)
    body["session_id"] = session_id
    updated_at = body.get("updated_at")
    if isinstance(updated_at, datetime):
        body["updated_at"] = updated_at.isoformat()
    return _emit("report:progress", body, f"session:{session_id}")


def emit_record_status_sync(session_id: str, status: str, detail: dict | None = None) -> bool:
    body: dict = {"session_id": session_id, "status": status}
    if detail:
        body["detail"] = detail
    return _emit("record_status", body, f"session:{session_id}")
