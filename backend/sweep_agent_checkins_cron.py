"""cron에서 직접 호출하는 AI 비서 안부 대화(체크인) 스윕 스크립트 (celery beat 대체).

매 5분 실행: 상담사가 안부를 켠 내담자 중 트리거·제한 조건을 통과한 대상에게 안부
메시지를 1건 만든다. 하루 1회는 agent_delivery_logs UNIQUE 로 보장되므로 재실행에
멱등하다. 방해금지(22:00~08:00 KST)를 지키며, 위험 알림은 이 스윕과 무관하게
내담자 메시지 수신 즉시 발송된다.
실행 예: cd backend && venv/bin/python sweep_agent_checkins_cron.py
"""
from app.tasks.agent_task import sweep_agent_checkins


def main() -> int:
    try:
        result = sweep_agent_checkins()
        print(f"[sweep_agent_checkins] {result}")
        return 0
    except Exception as exc:  # noqa: BLE001
        print(f"[sweep_agent_checkins] failed: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
