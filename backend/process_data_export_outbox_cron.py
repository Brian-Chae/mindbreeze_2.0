"""SDD-243 cron 직접 호출: 데이터 센터 일괄 반출 작업의 큐 전달 outbox 재전달 (celery beat 대체).

pending / 전달 중 lease 만료 항목을 exports 큐로 다시 올리고, worker 가 죽어 lease 가 만료된 preparing 작업을
재실행 대상으로 복구한다. 매 1분 실행 권장(등록은 배포 승인 후): cd backend && venv/bin/python process_data_export_outbox_cron.py
"""
from app.core.database import SessionLocal
from app.services import data_center_export


def main() -> int:
    try:
        with SessionLocal() as db:
            result = data_center_export.redeliver_outbox(db)
        print(f"[process_data_export_outbox] {result}")
        return 0
    except Exception as exc:  # noqa: BLE001
        print(f"[process_data_export_outbox] failed: {type(exc).__name__}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
