"""cron에서 직접 호출하는 탈퇴 사용자 30일 영구 삭제 스위프 (SDD-220).

기본 ``ACCOUNT_DELETION_SWEEP_ENABLED=false`` 라 영구 삭제는 하지 않고 **dry-run 보고서**만 출력한다.
활성화(설정 변경)와 prod 삭제 실행은 별도 승인 후에 한다. 기존 90일 보관 스위프(retention_sweep_cron.py)와는 별개다.
소셜 연결 해제(Apple revoke/Google 해제) 재시도와 공개 삭제 요청 알림 메일 재발송은 비파괴 작업이라 항상 처리한다
(``--dry-run`` 이면 이것도 하지 않는다).

실행 예: cd backend && venv/bin/python account_deletion_sweep_cron.py            # 설정에 따름(기본 dry-run)
         cd backend && venv/bin/python account_deletion_sweep_cron.py --dry-run  # 활성 상태에서도 보고만
"""
import json
import sys

from app.config import settings
from app.core.database import SessionLocal
from app.tasks.account_deletion_task import run_account_deletion_cycle


def main(argv: list[str]) -> int:
    dry_run = "--dry-run" in argv
    execute = bool(settings.account_deletion_sweep_enabled) and not dry_run
    db = SessionLocal()
    try:
        report = run_account_deletion_cycle(db, execute=execute, process_outbox=not dry_run)
        print(f"[account_deletion_sweep] {json.dumps(report, ensure_ascii=False, default=str)}")
        return 0
    except Exception as exc:  # noqa: BLE001
        print(f"[account_deletion_sweep] failed: {exc}")
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
