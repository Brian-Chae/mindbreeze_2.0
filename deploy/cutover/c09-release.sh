#!/usr/bin/env bash
# C-9 점검 해제 (T+약 60분 이내): 리허설 임시 설정 원복 → prod 점검 모드 OFF(신규 접속 허용) → dev 를 '새 주소 안내' 페이지로 전환 → 업타임 감시 생성.
#  · 전제: C-8 스모크 통과(state smoke_ok). 이 단계 이후 prod 에 실사용 쓰기가 생기므로 **단순 복귀(rollback.sh) 금지** — 수정 배포 우선, 데이터 손상 시 PITR.
#  · dev 는 계속 점검(관리자 우회) + 안내 페이지 유지, 워커·cron 중지 유지(T-21 전까지, 메일로 이미 나간 dev 링크 클릭 시 새 주소 안내).
# 사용: bash c09-release.sh [--dry-run]
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

step_main() {
  local ips; ips="${MB_ADMIN_IPS:-$(state_get admin_ips)}"
  if ! is_dry; then state_has smoke_ok || die "C-8 스모크 통과 기록 없음(smoke_ok) — 점검 해제 불가"; fi
  note "1) 리허설 임시 설정 원복"
  bash "$CUT_DIR/revert-rehearsal.sh" $( is_dry && echo --dry-run )

  note "2) 원복 후 공개 스모크 재확인(기본 운영 호스트, 관리자 IP 에서 실행)"
  x "공개 스모크 9항목(CORS 포함) 재실행" bash "$REPO_ROOT/deploy/ci/smoke.sh" "$WEB_HOST" "$API_HOST"

  note "3) 점검 해제"
  prod_maint off
  remote_dev "dev: 점검 페이지 → '새 주소 안내' 페이지 전환(관리자 IP 우회 유지)" <<EOF
set -euo pipefail
sudo bash /tmp/mb-maint/nginx-maint.sh moved --admin-ips '$ips' --new-url https://$WEB_HOST --assets /tmp/mb-maint
EOF
  if ! is_dry; then
    state_set maintenance_off "$(date -u +%FT%TZ)"; state_set t_release_epoch "$(now_epoch)"
    note "점검창 실제 소요: $(elapsed_min)분 (T0 → 점검 해제)"
  fi

  note "4) 업타임 감시 생성(서비스 연결·점검 해제 후)"
  bash "$CUT_DIR/uptime-monitor.sh" create $( is_dry && echo --dry-run )
}
run_step "C-9" "점검 해제 · 임시 설정 원복 · dev 안내 페이지 · 업타임 감시" "$@"
