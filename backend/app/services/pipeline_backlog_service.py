"""SDD-212 — 종료 파이프라인 줄(큐) 적체 조회. 읽기 전용(DB·Redis 를 변경하지 않는다).

줄 이름 = Redis 리스트 키(Celery Redis 브로커 규약). 줄 분리 여부에 따라 소비 대상 줄이 달라진다.
"""
import logging
from datetime import datetime, timezone
from typing import Optional

import redis
from sqlalchemy import exists, func
from sqlalchemy.orm import Session as DBSession

from app.config import settings
from app.models.pipeline_outbox import PipelineOutbox
from app.models.record import Report, SessionRecord
from app.services import report_progress_service

logger = logging.getLogger(__name__)

SPLIT_QUEUES = ("stt", "report")
SINGLE_QUEUES = ("celery",)
ALL_QUEUES = SPLIT_QUEUES + SINGLE_QUEUES


def pipeline_queue_names() -> tuple[str, ...]:
    """종료 파이프라인 작업이 쌓이는 줄. 줄 분리가 꺼져 있으면 기본 줄이 파이프라인 줄이다."""
    return SPLIT_QUEUES if settings.pipeline_queue_split_enabled else SINGLE_QUEUES


def get_redis_client() -> "redis.Redis":
    return redis.Redis.from_url(settings.redis_url, socket_connect_timeout=1, socket_timeout=2)


def queue_lengths(redis_client, names: Optional[tuple[str, ...]] = None) -> dict[str, int]:
    return {name: int(redis_client.llen(name)) for name in (names or ALL_QUEUES)}


def is_backlogged(redis_client=None) -> bool:
    """파이프라인 줄에 대기 중인 작업이 하나라도 있으면 적체로 본다.

    브로커 조회가 실패하면 적체가 아닌 것으로 취급한다 — 조회 실패가 재드라이브를 막아
    유실 복구를 영구 지연시키지 않게 한다(브로커가 죽었다면 재발행도 어차피 실패해 재시도된다).
    """
    try:
        client = redis_client if redis_client is not None else get_redis_client()
        return any(length > 0 for length in queue_lengths(client, pipeline_queue_names()).values())
    except Exception as exc:  # noqa: BLE001
        logger.warning("[pipeline-backlog] 줄 길이 조회 실패 — 적체 아님으로 처리: %s", exc)
        return False


def _as_utc(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def _elapsed(now: datetime, since: Optional[datetime]) -> int:
    return 0 if since is None else max(0, int((now - _as_utc(since)).total_seconds()))


def snapshot(
    db: DBSession,
    redis_client,
    *,
    now: Optional[datetime] = None,
    consumers: Optional[dict[str, int]] = None,
) -> dict:
    """적체 지표 스냅샷. 건수·시간만 담고 세션·사용자 식별자는 담지 않는다. DB·Redis 를 변경하지 않는다.

    - queues/unacked: 브로커(Redis) 줄 길이·처리 중 미확인 건수. 조회 실패 시 None + broker_available=False
    - oldest_wait_seconds: 발행됐지만 리포트 행이 아직 없는 사슬 중 가장 오래 기다린 건의 경과(세션 종료 기준)
    - consumers: 줄별 소비 중인 일꾼 수(호출부가 celery inspect 로 얻어 넘긴다, 없으면 None)
    """
    now = now or datetime.now(timezone.utc)

    queues: Optional[dict[str, int]] = None
    unacked: Optional[int] = None
    try:
        queues = queue_lengths(redis_client)
        unacked = int(redis_client.hlen("unacked"))
    except Exception as exc:  # noqa: BLE001 — 브로커 장애가 지표 조회 전체를 막지 않게 한다.
        logger.warning("[pipeline-backlog] 브로커 지표 조회 실패: %s", exc)
        queues, unacked = None, None

    no_report = ~exists().where(Report.session_id == PipelineOutbox.session_id)
    waiting_count, oldest_created = (
        db.query(func.count(PipelineOutbox.id), func.min(PipelineOutbox.created_at))
        .filter(PipelineOutbox.status == "published", PipelineOutbox.needs_report.is_(True), no_report)
        .one()
    )
    redriven_chains, max_attempts = (
        db.query(func.count(PipelineOutbox.id), func.max(PipelineOutbox.attempts))
        .filter(PipelineOutbox.status == "published", PipelineOutbox.attempts > 0)
        .one()
    )
    pending_publish = (
        db.query(func.count(PipelineOutbox.id)).filter(PipelineOutbox.status == "pending").scalar() or 0
    )
    generating = (
        db.query(func.count(Report.id))
        .filter(
            Report.generation_status.in_(
                (report_progress_service.GENERATION_PENDING, report_progress_service.GENERATION_PROCESSING)
            )
        )
        .scalar()
        or 0
    )
    processing_records, oldest_ended = (
        db.query(func.count(SessionRecord.id), func.min(SessionRecord.recording_ended_at))
        .filter(SessionRecord.status == "processing")
        .one()
    )

    return {
        "generated_at": now.isoformat(),
        "queue_split_enabled": settings.pipeline_queue_split_enabled,
        "broker_available": queues is not None,
        "queues": queues,
        "unacked": unacked,
        "consumers": consumers,
        "waiting_chains": int(waiting_count or 0),
        "oldest_wait_seconds": _elapsed(now, oldest_created),
        "pending_publish": int(pending_publish),
        "redriven_chains": int(redriven_chains or 0),
        "max_redrive_attempts": int(max_attempts or 0),
        "generating_reports": int(generating),
        "processing_records": int(processing_records or 0),
        "oldest_processing_record_seconds": _elapsed(now, oldest_ended),
    }


def evaluate_alerts(snap: dict) -> list[str]:
    """스냅샷이 경보 임계를 넘는 항목 코드 목록. 비어 있으면 정상."""
    alerts: list[str] = []
    if snap.get("oldest_wait_seconds", 0) > settings.pipeline_alert_max_wait_seconds:
        alerts.append("oldest_wait_exceeded")
    for name, length in (snap.get("queues") or {}).items():
        if length > settings.pipeline_alert_queue_len:
            alerts.append(f"queue_length_exceeded:{name}")
    consumers = snap.get("consumers")
    if consumers is not None:
        watched = SPLIT_QUEUES if snap.get("queue_split_enabled") else SINGLE_QUEUES
        for name in watched:
            if consumers.get(name, 0) == 0:
                alerts.append(f"no_consumer:{name}")
    return alerts


def count_consumers(active_queues: Optional[dict]) -> dict[str, int]:
    """celery inspect active_queues 응답 → 줄별 소비 중인 일꾼 수. 응답이 없으면 모든 줄 0."""
    counts = {name: 0 for name in ALL_QUEUES}
    for queues in (active_queues or {}).values():
        for queue in queues or []:
            name = queue.get("name")
            if name in counts:
                counts[name] += 1
    return counts
