#!/usr/bin/env bash
# C-8 운영 스모크 (T+약 50~60분). 자동 판정 항목이 하나라도 실패하면 중단 → 점검 해제(C-9) 금지, 롤백 판단.
#  자동:  ① 공개 스모크 9항목(deploy/ci/smoke.sh: 프론트·/health/ready·SPA 폴백·역할 시뮬레이션 404×2·CORS 허용/dev 차단/임의 차단·HSTS)
#         ② 인증서 SAN·만료일  ③ 스모크 계정 API(smoke-api.sh: 로그인·세션/리포트 목록·무효 refresh 401) — 계정 지정 시
#         ④ 정지된 dev 계정 로그인 차단 확인(서버 내부 호출, 계정 정보 비출력)  ⑤ LiveKit 시그널링 경로·TURN 포트(3478/tcp) 도달
#         ⑥ 오류 로그 0건(최근 5분 backend ERROR)
#  수동(점검 해제 후 C-10 관찰 중 Brian/QA): Google 로그인, 클래스 입장 4자리 코드, 실시간 EEG, 화상(LiveKit/TURN) 2자, 음성 업로드→리포트 생성, 본인 주소 메일 — 실패는 핫픽스 대상(롤백 기준 아님, plan §6 롤백 기준 참조)
#  ※ prod 는 C-6 에서 점검 모드(관리자 IP 우회)이므로 이 스모크는 MB_ADMIN_IPS 에 포함된 IP(=운영자 로컬)에서 실행해야 한다.
#  업타임 감시는 점검 해제 후(C-9)에 생성한다 — 점검 중 503 으로 상시 오경보가 나지 않도록.
# 사용: bash c08-smoke.sh [--dry-run]     (선택) MB_SMOKE_EMAIL=… MB_SMOKE_PASSWORD_FILE=…
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

step_main() {
  x "① 공개 스모크 9항목" bash "$REPO_ROOT/deploy/ci/smoke.sh" "$WEB_HOST" "$API_HOST"

  x "② 인증서 SAN·만료일" bash -c "echo | openssl s_client -servername $API_HOST -connect $API_HOST:443 2>/dev/null | openssl x509 -noout -subject -enddate -ext subjectAltName"

  if is_dry; then
    x "③ 스모크 계정 API 점검(계정 미지정 시 SKIP=수동 확인으로 기록)" bash "$CUT_DIR/smoke-api.sh" "$API_HOST"
  else
    local rc=0
    bash "$CUT_DIR/smoke-api.sh" "$API_HOST" | tee "$RUN_DIR/C8-smoke-api.txt" >&2 || rc=$?
    case "$rc" in
      0) ;;
      3) note "스모크 계정 미지정 → 로그인·목록 API 는 C-10 에서 수동 확인 필요(자동 판정 제외)" ;;
      *) die "스모크 계정 API 점검 실패" ;;
    esac
  fi

  remote_prod "④⑤⑥ 정지 dev 계정 차단·LiveKit/TURN 도달·오류 로그" 300 <<EOF
# ④ 정지된 dev 계정 로그인 → 403(정지) 기대. 이메일은 DB 에서 읽어 출력하지 않음. 401/422 는 '판정 불가'로 경고만.
EM=\$(/opt/mindbreeze/venv/bin/python - <<'PY'
import re, psycopg2
url = [l.split("=", 1)[1].strip().strip('"') for l in open("$PROD_ENV_FILE") if l.startswith("DATABASE_URL_SYNC=")][0]
c = psycopg2.connect(re.sub(r"^postgresql\+\w+://", "postgresql://", url)); cur = c.cursor()
cur.execute("SELECT email FROM users WHERE auth_provider='dev' LIMIT 1"); r = cur.fetchone(); print(r[0] if r else "")
PY
)
if [ -n "\$EM" ]; then
  code=\$(python3 -c 'import json,sys; print(json.dumps({"email": sys.argv[1], "password": "x"}))' "\$EM" | curl -s -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -d @- http://127.0.0.1:8000/api/v1/auth/login)
  echo "정지 dev 계정 로그인 응답: \$code (403 기대, 401/422=판정 불가)"
  [ "\$code" != "200" ]
else echo "dev 계정 없음(확인 대상 없음)"; fi
# ⑤ LiveKit 시그널링(nginx 경유) / TURN
code=\$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:7880/ || true); echo "livekit 로컬 응답: \$code"
timeout 3 bash -c '</dev/tcp/127.0.0.1/3478' && echo "TURN 3478/tcp 열림" || { echo "TURN 3478/tcp 닫힘"; exit 1; }
# ⑥ 최근 5분 backend 오류
n=\$(journalctl -u mindbreeze-backend --since '-5min' --no-pager 2>/dev/null | grep -ciE ' (ERROR|CRITICAL) |Traceback' || true)
echo "최근 5분 backend 오류 줄: \$n"
[ "\$n" -eq 0 ]
EOF

  is_dry || state_set smoke_ok "$(date -u +%FT%TZ)"
}
run_step "C-8" "운영 스모크(자동 판정)" "$@"
