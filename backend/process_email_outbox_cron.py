"""cron에서 직접 호출하는 이메일 아웃박스 발송 스크립트 (celery beat 대체).

매 1분 실행: pending 이메일 아웃박스를 조회해 발송한다.
알림 생성 시 commit=False 로 커밋된 경로(호출자가 커밋 소유)는 즉시 큐 적재가
되지 않으므로 이 스윕이 실제 발송을 담당한다(NOTIF-03/OUTBOX-001).
실행 예: cd backend && venv/bin/python process_email_outbox_cron.py
"""
from app.tasks.outbox import process_email_outbox


def main() -> int:
    try:
        result = process_email_outbox()
        print(f"[process_email_outbox] {result}")
        return 0
    except Exception as exc:  # noqa: BLE001
        print(f"[process_email_outbox] failed: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
