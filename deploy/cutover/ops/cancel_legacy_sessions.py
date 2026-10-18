#!/usr/bin/env python3
"""SDD-210 — 6자리 접속 코드를 가진 비종료 세션(진행/예정/준비/오픈) 목록·취소. dev 서버 backend 디렉터리에서 실행.

  list                     대상 목록(읽기 전용). 코드 값·참여자·제목은 출력하지 않는다. 호스트 이메일은 마스킹.
  cancel --execute         앱 서비스 transition_status(...,'cancel') 로 취소(참가자 알림·미디어 마감·state_version 일관성 유지).
                           --execute 가 없으면 '실행하지 않음'으로 목록만 출력한다.

환경: DATABASE_URL / REDIS_URL 이 설정돼 있어야 한다(래퍼 cancel-legacy-sessions.sh 가 .env.dev 에서 읽어 주입).
감사 기록: --audit-file 에 `id \t 이전상태 \t 결과` 를 남긴다.
"""
import argparse
import os
import sys

from sqlalchemy import text

from app.core.database import SessionLocal
from app.services import session_service

TARGET_SQL = text(
    """
    SELECT s.id::text, s.status, s.scheduled_at, s.host_id::text, u.email
    FROM sessions s JOIN users u ON u.id = s.host_id
    WHERE length(s.access_code) = 6 AND s.status NOT IN ('completed','cancelled') AND s.is_template = false
    ORDER BY s.scheduled_at NULLS LAST, s.created_at
    """
)


def mask(email: str) -> str:
    name, _, dom = (email or "").partition("@")
    return (name[:2] + "***@" + dom) if dom else "***"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["list", "cancel"])
    ap.add_argument("--execute", action="store_true")
    ap.add_argument("--audit-file")
    args = ap.parse_args()

    with SessionLocal() as db:
        rows = db.execute(TARGET_SQL).fetchall()
        print(f"대상 {len(rows)}건 (6자리 코드 · 비종료)")
        for sid, status, sched, host_id, email in rows:
            print(f"  {sid[:8]}…\t{status}\t예정={sched}\t호스트={mask(email)}")
        if args.mode == "list" or not args.execute:
            if args.mode == "cancel":
                print("--execute 없음: 취소하지 않았습니다.")
            return 0
        failed = 0
        audit = []
        for sid, status, _sched, host_id, _email in rows:
            try:
                session_service.transition_status(sid, host_id, "cancel", db)
                audit.append((sid, status, "cancelled"))
                print(f"  취소 완료 {sid[:8]}… (이전 {status})")
            except Exception as exc:  # noqa: BLE001
                db.rollback()
                failed += 1
                audit.append((sid, status, f"FAILED:{type(exc).__name__}"))
                print(f"  실패 {sid[:8]}… {type(exc).__name__}: {exc}", file=sys.stderr)
        if args.audit_file:
            with open(args.audit_file, "a", encoding="utf-8") as fh:
                for a in audit:
                    fh.write("\t".join(a) + "\n")
        left = db.execute(text("SELECT count(*) FROM sessions WHERE length(access_code)=6 AND status NOT IN ('completed','cancelled') AND is_template=false")).scalar()
        print(f"취소 후 잔여 {left}건 / 실패 {failed}건")
        return 0 if left == 0 and failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
