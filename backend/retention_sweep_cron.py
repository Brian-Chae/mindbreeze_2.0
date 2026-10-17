"""cron에서 직접 호출하는 기본 DB 삭제 스위프 스크립트 (SDD-209 B12 / BE-R2).

기본 ``RETENTION_SWEEP_ENABLED=false`` 라 실행해도 삭제는 없고 **dry-run 보고서**(후보 건수·바이트·보류 건수)만 출력한다.
활성화(설정 변경)와 기존 두 cron(sweep_stale_media_cron.py / sweep_stale_eeg_raw_cron.py) 대체는 별도 승인 후에 한다 —
활성화되면 기존 두 cron 은 스스로 건너뛴다.

실행 예: cd backend && venv/bin/python retention_sweep_cron.py            # 설정에 따름(기본 dry-run)
         cd backend && venv/bin/python retention_sweep_cron.py --dry-run  # 활성 상태에서도 보고만
"""
import json
import sys

from app.core.database import SessionLocal
from app.services.retention_sweep_service import run_retention_sweep


def main(argv: list[str]) -> int:
    dry_run = True if "--dry-run" in argv else None
    db = SessionLocal()
    try:
        report = run_retention_sweep(db, dry_run=dry_run, trigger="cron")
        print(f"[retention_sweep] {json.dumps(report, ensure_ascii=False, default=str)}")
        return 0
    except Exception as exc:  # noqa: BLE001
        print(f"[retention_sweep] failed: {exc}")
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
