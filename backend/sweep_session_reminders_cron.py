"""cron에서 직접 호출하는 예약 클래스 리마인더 스윕 스크립트 (celery beat 대체).

매 5분 실행: ETA 유실/워커 중단으로 누락된 리마인더를 보정 발송한다.
실행 예: cd backend && venv/bin/python sweep_session_reminders_cron.py
"""
from app.tasks.reminder_task import sweep_session_reminders


def main() -> int:
    try:
        result = sweep_session_reminders()
        print(f"[sweep_session_reminders] {result}")
        return 0
    except Exception as exc:  # noqa: BLE001
        print(f"[sweep_session_reminders] failed: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
