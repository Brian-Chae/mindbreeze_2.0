"""cron에서 직접 호출하는 앱 푸시 아웃박스 발송 스크립트 (celery beat 대체).

매 1분 실행: `channel="push"` pending 아웃박스를 조회해 사용자의 활성 디바이스 토큰으로
FCM 발송한다. FCM 자격증명(FCM_PROJECT_ID/FCM_SERVICE_ACCOUNT_JSON) 미설정 환경에서는
발송을 시도하지 않고 행을 그대로 둔다(SDD-190).
실행 예: cd backend && venv/bin/python process_push_outbox_cron.py
"""
from app.tasks.push_task import process_push_outbox


def main() -> int:
    try:
        result = process_push_outbox()
        print(f"[process_push_outbox] {result}")
        return 0
    except Exception as exc:  # noqa: BLE001
        print(f"[process_push_outbox] failed: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
