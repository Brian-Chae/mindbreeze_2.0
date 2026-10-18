#!/usr/bin/env bash
# SDD-210 C-8 보조: 스모크 계정으로 API 수준 점검 (로그인·세션 목록·리포트 목록·무효 refresh 401).
#   MB_SMOKE_EMAIL=… MB_SMOKE_PASSWORD_FILE=<비밀번호 한 줄 파일> bash smoke-api.sh <api-host>
# 비밀번호는 파일에서만 읽고 출력하지 않는다. 계정이 없으면 SKIP(종료 코드 3) — 호출 쪽이 '수동 확인 필요'로 기록.
set -uo pipefail
API="${1:?api-host}"
[ -n "${MB_SMOKE_EMAIL:-}" ] && [ -r "${MB_SMOKE_PASSWORD_FILE:-/nonexistent}" ] || { echo "SKIP: MB_SMOKE_EMAIL / MB_SMOKE_PASSWORD_FILE 미지정"; exit 3; }
fail=0
check() { if [ "$2" = "$3" ]; then echo "  OK   $1 ($3)"; else echo "  FAIL $1: 기대 $2, 실제 $3"; fail=1; fi; }
BODY="$(python3 -c 'import json,os; print(json.dumps({"email": os.environ["MB_SMOKE_EMAIL"], "password": open(os.environ["MB_SMOKE_PASSWORD_FILE"]).read().strip()}))')"
RESP="$(mktemp)"; trap 'rm -f "$RESP"' EXIT
code="$(curl -sS --max-time 20 -o "$RESP" -w '%{http_code}' -H 'Content-Type: application/json' -d "$BODY" "https://$API/api/v1/auth/login" || echo 000)"
check "로그인" 200 "$code"
TOKEN="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("access_token",""))' "$RESP" 2>/dev/null || true)"
if [ -n "$TOKEN" ]; then
  H="Authorization: Bearer $TOKEN"
  check "세션 목록" 200 "$(curl -sS --max-time 20 -o /dev/null -w '%{http_code}' -H "$H" "https://$API/api/v1/sessions" || echo 000)"
  check "리포트 목록" 200 "$(curl -sS --max-time 20 -o /dev/null -w '%{http_code}' -H "$H" "https://$API/api/v1/reports" || echo 000)"
else
  echo "  FAIL 액세스 토큰 없음"; fail=1
fi
check "무효 refresh 거부" 401 "$(curl -sS --max-time 20 -o /dev/null -w '%{http_code}' -X POST -H 'Cookie: refresh_token=invalid' "https://$API/api/v1/auth/refresh" || echo 000)"
sio="$(curl -sS --max-time 20 -o /dev/null -w '%{http_code}' "https://$API/socket.io/?EIO=4&transport=polling" || echo 000)"
echo "  INFO Socket.IO polling 응답 코드 $sio (참고용 — 판정 제외, 실시간 EEG 는 수동 확인)"
[ "$fail" = 0 ] && echo "[smoke-api] 통과" || echo "[smoke-api] 실패"
exit "$fail"
