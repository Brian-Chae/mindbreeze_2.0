"""cron/systemd timer 에서 호출하는 종료 파이프라인 적체 감시 스크립트 (SDD-212).

매 1분 실행: 줄별 대기 건수·최장 대기 시간 등을 구조화 로그(JSON 한 줄)로 출력하고,
설정으로 허용된 경우에만 CloudWatch 사용자 지정 지표(MindBreeze/Pipeline)로 게시한다.
실행 예: cd backend && venv/bin/python report_backlog_probe_cron.py
"""
import json
from typing import Optional

from app.config import settings
from app.services import pipeline_backlog_service as backlog
from app.services import pipeline_metrics_publisher as publisher

# 타이머 시간 상한(55초) 안에서 끝나도록 일꾼 응답 대기를 짧게 한다.
INSPECT_TIMEOUT_SECONDS = 2


def collect_consumers() -> Optional[dict[str, int]]:
    """줄별 소비 일꾼 수. 브로커 조회 자체가 실패하면 None(소비자 경보 판정 생략)."""
    try:
        from app.core.celery_app import celery_app

        replies = celery_app.control.inspect(timeout=INSPECT_TIMEOUT_SECONDS).active_queues()
        return backlog.count_consumers(replies)
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"event": "pipeline_backlog_consumers_unavailable", "error": str(exc)[:200]}))
        return None


def main() -> int:
    from app.core.database import SessionLocal

    db = SessionLocal()
    try:
        try:
            redis_client = backlog.get_redis_client()
        except Exception:  # noqa: BLE001
            redis_client = None
        snap = backlog.snapshot(db, redis_client, consumers=collect_consumers())
        snap["alerts"] = backlog.evaluate_alerts(snap)
        print(json.dumps({"event": "pipeline_backlog", **snap}, ensure_ascii=False))
        if settings.pipeline_metrics_cloudwatch_enabled:
            publisher.publish(snap)
        return 0
    except Exception as exc:  # noqa: BLE001
        print(f"[report_backlog_probe] failed: {exc}")
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
