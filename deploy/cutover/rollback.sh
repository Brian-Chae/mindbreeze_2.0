#!/usr/bin/env bash
# 컷오버 롤백 (plan §6 롤백 기준). 사람이 판단해 호출한다(자동 호출 없음). 실행한 단계까지만 되돌린다(state 파일 기준, 멱등).
#
#  구간 A  C-1 ~ C-6 (DNS 전환 전)  : prod 변경은 폐기 없이 두고, dev 를 원상 복귀 — 점검 해제 + dev cron/워커 재가동. 데이터 분기 없음(쓰기 차단 상태였음).
#  구간 B  C-7 ~ C-8 (DNS 전환 후, 점검 해제 전): prod timer 를 **먼저** 중지(이중 발송 방지) → 신규 A 레코드 2개 삭제(기존 상태로 복귀) → 구간 A 와 동일.
#          ※ plan 문구 'DNS 를 dev EIP 로 되돌림' 은 이 컷오버에서 '신규 레코드 삭제'로 구현한다: 운영 주소는 컷오버 전에 존재하지 않았고(dev 는 dev.* 주소 사용),
#            dev nginx 에는 운영 호스트명 server 블록이 없어 UPSERT 로 dev IP 를 가리켜도 응답하지 못한다. 삭제 후 SOA 음성 캐시(기본 최대 15분)로 새 주소 접속 실패가 잠시 남을 수 있다.
#  구간 C  C-9 이후 (점검 해제 후): **자동 롤백 금지**. 실사용 쓰기가 prod 에 생겼다. 수정 배포(deploy-prod/rollback-prod.yml) 우선, 데이터 손상 시 PITR,
#          dev 로 되돌려야 하면 prod→dev 역복원 절차(별도 승인). 이 스크립트는 안내만 출력하고 종료한다.
#
# prod 쪽 리소스(RDS mindbreeze-prod, 스냅샷, S3 복사본, 서버 릴리스)는 삭제하지 않는다 — 재시도·원인 분석용. 정리는 별건 승인.
# 사용: bash rollback.sh [--dry-run]
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

step_main() {
  if ! is_dry && state_has maintenance_off; then
    cat >&2 <<'MSG'
[중단] 점검 해제(C-9) 이후입니다. 자동 롤백을 하지 않습니다.
  1) 문제 유형별: 앱 결함 → Rollback Prod 워크플로(직전 릴리스) 또는 수정 배포 / 데이터 손상 → RDS PITR 로 임시 인스턴스 복원 후 판단(RPO≈2분, RTO≈10분 실측)
  2) dev 로 되돌려야 하면 prod→dev 역복원(실사용 데이터 포함)이므로 Brian 별도 승인 후 진행
MSG
    exit 3
  fi

  local ips; ips="${MB_ADMIN_IPS:-$(state_get admin_ips)}"
  if is_dry; then note "구간 판정: dns_switched 기록이 있으면 B(DNS 레코드 삭제 포함), 없으면 A"; fi

  # prod 쪽 중단 (timer 먼저 — 이중 발송 방지)
  if is_dry || state_has prod_timers_on; then
    remote_prod "prod 주기 작업 timer 중지(이중 발송 방지, 먼저 수행)" 120 <<'EOF'
bash /opt/mindbreeze/current/deploy/jobs-ctl.sh disable /opt/mindbreeze/current/deploy/jobs.tsv
echo "남은 활성 timer: $(systemctl list-timers 'mindbreeze-job-*' --no-pager --no-legend | wc -l)"
EOF
  fi

  # DNS 복귀
  if is_dry || state_has dns_switched; then
    local batch; batch="$(python3 - "$WEB_HOST" "$API_HOST" "$PROD_EIP" <<'PY'
import json, sys
web, api, ip = sys.argv[1:4]
print(json.dumps({"Comment": "SDD-210 rollback: remove public prod records", "Changes": [
  {"Action": "DELETE", "ResourceRecordSet": {"Name": h + ".", "Type": "A", "TTL": 60, "ResourceRecords": [{"Value": ip}]}} for h in (web, api)]}))
PY
)"
    x "Route53 신규 A 레코드 2개 삭제(TTL 60)" aws route53 change-resource-record-sets --hosted-zone-id "$ZONE_ID" --change-batch "$batch"
    is_dry || { state_set dns_rolled_back "$(date -u +%FT%TZ)"; }
  fi

  # dev 복귀
  remote_dev "dev 복귀: cron 복원 → 워커 재가동 → 점검 모드 해제 → 헬스 확인" <<EOF
set -euo pipefail
BK=/home/ubuntu/cutover-backup/crontab.$RUN_ID
if [ -f "\$BK" ]; then crontab "\$BK"; echo "cron 복원: \$(grep -vc '^#' \$BK || true)줄"; else echo "cron 백업 없음(C-1 이전 중단) — 변경 없음"; fi
for s in $DEV_SERVICES; do sudo systemctl start \$s; done
sudo bash /tmp/mb-maint/nginx-maint.sh off 2>/dev/null || sudo bash -c 'rm -f /etc/nginx/mindbreeze-maintenance.d/10-maintenance.conf /etc/nginx/conf.d/mindbreeze-maint-geo.conf && nginx -t && systemctl restart nginx'
sleep 3
for s in mindbreeze-backend $DEV_SERVICES nginx; do printf '%s=%s\n' \$s "\$(systemctl is-active \$s)"; done
curl -fsS --max-time 10 -k --resolve dev-api.mindbreeze.looxidlabs.com:443:127.0.0.1 https://dev-api.mindbreeze.looxidlabs.com/health >/dev/null && echo "dev 헬스 OK"
EOF
  if ! is_dry; then
    curl -fsS --max-time 15 https://dev-api.mindbreeze.looxidlabs.com/health >/dev/null && note "공개 dev-api 헬스 OK" || note "[경고] 공개 dev-api 헬스 확인 실패 — 수동 확인"
    state_set rolled_back "$(date -u +%FT%TZ)"
  fi
  note "롤백 완료. prod 리소스(RDS ${PROD_DB_ID}·스냅샷·S3·릴리스)는 보존. 재시도 시 새 RUN_ID 로 c02 부터(이미 $PROD_DB_ID 가 있으면 먼저 삭제방지 해제 후 삭제 — 별도 승인)"
  note "prod 는 점검 모드(prod_maintenance_on) 상태로 남아 있어도 무방(DNS 미연결/삭제됨). 공지 정정이 필요하면 docs/컷오버_공지문_초안.md §정정 참고"
}
run_step "RB" "롤백(구간 A/B 자동 판정)" "$@"
