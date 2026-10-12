"""cron에서 직접 호출하는 AI 비서 예약 사전 노티 스윕 스크립트 (celery beat 대체).

매 1분 실행: 예약 3시간 전·1시간 전 AI 메시지를 생성하고, 일정이 변경된 건에는
정정 안내를 보낸다. 중복은 agent_delivery_logs UNIQUE 로 차단된다.
실행 예: cd backend && venv/bin/python sweep_agent_reminders_cron.py
"""
from app.tasks.agent_task import sweep_agent_reminders


def main() -> int:
    try:
        result = sweep_agent_reminders()
        print(f"[sweep_agent_reminders] {result}")
        return 0
    except Exception as exc:  # noqa: BLE001
        print(f"[sweep_agent_reminders] failed: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
