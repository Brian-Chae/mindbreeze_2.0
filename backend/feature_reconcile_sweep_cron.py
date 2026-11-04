"""cron/systemd timer 에서 호출하는 종료 회차 feature 정산 스윕 스크립트 (SDD-285 S1).

10분마다 실행: 종료 후 N분~48시간 지난 회차에 정산 태스크를 발행한다. 정산은 멱등이다.
기본은 쓰기 없는 모드(로그만). 환경변수 FEATURE_RECONCILE_APPLY=true 일 때만 누락 시퀀스를 적재한다.
실행 예: cd backend && venv/bin/python feature_reconcile_sweep_cron.py
"""
from app.tasks.feature_reconcile_task import sweep_ended_sessions_for_reconcile


def main() -> int:
    try:
        result = sweep_ended_sessions_for_reconcile()
        print(f"[feature_reconcile_sweep] {result}")
        return 0
    except Exception as exc:  # noqa: BLE001
        print(f"[feature_reconcile_sweep] failed: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
