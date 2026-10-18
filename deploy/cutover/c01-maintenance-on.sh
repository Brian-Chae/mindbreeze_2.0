#!/usr/bin/env bash
# C-1 점검 모드 ON + dev 쓰기 차단 (T+0). 여기서부터 점검창 시계(T0)가 시작된다.
#  · dev nginx: 503 점검 페이지(관리자 IP 우회) → nginx 재시작으로 기존 WebSocket 연결까지 차단
#  · dev cron(ubuntu crontab 14개) 백업 후 비움 · 워커 3종 중지(알림·스윕이 점검 중 데이터를 바꾸지 않게)
#  · 쓰기 정지 확인: 행 수 2회 측정(20초 간격) 동일 → 이후 단계의 비교 기준(C1-freeze-counts.tsv)
#    ※ plan C-0 기록은 점검 진입 5분 전 값이므로 최종 비교 기준은 '동결 후' 값을 사용한다(그 사이 정상 사용분 반영).
# 롤백: ./rollback.sh (dev 복귀). 사용: bash c01-maintenance-on.sh [--dry-run]
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

step_main() {
  need_env MB_ADMIN_IPS
  is_dry || mark_t0
  note "T0(점검 시작) = 이 단계 시작 시각. 이후 모든 'T+N분'은 이 시각 기준."

  # 점검 직전 마지막 게이트: 진행 중 세션 0
  local inprog; inprog="$(pg_dev "진행 중 세션 수(점검 직전)" "SELECT count(*) FROM sessions WHERE status IN ('in_progress','open')" --readonly)"
  is_dry || { [ "$inprog" = "0" ] || die "진행/오픈 세션 ${inprog}건 — 점검 진입 불가(롤백 불필요, 아직 변경 없음)"; }

  dev_put "$CUT_DIR/maintenance/nginx-maint.sh" "$CUT_DIR/maintenance/index.html" "$CUT_DIR/maintenance/moved.html" /tmp/
  remote_dev "점검 페이지 자산 배치" <<'EOF'
set -euo pipefail
mkdir -p /tmp/mb-maint && mv -f /tmp/nginx-maint.sh /tmp/index.html /tmp/moved.html /tmp/mb-maint/
EOF
  remote_dev "점검 모드 ON: nginx 503 + 관리자 IP 우회 (nginx -t 실패 시 자동 복원)" <<EOF
set -euo pipefail
sudo bash /tmp/mb-maint/nginx-maint.sh on --admin-ips '$MB_ADMIN_IPS' --new-url https://$WEB_HOST --assets /tmp/mb-maint
EOF

  remote_dev "dev cron 백업 후 비움 + 워커 중지" <<EOF
set -euo pipefail
BK=/home/ubuntu/cutover-backup; mkdir -p \$BK
crontab -l > \$BK/crontab.$RUN_ID 2>/dev/null || true
printf '# SDD-210 컷오버 중 비활성 (원본: %s) — rollback.sh 가 복원\n' "\$BK/crontab.$RUN_ID" | crontab -
echo "백업 cron 줄 수: \$(grep -vc '^#' \$BK/crontab.$RUN_ID || true) / 현재 cron: \$(crontab -l | grep -vc '^#' || true)"
for s in $DEV_SERVICES; do sudo systemctl stop \$s; done
for s in $DEV_SERVICES; do printf '%s=%s\n' \$s "\$(systemctl is-active \$s || true)"; done
# 점검 페이지 실제 응답 확인(서버 자신=관리자 IP 아님 → 503 이어야 함)
code=\$(curl -sk -o /dev/null -w '%{http_code}' --resolve dev-api.mindbreeze.looxidlabs.com:443:127.0.0.1 https://dev-api.mindbreeze.looxidlabs.com/health || true)
echo "점검 페이지 응답: \$code"
[ "\$code" = "503" ]
EOF

  # 쓰기 정지 확인 → 이후 비교 기준
  note "쓰기 정지 확인: 행 수 2회 측정(20초 간격)이 같아야 함"
  if is_dry; then
    pg_dev "동결 기준 행 수 A" "" --counts; pg_dev "동결 기준 행 수 B(20초 후)" "" --counts
  else
    pg_dev "동결 기준 행 수 A" "" --counts > "$RUN_DIR/C1-freeze-counts.tsv"
    sleep 20
    pg_dev "동결 기준 행 수 B" "" --counts > "$RUN_DIR/C1-freeze-counts-b.tsv"
    diff -q "$RUN_DIR/C1-freeze-counts.tsv" "$RUN_DIR/C1-freeze-counts-b.tsv" >/dev/null || die "쓰기가 계속되고 있음(행 수 변동) — 롤백(rollback.sh) 후 원인 확인"
    note "동결 확인 OK: $(awk -F'\t' '{s+=$2} END{print s}' "$RUN_DIR/C1-freeze-counts.tsv")행 / $(wc -l < "$RUN_DIR/C1-freeze-counts.tsv" | tr -d ' ')개 테이블"
    state_set maintenance_on "$(date -u +%FT%TZ)"
  fi
}
run_step "C-1" "점검 모드 ON · dev 워커·cron 중지 · 동결 확인" "$@"
