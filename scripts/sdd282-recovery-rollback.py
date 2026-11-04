"""SDD-282 롤백 — 복구로 넣은 행과 덮어쓴 리포트를 되돌린다.

- 적재 롤백: `ingest_path='recover'` 표식 행만 삭제(대상 참여행 4개 한정). 다른 경로 행은 건드리지 않는다.
- 리포트 롤백: `sdd282-report-overwrite.py` 가 만든 백업 JSON 으로 본문·상태를 복원.
기본은 `--dry-run`(삭제·복원 예정 건수만 출력, 읽기 전용 트랜잭션). `--apply` 에만 실제 변경한다.
"""
from __future__ import annotations

import argparse
import json
import sys
import uuid
from pathlib import Path

DEFAULT_SESSION = "1a74e4c9-a54e-4454-8505-22840922811c"
REQUIRED_TARGETS = ("de8312", "6a2172", "518675", "ac1a78")


def _bootstrap_path() -> None:
    backend = Path(__file__).resolve().parents[1] / "backend"
    if str(backend) not in sys.path:
        sys.path.insert(0, str(backend))


def _load_overwrite_module():
    import importlib.util

    p = Path(__file__).with_name("sdd282-report-overwrite.py")
    spec = importlib.util.spec_from_file_location("sdd282_report_overwrite", p)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main(argv: list[str] | None = None, *, session_factory=None) -> int:
    _bootstrap_path()
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", help="기본값. 예정 건수만 출력.")
    mode.add_argument("--apply", action="store_true")
    ap.add_argument("--session", default=DEFAULT_SESSION)
    ap.add_argument("--targets", nargs="+", default=list(REQUIRED_TARGETS))
    ap.add_argument("--skip-rows", action="store_true", help="적재 행 삭제는 하지 않는다(리포트만 복원)")
    ap.add_argument("--report-backup", help="리포트 복원용 백업 JSON 경로(없으면 리포트는 건드리지 않음)")
    ap.add_argument("--expect-rows", type=int, help="--apply 때 삭제 예정 행 수가 이 값과 다르면 중단")
    args = ap.parse_args(argv)

    from sqlalchemy import text

    from app.models.record import Report
    from app.services import feature_artifact_reconcile as far

    if session_factory is None:
        from app.core.database import SessionLocal as session_factory  # noqa: N813
    session_id = uuid.UUID(args.session)
    apply = bool(args.apply)
    if apply and sorted(args.targets) != sorted(REQUIRED_TARGETS):
        print(f"[중단] --apply 는 대상 4개({', '.join(REQUIRED_TARGETS)})를 정확히 지정해야 한다.")
        return 2

    db = session_factory()
    try:
        if not apply:
            db.execute(text("SET TRANSACTION READ ONLY"))
        pids = []
        for pre in args.targets:
            rows = db.execute(text("select id from session_participants where session_id=:s and id::text like :p"),
                              {"s": session_id, "p": pre + "%"}).scalars().all()
            if len(rows) != 1:
                print(f"[중단] 참여행 {pre} 해석 결과 {len(rows)}건")
                return 2
            pids.append(rows[0])

        n_marked = 0 if args.skip_rows else far.count_rows(db, session_id, pids, far.INGEST_PATH_RECOVER)
        print(f"삭제 예정 표식(recover) 행: {n_marked}")
        saved = None
        if args.report_backup:
            saved = json.loads(Path(args.report_backup).read_text(encoding="utf-8"))
            if saved.get("session_id") != str(session_id):
                print("[중단] 백업의 회차가 다르다.")
                return 2
            print(f"복원 예정 리포트: {len(saved['reports'])}건")

        if not apply:
            db.rollback()
            print("끝 — 쓰기 없음(READ ONLY 트랜잭션 rollback)")
            return 0
        if args.expect_rows is not None and args.expect_rows != n_marked:
            print(f"[중단] 삭제 예정 {n_marked} ≠ --expect-rows {args.expect_rows}")
            db.rollback()
            return 4

        deleted = 0 if args.skip_rows else far.delete_marked(db, session_id, pids, far.INGEST_PATH_RECOVER)
        restored = 0
        if saved:
            ow = _load_overwrite_module()
            for rid, item in saved["reports"].items():
                r = db.get(Report, uuid.UUID(rid))
                if r is None or r.session_id != session_id:
                    print(f"[중단→롤백] 리포트 {rid[:6]} 를 찾을 수 없다.")
                    db.rollback()
                    return 5
                ow.restore_report(db, r, item["values"])
                restored += 1
        if deleted != n_marked:
            print(f"[중단→롤백] 삭제 {deleted} ≠ 예정 {n_marked}")
            db.rollback()
            return 5
        db.commit()
        print(f"롤백 완료: 행 {deleted}건 삭제, 리포트 {restored}건 복원")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
