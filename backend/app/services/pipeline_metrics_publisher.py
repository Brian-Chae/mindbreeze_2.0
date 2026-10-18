"""SDD-212 TD6 — 적체 스냅샷을 CloudWatch 사용자 지정 지표로 변환·게시한다.

게시는 실패해도 예외를 던지지 않는다(권한 미승인·네트워크 오류 시 로그만 남기고 호출부는 정상 종료).
지표에는 건수·시간만 담고 세션·사용자 식별자는 담지 않는다.
"""
import logging
from typing import Optional

from app.config import settings

logger = logging.getLogger(__name__)

NAMESPACE = "MindBreeze/Pipeline"
_BATCH = 20


def _datum(name: str, value: float, unit: str, queue: Optional[str] = None) -> dict:
    datum = {"MetricName": name, "Value": float(value), "Unit": unit}
    if queue is not None:
        datum["Dimensions"] = [{"Name": "Queue", "Value": queue}]
    return datum


def build_metric_data(snap: dict) -> tuple[str, list[dict]]:
    data = [
        _datum("OldestWaitSeconds", snap["oldest_wait_seconds"], "Seconds"),
        _datum("WaitingChains", snap["waiting_chains"], "Count"),
        _datum("PendingPublish", snap["pending_publish"], "Count"),
        _datum("RedrivenChains", snap["redriven_chains"], "Count"),
        _datum("GeneratingReports", snap["generating_reports"], "Count"),
        _datum("ProcessingRecords", snap["processing_records"], "Count"),
        _datum("OldestProcessingRecordSeconds", snap["oldest_processing_record_seconds"], "Seconds"),
    ]
    if snap.get("unacked") is not None:
        data.append(_datum("Unacked", snap["unacked"], "Count"))
    for name, length in (snap.get("queues") or {}).items():
        data.append(_datum("QueueLength", length, "Count", queue=name))
    for name, count in (snap.get("consumers") or {}).items():
        data.append(_datum("Consumers", count, "Count", queue=name))
    return NAMESPACE, data


def client_config():
    from botocore.config import Config

    # 감시 cron 의 시간 상한(55초) 안에 끝나도록 짧게 자른다.
    return Config(connect_timeout=3, read_timeout=5, retries={"max_attempts": 1})


def _default_client():
    import boto3

    return boto3.client("cloudwatch", region_name=settings.s3_region, config=client_config())


def publish(snap: dict, client=None) -> bool:
    try:
        namespace, data = build_metric_data(snap)
        cw = client if client is not None else _default_client()
        for start in range(0, len(data), _BATCH):
            cw.put_metric_data(Namespace=namespace, MetricData=data[start:start + _BATCH])
        return True
    except Exception as exc:  # noqa: BLE001 — 게시 실패가 감시 cron 을 실패시키지 않게 한다.
        logger.warning("[pipeline-metrics] CloudWatch 게시 실패(로그만 남김): %s", exc)
        return False
