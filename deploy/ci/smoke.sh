#!/usr/bin/env bash
# SDD-210 T-5: 운영 공개 주소 스모크 (verify V-5.1·V-2.3·V-2.6 일부). 비밀·로그인 불필요한 항목만.
# 사용: smoke.sh <web-host> <api-host>     예) smoke.sh mindbreeze.looxidlabs.com api.mindbreeze.looxidlabs.com
set -uo pipefail
WEB="${1:?web-host}"; API="${2:?api-host}"
CURL=(curl -sS --max-time 15 -o /dev/null)
fail=0
check() { # <이름> <기대 코드> <실제 코드>
  if [ "$2" = "$3" ]; then echo "  OK   $1 ($3)"; else echo "  FAIL $1: 기대 $2, 실제 $3"; fail=1; fi
}
echo "[smoke] https://$WEB , https://$API"
check "프론트 /" 200 "$("${CURL[@]}" -w '%{http_code}' "https://$WEB/" || echo 000)"
check "API /health/ready" 200 "$("${CURL[@]}" -w '%{http_code}' "https://$API/health/ready" || echo 000)"
check "SPA 라우트 폴백" 200 "$("${CURL[@]}" -w '%{http_code}' "https://$WEB/login" || echo 000)"
check "개발용 로그인 라우터 부재(users)" 404 "$("${CURL[@]}" -w '%{http_code}' "https://$API/api/v1/dev/auth/users" || echo 000)"
check "개발용 로그인 라우터 부재(login)" 404 "$("${CURL[@]}" -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' "https://$API/api/v1/dev/auth/login" || echo 000)"
# CORS: 운영 오리진 허용, dev 오리진·임의 오리진 차단
acao() { curl -sS --max-time 15 -D - -o /dev/null -X OPTIONS -H "Origin: $1" -H 'Access-Control-Request-Method: GET' "https://$API/health" | tr -d '\r' | awk -F': ' 'tolower($1)=="access-control-allow-origin"{print $2}'; }
check "CORS 운영 오리진 허용" "https://$WEB" "$(acao "https://$WEB")"
check "CORS dev 오리진 차단" "" "$(acao "https://dev.mindbreeze.looxidlabs.com")"
check "CORS 임의 오리진 차단" "" "$(acao "https://evil.example.com")"
hsts="$(curl -sS --max-time 15 -D - -o /dev/null "https://$WEB/" | tr -d '\r' | grep -ci '^strict-transport-security:')"
check "HSTS 헤더" 1 "$hsts"
[ "$fail" = 0 ] && echo "[smoke] 통과" || echo "[smoke] 실패"
exit "$fail"
