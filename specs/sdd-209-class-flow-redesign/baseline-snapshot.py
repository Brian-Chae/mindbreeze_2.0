#!/usr/bin/env python3
"""SDD-209 T0 — 원본 보유 스냅샷 실행기 (읽기 전용 집계).

사용(서버 backend 디렉터리에서, DATABASE_URL 은 환경변수로만 전달):
    cd /home/ubuntu/mindbreeze/backend
    export DATABASE_URL=$(grep -E '^DATABASE_URL=' ./.env.dev | head -1 | cut -d= -f2-)
    venv/bin/python baseline-snapshot.py baseline-snapshot.sql > snapshot-$(date +%Y%m%d-%H%M).txt

규칙: READ ONLY 트랜잭션, 집계(개수·바이트·날짜) 쿼리만. 접속 문자열·비밀번호는 출력하지 않는다.
"""
import os
import re
import sys

import sqlalchemy as sa


def main() -> int:
    url = os.environ.get("DATABASE_URL", "")
    if not url:
        print("DATABASE_URL 환경변수가 없습니다", file=sys.stderr)
        return 2
    path = sys.argv[1] if len(sys.argv) > 1 else "baseline-snapshot.sql"
    sql = open(path, encoding="utf-8").read()
    # 주석 제거 후 세미콜론 단위 분리
    body = re.sub(r"--[^\n]*", "", sql)
    stmts = [s.strip() for s in body.split(";") if s.strip()]
    for s in stmts:
        # 안전장치: SELECT 외 문장 금지
        if not re.match(r"^select\b", s, re.IGNORECASE):
            print("SELECT 외 문장은 실행하지 않습니다", file=sys.stderr)
            return 3
    engine = sa.create_engine(url)
    with engine.connect() as conn:
        conn.execute(sa.text("SET TRANSACTION READ ONLY"))
        for i, s in enumerate(stmts, 1):
            res = conn.execute(sa.text(s))
            print(f"--- Q{i}: {' | '.join(res.keys())}")
            for row in res.fetchall():
                print(" | ".join(str(v) for v in row))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
