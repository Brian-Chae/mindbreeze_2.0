"""저장된 심박변이(RMSSD/SDNN/LF/HF/LF-HF)를 수정된 알고리즘으로 다시 산출해 같은 행을 덮어쓴다.

기본은 --dry-run(DB 변경 0). 버전별 별도 저장 없음 — `--apply` 직전 값은 로컬 JSONL 백업(롤백용 1회성)에만 남긴다.

  cd backend
  # 건식(기본): 회차·창 수, 원시 없음 수, 변경 전/후 중앙값, 바뀌는 행 수
  python scripts/recompute_ppg_hrv.py --session-id <UUID> [--since 2026-10-01] [--limit 20]
  # 적용(회차 단위 트랜잭션 + 백업). 운영(ENVIRONMENT=production)은 --confirm-production 필요
  python scripts/recompute_ppg_hrv.py --apply [--confirm-production] --backup-dir /var/lib/mindbreeze/hrv-backup
  # 되돌리기
  python scripts/recompute_ppg_hrv.py --rollback /var/lib/mindbreeze/hrv-backup/hrv_recompute_backup_<ts>.jsonl [--confirm-production]

엔진: packages/measurement-core 의 example `recompute_ppg_hrv` (HRV_RECOMPUTE_BIN 으로 경로 지정 가능).
  cd packages/measurement-core && cargo build --release --example recompute_ppg_hrv
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--session-id", action="append", help="대상 회차(반복 가능)")
    ap.add_argument("--since", help="이 날짜(YYYY-MM-DD) 이후 생성된 회차만")
    ap.add_argument("--limit", type=int, help="처리할 회차 수 상한")
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--dry-run", action="store_true", help="(기본) 변경 없이 요약만")
    g.add_argument("--apply", action="store_true", help="DB 에 덮어쓰기")
    g.add_argument("--rollback", metavar="BACKUP", help="백업 JSONL 로 원래 값 복원")
    ap.add_argument("--backup-dir", default="./hrv_recompute_backup", help="--apply 백업 폴더(기본 ./hrv_recompute_backup)")
    ap.add_argument("--confirm-production", action="store_true", help="ENVIRONMENT=production 에서 쓰기 허용")
    ap.add_argument("--tolerance-ms", type=float, default=None, help="윈도우↔재산출 틱 시각 허용 오차(기본 750)")
    args = ap.parse_args(argv)

    from app.config import settings
    from app.core.database import SessionLocal
    from app.services import hrv_recompute_service as svc

    writes = bool(args.apply or args.rollback)
    if writes and settings.environment == "production" and not args.confirm_production:
        print("거부: ENVIRONMENT=production 에서는 --confirm-production 이 필요합니다.", file=sys.stderr)
        return 2

    progress = lambda m: print(m, flush=True)  # noqa: E731
    db = SessionLocal()
    try:
        if args.rollback:
            print(json.dumps(svc.rollback(db, Path(args.rollback), progress), ensure_ascii=False))
            return 0
        since = datetime.fromisoformat(args.since).replace(tzinfo=timezone.utc) if args.since else None
        ids = svc.select_sessions(db, session_ids=args.session_id, since=since, limit=args.limit)
        from app.services import storage_service
        backup = svc.new_backup_path(Path(args.backup_dir)) if args.apply else None
        stats = svc.run(db, session_ids=ids, reader=storage_service.download_bytes, engine=svc.run_rust_engine,
                        apply=bool(args.apply), backup_path=backup,
                        tolerance_ms=args.tolerance_ms or svc.DEFAULT_TOLERANCE_MS, progress=progress)
        out = {"mode": "apply" if args.apply else "dry-run", **stats.report()}
        out["sessions_without_raw_untouched"] = svc.count_sessions_without_raw(db)
        if backup is not None:
            out["backup"] = str(backup)
        print(json.dumps(out, ensure_ascii=False, indent=2))
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
