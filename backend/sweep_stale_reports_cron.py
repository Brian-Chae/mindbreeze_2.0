"""cron에서 직접 호출하는 리포트 생성 타임아웃 워치독 스크립트 (celery beat 대체).

매 5분 실행: processing 먹통(타임아웃) 리포트를 마감 처리한다.
실행 예: cd backend && venv/bin/python sweep_stale_reports_cron.py
"""
from app.tasks.report_task import sweep_stale_reports_task


def main() -> int:
    try:
        result = sweep_stale_reports_task()
        print(f"[sweep_stale_reports] {result}")
        return 0
    except Exception as exc:  # noqa: BLE001
        print(f"[sweep_stale_reports] failed: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
