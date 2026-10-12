"""cron에서 직접 호출하는 EEG raw 청크 정리 스윕 스크립트 (celery beat 대체).

매일 실행: 스테일 pending/failed 고아 청크와 보관 기간 경과 업로드분을 정리한다.
실행 예: cd backend && venv/bin/python sweep_stale_eeg_raw_cron.py
"""
from app.tasks.eeg_raw_task import sweep_stale_eeg_raw_task


def main() -> int:
    try:
        result = sweep_stale_eeg_raw_task()
        print(f"[sweep_stale_eeg_raw] {result}")
        return 0
    except Exception as exc:  # noqa: BLE001
        print(f"[sweep_stale_eeg_raw] failed: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
