"""SDD-282 복구 로더 — feature 산출물(S3) → eeg_feature_windows 재적재 (ingest_path='recover').

기본은 `--dry-run`(쓰기 없음): 읽기 전용 트랜잭션(`SET TRANSACTION READ ONLY`)으로 열어 DB 가 쓰기를 거부하게 한다.
`--apply` 는 아래를 모두 만족할 때만 한 트랜잭션으로 적재한다.
  1) 대상 참여행 4개(de8312, 6a2172, 518675, ac1a78)를 `--targets` 로 정확히 지정
  2) `--dryrun-result` 로 직전 드라이런 결과 JSON 을 주고, 지금 계산한 삽입 예정 행 수(총합·참가자별)가 일치
  3) 충돌(해시 불일치)·변환 실패 0건
적재 뒤 `--expect` 와 실제 삽입 수가 다르면 롤백한다. 재실행은 멱등(이미 있는 키는 건너뜀).

실행(서버): cd /opt/mindbreeze/current/backend && set -a && . /etc/mindbreeze/prod.env && set +a
           /opt/mindbreeze/venv/bin/python ../scripts/sdd282-recovery-load.py --dry-run --out /secure/dryrun.json
출력은 건수·접두사(6자)만. 개인정보·비밀값은 출력하지 않는다.
"""
from __future__ import annotations

import argparse
import json
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_SESSION = "1a74e4c9-a54e-4454-8505-22840922811c"
REQUIRED_TARGETS = ("de8312", "6a2172", "518675", "ac1a78")
DEFAULT_INCLUDE_PENDING = ("518675",)  # 대표 결정: 518675 업로드 대기 60행 포함(검증 통과 시에만)


def _bootstrap_path() -> None:
    backend = Path(__file__).resolve().parents[1] / "backend"
    if str(backend) not in sys.path:
        sys.path.insert(0, str(backend))


def resolve_targets(db, session_id: uuid.UUID, prefixes: list[str]) -> dict[str, uuid.UUID]:
    """참여행 ID 앞 6자리 → 전체 ID(DB 해석). 0건·2건 이상이면 중단."""
    from sqlalchemy import text

    out: dict[str, uuid.UUID] = {}
    for pre in prefixes:
        rows = db.execute(text("select id from session_participants where session_id=:s and id::text like :p"),
                          {"s": session_id, "p": pre + "%"}).scalars().all()
        if len(rows) != 1:
            raise SystemExit(f"[중단] 참여행 {pre} 해석 결과 {len(rows)}건 (정확히 1건이어야 함)")
        out[pre] = rows[0]
    return out


def build_plans(db, session_id: uuid.UUID, targets: dict[str, uuid.UUID], include_pending: set[str], downloader=None):
    from app.services import feature_artifact_reconcile as far

    plans = {}
    for pre, pid in targets.items():
        plans[pre] = far.plan_participant(db, session_id, pid, include_pending=pre in include_pending, downloader=downloader)
    return plans


def result_doc(session_id: uuid.UUID, plans) -> dict:
    return {
        "session": str(session_id)[:6],
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "total_insert": sum(p.insert_count for p in plans.values()),
        "participants": {pre: p.summary() for pre, p in plans.items()},
    }


def main(argv: list[str] | None = None, *, session_factory=None, downloader=None) -> int:
    _bootstrap_path()
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", help="기본값. 쓰기 없음(읽기 전용 트랜잭션).")
    mode.add_argument("--apply", action="store_true", help="적재 실행(조건 전부 충족 시에만).")
    ap.add_argument("--session", default=DEFAULT_SESSION)
    ap.add_argument("--targets", nargs="+", default=list(REQUIRED_TARGETS), help="참여행 ID 앞 6자리")
    ap.add_argument("--include-pending", nargs="*", default=list(DEFAULT_INCLUDE_PENDING),
                    help="업로드 대기 산출물을 (체크섬·크기·행 수·순번 검증 통과 시) 포함할 참여행 접두사")
    ap.add_argument("--out", help="드라이런 결과 JSON 저장 경로(개인정보 없음)")
    ap.add_argument("--dryrun-result", help="--apply 때 필수: 직전 드라이런 결과 JSON")
    args = ap.parse_args(argv)

    from sqlalchemy import text

    if session_factory is None:
        from app.core.database import SessionLocal as session_factory  # noqa: N813
    session_id = uuid.UUID(args.session)
    apply = bool(args.apply)

    if apply:
        if sorted(args.targets) != sorted(REQUIRED_TARGETS):
            print(f"[중단] --apply 는 대상 4개({', '.join(REQUIRED_TARGETS)})를 정확히 지정해야 한다.")
            return 2
        if not args.dryrun_result:
            print("[중단] --apply 에는 --dryrun-result(직전 드라이런 JSON)가 필요하다.")
            return 2
        expected = json.loads(Path(args.dryrun_result).read_text(encoding="utf-8"))

    db = session_factory()
    try:
        if not apply:
            # 쓰기 거부를 DB 에 강제한다 — 이 트랜잭션에서 INSERT/UPDATE/DELETE 는 오류가 난다.
            db.execute(text("SET TRANSACTION READ ONLY"))
        targets = resolve_targets(db, session_id, args.targets)
        plans = build_plans(db, session_id, targets, set(args.include_pending), downloader)
        doc = result_doc(session_id, plans)
        print(json.dumps(doc, ensure_ascii=False, indent=2))
        bad = {pre: p for pre, p in plans.items() if p.skipped_reason or p.conflicts or p.convert_fail}
        if bad:
            print("[경고] 제외·충돌·변환실패:", {pre: (p.skipped_reason, len(p.conflicts), p.convert_fail) for pre, p in bad.items()})

        if not apply:
            if args.out:
                Path(args.out).write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
                print(f"드라이런 결과 저장: {args.out}")
            db.rollback()
            print("끝 — 쓰기 없음(READ ONLY 트랜잭션 rollback)")
            return 1 if bad else 0

        # ---- 적재 ----
        if bad:
            print("[중단] 충돌·변환 실패·제외가 있어 적재하지 않는다.")
            db.rollback()
            return 3
        exp_by = {pre: int(v["to_insert"]) for pre, v in expected["participants"].items()}
        cur_by = {pre: p.insert_count for pre, p in plans.items()}
        if int(expected["total_insert"]) != doc["total_insert"] or exp_by != cur_by:
            print(f"[중단] 직전 드라이런({expected['total_insert']}행 {exp_by})과 지금({doc['total_insert']}행 {cur_by})이 다르다. "
                  "드라이런을 다시 실행해 숫자를 확인한 뒤 새 결과 파일로 적용하라(기기가 계속 업로드 중일 수 있음).")
            db.rollback()
            return 4
        from app.services import feature_artifact_reconcile as far

        before = far.count_rows(db, session_id, targets.values(), far.INGEST_PATH_RECOVER)
        inserted_by = {}
        for pre, p in plans.items():
            inserted_by[pre] = far.apply_plan(db, session_id, targets[pre], p, ingest_path=far.INGEST_PATH_RECOVER)
        total = sum(inserted_by.values())
        after = far.count_rows(db, session_id, targets.values(), far.INGEST_PATH_RECOVER)
        if inserted_by != cur_by or after - before != total or total != doc["total_insert"]:
            print(f"[중단→롤백] 삽입 수 불일치: 계획 {cur_by} 실제 {inserted_by} (표식 행 {before}→{after})")
            db.rollback()
            return 5
        db.commit()
        print(f"적재 완료: 총 {total}행 {inserted_by} (표식 recover 행 {before}→{after})")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
