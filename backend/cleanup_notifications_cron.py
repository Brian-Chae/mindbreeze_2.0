"""cron에서 직접 호출하는 알림 보관·파기 정책 스크립트 (celery beat 대체).

매일 1회 실행: 읽은 알림 30일·전체 90일·outbox(sent/failed) 30일 삭제.
실행 예: cd backend && venv/bin/python cleanup_notifications_cron.py
"""
from app.tasks.outbox import cleanup_notifications


def main() -> int:
    try:
        result = cleanup_notifications()
        print(f"[cleanup_notifications] {result}")
        return 0
    except Exception as exc:  # noqa: BLE001
        print(f"[cleanup_notifications] failed: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
