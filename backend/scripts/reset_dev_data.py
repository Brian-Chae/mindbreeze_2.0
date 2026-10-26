"""데이터 초기화(SDD-214 Z 트랙) — 수동 실행 전용. 절차: specs/sdd-214-class-structure-phase1/reset-procedure.md

사용:
  cd backend && source venv/bin/activate
  python scripts/reset_dev_data.py                     # dry-run (기본) — 삭제 대상 건수만 출력
  python scripts/reset_dev_data.py --apply --i-understand-this-deletes-data   # Brian 확인 후에만

안전장치: 대상 호스트는 허용 목록(RESET_ALLOWED_HOSTS 또는 --allow-host)에 있거나 로컬이어야 하고, prod 로
판정되면(--allow-prod + 허용 목록 + --scope sessions 가 모두 있어야) 외에는 거부한다. 삭제는 두 플래그를 모두
지정해야 한다. 출력·오류에는 건수와 테이블명만 나오며 접속 문자열·개인정보·S3 키 원문은 나오지 않는다.
"""

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import sqlalchemy as sa  # noqa: E402

from app.services import dev_data_reset as dr  # noqa: E402


def _csv(value: str | None) -> list[str]:
    return [v.strip() for v in (value or "").split(",") if v.strip()]


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="데이터 초기화(dry-run 기본)")
    p.add_argument("--scope", choices=("all", "sessions"), default="all",
                   help="all: 전 테이블(alembic_version 제외) / sessions: 계정·기관 유지, 세션 계열만")
    p.add_argument("--apply", action="store_true", help="실제로 삭제한다(기본은 dry-run)")
    p.add_argument("--i-understand-this-deletes-data", dest="confirmed", action="store_true",
                   help="삭제가 비가역임을 이해했다는 명시 플래그(--apply 와 함께)")
    p.add_argument("--database-url", help="기본: 환경변수 DATABASE_URL, 없으면 앱 설정")
    p.add_argument("--allow-host", action="append", default=[], help="허용 DB 호스트(반복 가능)")
    p.add_argument("--prod-host", action="append", default=[], help="prod 로 취급할 호스트(반복 가능)")
    p.add_argument("--allow-prod", action="store_true", help="prod 호스트 허용(허용 목록·--scope sessions 도 필요)")
    p.add_argument("--redis", action="store_true", help="Redis(Celery 큐·캐시) 현재 DB 도 비운다")
    p.add_argument("--redis-url", help="기본: 환경변수 REDIS_URL, 없으면 앱 설정")
    p.add_argument("--s3-bucket", help="S3 정리 대상 버킷(앱 설정의 버킷과 같아야 한다)")
    p.add_argument("--s3-prefix", action="append", default=[], help="삭제할 S3 프리픽스('/'로 끝남, 반복 가능)")
    return p


def _database_url(arg: str | None) -> str:
    url = arg or os.environ.get("DATABASE_URL")
    if url:
        return url
    from app.config import settings

    return settings.database_url


def _redis_client(url: str):
    import redis

    return redis.from_url(url)


def _s3_store(bucket: str):
    from app.config import settings
    from app.services import storage_service

    if bucket != settings.s3_bucket:
        raise dr.ResetGuardError("--s3-bucket 이 앱 설정의 버킷과 다르다")
    client = storage_service._s3_client()
    if client is None:
        raise dr.ResetGuardError("S3 자격증명이 설정되어 있지 않다")
    return dr.Boto3PrefixStore(client)


def run(argv: list[str]) -> dict:
    args = _parser().parse_args(argv)
    allowed = [*args.allow_host, *_csv(os.environ.get("RESET_ALLOWED_HOSTS"))]
    prod_hosts = [*args.prod_host, *_csv(os.environ.get("RESET_PROD_HOSTS"))]
    url = _database_url(args.database_url)
    env = dr.classify_target(url, allowed_hosts=allowed, prod_hosts=prod_hosts, allow_prod=args.allow_prod)
    dr.check_apply_flags(apply=args.apply, confirmed=args.confirmed, env=env, scope=args.scope)
    if bool(args.s3_bucket) != bool(args.s3_prefix):
        raise dr.ResetGuardError("--s3-bucket 과 --s3-prefix 는 함께 지정해야 한다")
    redis_url = None
    if args.redis:
        redis_url = args.redis_url or os.environ.get("REDIS_URL")
        if not redis_url:
            from app.config import settings

            redis_url = settings.redis_url
        dr.classify_target(redis_url, allowed_hosts=allowed, prod_hosts=prod_hosts, allow_prod=args.allow_prod)
    s3_store = _s3_store(args.s3_bucket) if args.s3_bucket else None

    engine = sa.create_engine(url)
    try:
        report = dr.reset_database(engine, scope=args.scope, apply=args.apply)
    finally:
        engine.dispose()
    result: dict = {
        "env": env,
        "scope": report.scope,
        "applied": report.applied,
        "total_rows": report.total_rows,
        "tables": report.table_counts,
    }
    if redis_url:
        result["redis_keys"] = dr.reset_redis(_redis_client(redis_url), apply=args.apply)
    if s3_store:
        result["s3_objects"] = dr.reset_s3(s3_store, bucket=args.s3_bucket, prefixes=args.s3_prefix, apply=args.apply)
    return result


def main(argv: list[str] | None = None) -> int:
    try:
        result = run(sys.argv[1:] if argv is None else argv)
    except dr.ResetGuardError as exc:
        print(f"거부: {exc}", file=sys.stderr)
        return 2
    except sa.exc.SQLAlchemyError as exc:
        # SQLAlchemy 오류 문자열에는 접속 정보가 섞일 수 있어 종류만 출력한다.
        print(f"DB 오류({type(exc).__name__}): 접속·권한을 확인하라", file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
