#!/usr/bin/env python3
"""SDD-210 컷오버 — 원격 호스트(dev/prod)에서 실행하는 최소 DB 질의기.

접속 정보는 호스트의 env 파일(DATABASE_URL_SYNC)에서 읽고 **어디에도 출력하지 않는다**.
SQL 은 표준입력으로 받는다(문장 구분: 줄 단독 `--;--`). 결과는 탭 구분 텍스트(헤더 없음).

  pgrun.py --env-file F [--dbname NAME] [--autocommit] [--readonly] < sql
  pgrun.py --env-file F --counts [--dbname NAME]        # 모든 public 테이블 정확 행 수: <table>\t<count>
"""
import argparse
import re
import sys

import psycopg2
from psycopg2 import extensions


def read_url(path: str) -> str:
    url = ""
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            if line.startswith("DATABASE_URL_SYNC="):
                url = line.split("=", 1)[1].strip()
                break
    if len(url) >= 2 and url[0] == url[-1] and url[0] in "\"'":
        url = url[1:-1].replace('\\"', '"').replace("\\\\", "\\")
    url = re.sub(r"^postgresql\+\w+://", "postgresql://", url)
    if not url:
        sys.exit("DATABASE_URL_SYNC 없음")
    return url


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--env-file", required=True)
    ap.add_argument("--dbname")
    ap.add_argument("--autocommit", action="store_true")
    ap.add_argument("--readonly", action="store_true")
    ap.add_argument("--counts", action="store_true")
    args = ap.parse_args()

    dsn = read_url(args.env_file)
    if args.dbname:
        dsn = extensions.make_dsn(dsn, dbname=args.dbname)
    conn = psycopg2.connect(dsn, connect_timeout=15)
    if args.autocommit:
        conn.autocommit = True
    cur = conn.cursor()
    cur.execute("SET statement_timeout = '120s'")
    if args.readonly or args.counts:
        cur.execute("SET default_transaction_read_only = on")
    if args.counts:
        cur.execute("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1")
        for (t,) in cur.fetchall():
            cur.execute(f'SELECT count(*) FROM public."{t}"')
            print(f"{t}\t{cur.fetchone()[0]}")
        conn.rollback()
        return 0
    sql = sys.stdin.read()
    for stmt in [s.strip() for s in re.split(r"(?m)^--;--\s*$", sql) if s.strip()]:
        cur.execute(stmt)
        if cur.description:
            for row in cur.fetchall():
                print("\t".join("" if v is None else str(v) for v in row))
    if not args.autocommit:
        conn.commit()
    return 0


if __name__ == "__main__":
    sys.exit(main())
