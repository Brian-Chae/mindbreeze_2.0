"""cron에서 직접 호출하는 데이터 export 만료 정리 스크립트 (celery beat 대체).

매 5분 실행: 만료된 생체 데이터 export 패키지를 정리한다.
실행 예: cd backend && venv/bin/python cleanup_data_exports_cron.py
"""
from app.tasks.export_task import cleanup_data_exports


def main() -> int:
    try:
        result = cleanup_data_exports()
        print(f"[cleanup_data_exports] {result}")
        return 0
    except Exception as exc:  # noqa: BLE001
        print(f"[cleanup_data_exports] failed: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
