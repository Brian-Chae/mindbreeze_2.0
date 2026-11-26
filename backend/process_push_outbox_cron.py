"""cron에서 직접 호출하는 앱 푸시 아웃박스 발송 스크립트 (celery beat 대체).

매 1분 실행: `channel="push"` pending 아웃박스를 조회해 사용자의 활성 디바이스 토큰으로
FCM 발송한다. FCM 자격증명(FCM_PROJECT_ID/FCM_SERVICE_ACCOUNT_JSON) 미설정 환경에서는
발송을 시도하지 않고 행을 그대로 둔다(SDD-190).
실행 예: cd backend && venv/bin/python process_push_outbox_cron.py
"""
from app.tasks.push_task import process_push_outbox


def _enqueue_measure_nudges() -> None:
    """SDD-336: 측정 미시작 회원 재진입 푸시 적재(실패해도 기존 outbox 발송을 막지 않는다)."""
    from app.core.database import SessionLocal
    from app.services.measure_cause_service import enqueue_measure_nudges

    db = SessionLocal()
    try:
        print(f"[measure_nudge] {enqueue_measure_nudges(db)}")
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        print(f"[measure_nudge] failed: {exc}")
    finally:
        db.close()


def main() -> int:
    try:
        _enqueue_measure_nudges()
        result = process_push_outbox()
        print(f"[process_push_outbox] {result}")
        return 0
    except Exception as exc:  # noqa: BLE001
        print(f"[process_push_outbox] failed: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
