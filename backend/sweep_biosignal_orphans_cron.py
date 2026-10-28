"""cron/systemd timer 에서 호출하는 생체 신호 고아 산출물·미종료 stream 정리 스크립트.

15분마다 실행: 회차 종료 후 24시간 넘게 pending 인 산출물을 abandoned 로 종결해 manifest 를 닫고,
close deadline 이 지난 ended stream 에 종료 시각을 기록한다.
실행 예: cd backend && venv/bin/python sweep_biosignal_orphans_cron.py
"""
from app.core.database import SessionLocal
from app.services import biosignal_orphan_sweep


def main() -> int:
    try:
        with SessionLocal() as db:
            result = biosignal_orphan_sweep.run_sweep(db)
        print(f"[sweep_biosignal_orphans] {result}")
        return 0
    except Exception as exc:  # noqa: BLE001
        print(f"[sweep_biosignal_orphans] failed: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
