"""채팅방 열람(presence) 저장소 — '지금 그 방을 보고 있는 사용자'에게는 새 메시지 푸시를 보내지 않는다.

- 클라이언트가 방 화면 진입/이탈·앱 백그라운드·탭 숨김 때 `room_viewing` 소켓 이벤트를 보낸다.
- Redis sorted set `chat:viewing:{room}:{user}` — member=소켓 sid, score=만료 시각(epoch 초).
  멀티탭/멀티기기를 sid 단위로 구분해, 한쪽만 닫아도 다른 쪽이 보고 있으면 계속 '보고 있음'이다.
- 하트비트가 끊기면(앱 강제종료·네트워크 단절) TTL 로 자동 만료 → 다시 푸시 대상이 된다.
- 조회/저장 실패는 fail-open(= 보고 있지 않음으로 간주해 푸시 발송). 푸시 누락보다 중복이 낫다.
"""

from __future__ import annotations

import logging
import time

logger = logging.getLogger(__name__)

# 클라이언트 하트비트(20초)의 2배 이상 — 한 번 누락돼도 유지, 끊기면 45초 안에 만료.
VIEWING_TTL_SECONDS = 45


def get_client():
    import redis

    from app.config import settings

    return redis.Redis.from_url(
        settings.redis_url, decode_responses=True, socket_connect_timeout=1, socket_timeout=2
    )


def _key(room_id: str, user_id: str) -> str:
    return f"chat:viewing:{room_id}:{user_id}"


def set_viewing(room_id: str, user_id: str, sid: str, viewing: bool, now: float | None = None) -> None:
    """sid 의 열람 상태를 갱신한다(true=하트비트 포함 TTL 연장, false=즉시 제거)."""
    ts = time.time() if now is None else now
    try:
        client = get_client()
        key = _key(room_id, user_id)
        if viewing:
            client.zadd(key, {sid: ts + VIEWING_TTL_SECONDS})
            client.expire(key, VIEWING_TTL_SECONDS * 2)
        else:
            client.zrem(key, sid)
    except Exception as exc:  # noqa: BLE001 — presence 는 best-effort
        logger.warning("[chat-presence] set 실패 room=%s user=%s: %s", room_id, user_id, exc)


def clear_sid(room_id: str, user_id: str, sid: str) -> None:
    set_viewing(room_id, user_id, sid, False)


def is_viewing(room_id: str, user_id: str, now: float | None = None) -> bool:
    """해당 사용자가 지금 그 방을 보고 있는가(만료되지 않은 sid 가 하나라도 있으면 True)."""
    ts = time.time() if now is None else now
    try:
        client = get_client()
        key = _key(room_id, user_id)
        client.zremrangebyscore(key, "-inf", ts)
        return int(client.zcard(key)) > 0
    except Exception as exc:  # noqa: BLE001 — fail-open
        logger.warning("[chat-presence] 조회 실패(푸시 발송으로 진행) room=%s user=%s: %s", room_id, user_id, exc)
        return False
