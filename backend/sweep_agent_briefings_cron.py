"""cron에서 직접 호출하는 AI 비서 상담사 브리핑 스윕 스크립트 (celery beat 대체).

매 1분 실행: 상담사가 지정한 시각(KST)이 도래하면 아침 일정 브리핑 / 저녁 상담 정리를
생성한다. 지정 시각 이후 30분까지 보정 발송하며, 중복은 agent_briefing_logs UNIQUE 로
차단된다. 실행 예: cd backend && venv/bin/python sweep_agent_briefings_cron.py
"""
from app.tasks.agent_task import sweep_agent_briefings


def main() -> int:
    try:
        result = sweep_agent_briefings()
        print(f"[sweep_agent_briefings] {result}")
        return 0
    except Exception as exc:  # noqa: BLE001
        print(f"[sweep_agent_briefings] failed: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
