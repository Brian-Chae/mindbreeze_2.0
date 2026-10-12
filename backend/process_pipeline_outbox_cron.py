"""cron에서 직접 호출하는 파이프라인 아웃박스 재발행 스크립트 (celery beat 대체).

매 1분 실행: 발행 유실된 종료 파이프라인 아웃박스를 재발행한다.
실행 예: cd backend && venv/bin/python process_pipeline_outbox_cron.py
"""
from app.tasks.pipeline_outbox_task import process_pipeline_outbox


def main() -> int:
    try:
        result = process_pipeline_outbox()
        print(f"[process_pipeline_outbox] {result}")
        return 0
    except Exception as exc:  # noqa: BLE001
        print(f"[process_pipeline_outbox] failed: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
