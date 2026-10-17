#!/usr/bin/env bash
# SDD-210 T-1: dev 서버에서 읽기 전용 사전 집계 실행.
# 서버의 backend/.env.dev 의 DATABASE_URL_SYNC 를 파일에서 읽어 psql 에 전달한다(값은 화면에 출력하지 않음).
# 사용: bash run-precheck.sh [env 파일 경로] > precheck-$(date +%F).txt
set -euo pipefail
ENV_FILE="${1:-/home/ubuntu/mindbreeze/backend/.env.dev}"
HERE="$(cd "$(dirname "$0")" && pwd)"
[ -r "$ENV_FILE" ] || { echo "env 파일을 읽을 수 없음: $ENV_FILE" >&2; exit 2; }
URL="$(grep -E '^DATABASE_URL_SYNC=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"' | sed 's#^postgresql+psycopg2://#postgresql://#; s#^postgresql+psycopg://#postgresql://#')"
[ -n "$URL" ] || { echo "DATABASE_URL_SYNC 없음" >&2; exit 2; }
PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=30000' \
  psql "$URL" -X -v ON_ERROR_STOP=0 -f "$HERE/cutover-precheck.sql"
