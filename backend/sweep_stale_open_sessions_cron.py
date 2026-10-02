"""cron에서 직접 호출하는 open 상태 방치 세션 자동 취소 스크립트 (celery beat 대체).

매 5분 실행: open + 24h 방치 세션을 cancelled 처리.
실행 예: cd backend && venv/bin/python sweep_stale_open_sessions_cron.py
"""
from app.tasks.session_task import sweep_stale_open_sessions_task


def main() -> int:
    try:
        result = sweep_stale_open_sessions_task()
        print(f"[sweep_stale_open_sessions] {result}")
        return 0
    except Exception as exc:  # noqa: BLE001
        print(f"[sweep_stale_open_sessions] failed: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
