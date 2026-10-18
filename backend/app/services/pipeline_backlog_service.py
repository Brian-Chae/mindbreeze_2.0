"""SDD-212 — 종료 파이프라인 줄(큐) 적체 조회. 읽기 전용(DB·Redis 를 변경하지 않는다).

줄 이름 = Redis 리스트 키(Celery Redis 브로커 규약). 줄 분리 여부에 따라 소비 대상 줄이 달라진다.
"""
import logging
from typing import Optional

import redis

from app.config import settings

logger = logging.getLogger(__name__)

SPLIT_QUEUES = ("stt", "report")
SINGLE_QUEUES = ("celery",)


def pipeline_queue_names() -> tuple[str, ...]:
    """종료 파이프라인 작업이 쌓이는 줄. 줄 분리가 꺼져 있으면 기본 줄이 파이프라인 줄이다."""
    return SPLIT_QUEUES if settings.pipeline_queue_split_enabled else SINGLE_QUEUES


def get_redis_client() -> "redis.Redis":
    return redis.Redis.from_url(settings.redis_url, socket_connect_timeout=1, socket_timeout=2)


def queue_lengths(redis_client, names: Optional[tuple[str, ...]] = None) -> dict[str, int]:
    return {name: int(redis_client.llen(name)) for name in (names or pipeline_queue_names())}


def is_backlogged(redis_client=None) -> bool:
    """파이프라인 줄에 대기 중인 작업이 하나라도 있으면 적체로 본다.

    브로커 조회가 실패하면 적체가 아닌 것으로 취급한다 — 조회 실패가 재드라이브를 막아
    유실 복구를 영구 지연시키지 않게 한다(브로커가 죽었다면 재발행도 어차피 실패해 재시도된다).
    """
    try:
        client = redis_client if redis_client is not None else get_redis_client()
        return any(length > 0 for length in queue_lengths(client).values())
    except Exception as exc:  # noqa: BLE001
        logger.warning("[pipeline-backlog] 줄 길이 조회 실패 — 적체 아님으로 처리: %s", exc)
        return False
