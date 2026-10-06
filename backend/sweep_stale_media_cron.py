"""cron에서 직접 호출하는 audio/video 청크 보관·고아 정리 스윕 스크립트 (celery beat 대체).

매일 실행: 보관 기간 경과 audio/video 청크와 고아 청크를 행·실제 미디어와 함께 정리한다.
실행 예: cd backend && venv/bin/python sweep_stale_media_cron.py
"""
from app.tasks.media_cleanup_task import sweep_stale_media_task


def main() -> int:
    try:
        result = sweep_stale_media_task()
        print(f"[sweep_stale_media] {result}")
        return 0
    except Exception as exc:  # noqa: BLE001
        print(f"[sweep_stale_media] failed: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
