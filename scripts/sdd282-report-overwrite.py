"""SDD-282 리포트 덮어쓰기 — 재발송·승인 없이 본문만 다시 생성한다.

순서: ① 대상 리포트(대상 참여행 client + counselor)의 본문·상태를 JSON 으로 백업(파일 경로 출력, 0600)
      ② 부수 효과 3개 함수(메일 예약·AI 서사 예약·진행 방송)를 무력화(monkeypatch)
      ③ `report_task.generate_report_inline` **만** 호출(API generate_report / generate_client_reports_for_session 금지)
      ④ 호출 직후 리포트마다 검증: 상태·sent_at·approved_*·delivery_*·참가자 report_email_sent_at 불변,
         notification_outbox 건수 불변. 하나라도 어긋나면 그 리포트를 백업으로 복원하고 중단(종료코드 6).
승인·발송은 하지 않는다. 적재(`sdd282-recovery-load.py --apply`)가 끝난 **뒤에** 실행한다.

기본은 `--dry-run`(대상 목록만, 쓰기 없음). `--apply` 에만 백업·덮어쓰기를 한다.
백업 파일에는 개인정보가 들어 있을 수 있다 — 저장소 밖 보호 경로(--backup-dir)에 두고 커밋하지 않는다.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

DEFAULT_SESSION = "1a74e4c9-a54e-4454-8505-22840922811c"
REQUIRED_TARGETS = ("de8312", "6a2172", "518675", "ac1a78")

# 백업·복원 대상 컬럼 (설계 §3-2 + 불변 검증 대상)
BACKUP_COLS = ("content", "status", "generation_status", "generation_error", "generation_started_at", "data_credibility",
               "pdf_url", "sent_at", "is_read", "approved_by_user_id", "approved_at", "approved_by_name", "approved_by_role",
               "approval_source", "delivery_status", "delivery_attempted_at", "delivery_attempt_count", "delivery_failure_code")
# 덮어쓰기 전후로 같아야 하는 값
INVARIANT_COLS = ("status", "sent_at", "approved_at", "approved_by_user_id", "approved_by_name", "approved_by_role",
                  "approval_source", "delivery_status", "delivery_attempted_at", "delivery_attempt_count",
                  "delivery_failure_code", "pdf_url", "is_read")


def _bootstrap_path() -> None:
    backend = Path(__file__).resolve().parents[1] / "backend"
    if str(backend) not in sys.path:
        sys.path.insert(0, str(backend))


def _enc(v):
    if isinstance(v, datetime):
        return {"__dt__": v.isoformat()}
    if isinstance(v, uuid.UUID):
        return {"__uuid__": str(v)}
    if isinstance(v, Decimal):
        return float(v)
    return v


def _dec(v):
    if isinstance(v, dict) and "__dt__" in v:
        return datetime.fromisoformat(v["__dt__"])
    if isinstance(v, dict) and "__uuid__" in v:
        return uuid.UUID(v["__uuid__"])
    return v


def snapshot(report) -> dict:
    return {c: getattr(report, c) for c in BACKUP_COLS}


def restore_report(db, report, saved: dict) -> None:
    """백업 JSON 의 값(저장 형식)으로 리포트 한 건을 되돌린다. commit 은 호출자 몫."""
    for c in BACKUP_COLS:
        setattr(report, c, _dec(saved[c]) if c != "content" else saved[c])


def load_targets(db, session_id: uuid.UUID, prefixes: list[str], include_counselor: bool):
    from sqlalchemy import select, text

    from app.models.record import Report

    pids = {}
    for pre in prefixes:
        rows = db.execute(text("select id from session_participants where session_id=:s and id::text like :p"),
                          {"s": session_id, "p": pre + "%"}).scalars().all()
        if len(rows) != 1:
            raise SystemExit(f"[중단] 참여행 {pre} 해석 결과 {len(rows)}건")
        pids[pre] = rows[0]
    reports = []
    for pre, pid in pids.items():
        r = db.execute(select(Report).where(Report.session_id == session_id, Report.participant_id == pid,
                                            Report.type == "client")).scalar_one_or_none()
        if r is None:
            raise SystemExit(f"[중단] {pre} 의 client 리포트가 없다")
        reports.append(r)
    if include_counselor:
        cs = db.execute(select(Report).where(Report.session_id == session_id, Report.type == "counselor")).scalars().all()
        reports.extend(cs)  # 회차 counselor 리포트(1건 기대) — 마지막에 처리
    return pids, reports


def write_backup(backup_dir: Path, session_id: uuid.UUID, reports) -> Path:
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = backup_dir / f"sdd282-report-backup-{str(session_id)[:6]}-{stamp}.json"
    doc = {"session_id": str(session_id), "created_at": stamp,
           "reports": {str(r.id): {"type": r.type, "participant_id": str(r.participant_id) if r.participant_id else None,
                                   "values": {k: _enc(v) for k, v in snapshot(r).items()}} for r in reports}}
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False)
    return path


class _Neutralized:
    """report_task 의 부수 효과 3개 함수를 no-op 으로 바꾸고, 호출 시도 수를 센다."""

    NAMES = ("_maybe_enqueue_client_report_email", "_maybe_enqueue_class_narrative", "_emit_report_progress")

    def __init__(self, module):
        self.module = module
        self.saved: dict = {}
        self.calls = {n: 0 for n in self.NAMES}

    def __enter__(self):
        for n in self.NAMES:
            self.saved[n] = getattr(self.module, n)

            def _noop(*a, _n=n, **k):  # noqa: ANN001
                self.calls[_n] += 1

            setattr(self.module, n, _noop)
        return self

    def __exit__(self, *exc):
        for n, f in self.saved.items():
            setattr(self.module, n, f)


def _outbox_count(db) -> int:
    from sqlalchemy import func, select

    from app.models.notification_outbox import NotificationOutbox

    return int(db.execute(select(func.count()).select_from(NotificationOutbox)).scalar_one())


def overwrite(db, reports, backup_values: dict, generate) -> list[dict]:
    """리포트를 차례로 덮어쓰고 검증한다. 어긋나면 해당 리포트를 복원하고 SystemExit(6)."""
    from app.models.session import SessionParticipant

    results = []
    for r in reports:
        rid = str(r.id)
        before = {c: getattr(r, c) for c in INVARIANT_COLS}
        before_len = len(json.dumps(r.content, ensure_ascii=False))
        part_sent = None
        if r.participant_id:
            p = db.get(SessionParticipant, r.participant_id)
            part_sent = p.report_email_sent_at if p else None
        outbox_before = _outbox_count(db)
        generate(rid, db)
        db.expire_all()
        from app.models.record import Report

        cur = db.get(Report, r.id)
        problems = []
        for c in INVARIANT_COLS:
            if getattr(cur, c) != before[c]:
                problems.append(f"{c}: {before[c]!r} → {getattr(cur, c)!r}")
        if cur.status == "error" or cur.generation_status not in ("ready", "partial"):
            problems.append(f"생성 결과 이상: status={cur.status} generation_status={cur.generation_status}")
        if r.participant_id:
            p = db.get(SessionParticipant, r.participant_id)
            if (p.report_email_sent_at if p else None) != part_sent:
                problems.append("participant.report_email_sent_at 변경")
        if _outbox_count(db) != outbox_before:
            problems.append("notification_outbox 건수 변경")
        after_len = len(json.dumps(cur.content, ensure_ascii=False))
        if problems:
            restore_report(db, cur, backup_values[rid])
            db.commit()
            print(f"[중단→복원] 리포트 {rid[:6]} ({cur.type}) 검증 실패: {problems}")
            raise SystemExit(6)
        results.append({"report": rid[:6], "type": cur.type, "status": cur.status, "content_chars": f"{before_len}→{after_len}",
                        "generation_status": cur.generation_status, "data_credibility": cur.data_credibility})
    return results


def main(argv: list[str] | None = None, *, session_factory=None, generate=None) -> int:
    _bootstrap_path()
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", help="기본값. 대상 목록만 출력(쓰기 없음).")
    mode.add_argument("--apply", action="store_true", help="백업 후 덮어쓰기 실행.")
    ap.add_argument("--session", default=DEFAULT_SESSION)
    ap.add_argument("--targets", nargs="+", default=list(REQUIRED_TARGETS))
    ap.add_argument("--no-counselor", action="store_true", help="counselor 리포트는 제외(client 만)")
    ap.add_argument("--backup-dir", help="--apply 필수: 저장소 밖 보호 경로")
    args = ap.parse_args(argv)

    from sqlalchemy import text

    if session_factory is None:
        from app.core.database import SessionLocal as session_factory  # noqa: N813
    session_id = uuid.UUID(args.session)
    db = session_factory()
    try:
        if not args.apply:
            db.execute(text("SET TRANSACTION READ ONLY"))
        _, reports = load_targets(db, session_id, args.targets, not args.no_counselor)
        print(f"대상 리포트 {len(reports)}건:", [(str(r.id)[:6], r.type, r.status, len(json.dumps(r.content, ensure_ascii=False))) for r in reports])
        if not args.apply:
            db.rollback()
            print("끝 — 쓰기 없음(READ ONLY 트랜잭션 rollback)")
            return 0
        if not args.backup_dir:
            print("[중단] --apply 에는 --backup-dir 이 필요하다.")
            return 2
        path = write_backup(Path(args.backup_dir), session_id, reports)
        backup_values = json.loads(path.read_text(encoding="utf-8"))["reports"]
        backup_values = {k: v["values"] for k, v in backup_values.items()}
        print(f"백업 저장: {path} ({path.stat().st_size} bytes, {len(reports)}건)")
        if generate is None:
            from app.tasks import report_task

            generate = report_task.generate_report_inline
            with _Neutralized(report_task) as neut:
                results = overwrite(db, reports, backup_values, generate)
            print("무력화한 부수 효과 호출 시도(실제 실행 0):", neut.calls)
        else:
            results = overwrite(db, reports, backup_values, generate)
        for r in results:
            print(" ", r)
        print(f"덮어쓰기 완료 {len(results)}건 — 승인·발송 없음(상태 불변 검증 통과)")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
