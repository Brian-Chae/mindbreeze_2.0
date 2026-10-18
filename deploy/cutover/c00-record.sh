#!/usr/bin/env bash
# C-0 사전 기록·전제 검증 (T-5분 전후, 점검 시작 전). 사용자 영향 없음(읽기 전용).
#  · 정본: specs/sdd-210-prod-environment/plan.md §6 C-0 + rehearsal-result.md §7(남은 차단 요소)
#  · 기록: dev alembic/행 수/precheck 집계/알림 대기열을 $RUN_DIR 에 보존(전후 비교 기준)
#  · 중단 조건: 외부 키 미채움·진행 중 세션·6자리 코드 비종료 세션·릴리스 후보 부재·prod DB 이미 존재 등
# 사용: bash c00-record.sh [--dry-run]
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

step_main() {
  # 확인 의사 표시(프롬프트 없이 환경변수로 명시 — 사람이 사전에 완료한 항목)
  need_env MB_ADMIN_IPS MB_RELEASE_ID MB_ACK_RESEARCH_KEY_BACKUP MB_ACK_PRIVACY_POLICY MB_ACK_NOTICE_D1
  note "MB_ADMIN_IPS=점검 중 우회할 관리자 공인 IP(쉼표) / MB_RELEASE_ID=release-build 산출물 ID(예: 20261021-120000-abcdef0)"
  note "MB_ACK_*=1 은 '연구 가명 키 오프라인 백업 완료 · 개인정보처리방침 게시 확인 · D-1 공지 발송 완료' 선언(rehearsal-result §7 #2,#3,#4)"
  if ! is_dry; then
    [ "$MB_ACK_RESEARCH_KEY_BACKUP" = "1" ] && [ "$MB_ACK_PRIVACY_POLICY" = "1" ] && [ "$MB_ACK_NOTICE_D1" = "1" ] || die "MB_ACK_* 가 1 이 아님"
    [[ "$MB_RELEASE_ID" =~ ^[0-9]{8}-[0-9]{6}-[0-9a-f]{7}$ ]] || die "MB_RELEASE_ID 형식 오류"
    state_set release_id "$MB_RELEASE_ID"; state_set admin_ips "$MB_ADMIN_IPS"
  fi
  pre "AWS 계정 187768779388" guard_account

  # ── 전제: 환경 ──
  pre "SSM 필수 키 전부 채움(GOOGLE_CLIENT_ID·RESEND·GEMINI 등 자리표시 0건, 키 이름만 출력)" \
      awsx ssm-check-required "$REPO_ROOT/deploy/env-manifest.tsv"
  chk_ssm_online() { [ "$(aws ssm describe-instance-information --filters "Key=InstanceIds,Values=$PROD_IID" --query 'InstanceInformationList[0].PingStatus' --output text)" = Online ]; }
  chk_no_prod_rds() { ! aws rds describe-db-instances --db-instance-identifier "$PROD_DB_ID" >/dev/null 2>&1; }
  chk_no_public_dns() { [ -z "$(aws route53 list-resource-record-sets --hosted-zone-id "$ZONE_ID" --query "ResourceRecordSets[?Type=='A' && (Name=='$WEB_HOST.' || Name=='$API_HOST.')].Name" --output text)" ]; }
  chk_dev_rds_available() { [ "$(aws rds describe-db-instances --db-instance-identifier "$DEV_DB_ID" --query 'DBInstances[0].DBInstanceStatus' --output text)" = available ]; }
  pre "prod EC2 SSM Online" chk_ssm_online
  pre "릴리스 후보 산출물 존재($MB_RELEASE_ID)" aws s3 ls "s3://mindbreeze-prod-releases/releases/$MB_RELEASE_ID/MANIFEST.json"
  pre "prod RDS $PROD_DB_ID 아직 없음(복원이 새로 생성)" chk_no_prod_rds
  pre "운영 도메인 A 레코드 아직 없음($WEB_HOST, $API_HOST)" chk_no_public_dns
  pre "dev RDS available" chk_dev_rds_available
  pre "gh 인증·저장소 접근" gh api "repos/$GH_REPO" --jq .full_name
  pre "로컬 도구(ssh·scp·curl·python3·gh·shasum)" bash -c 'for c in ssh scp curl python3 gh shasum; do command -v $c >/dev/null || exit 1; done'
  pre "dev SSH 접속" ssh "${SSH_OPTS[@]}" "$DEV_USER@$DEV_HOST" true

  # ── 기록: dev 상태 ──
  dev_put "$REPO_ROOT/deploy/precheck/cutover-precheck.sql" "$REPO_ROOT/deploy/precheck/run-precheck.sh" /tmp/
  remote_dev "C-0 precheck 집계(읽기 전용) 실행" <<EOF > "$RUN_DIR/C0-precheck.txt"
set -euo pipefail
mkdir -p /tmp/mb-precheck && mv -f /tmp/cutover-precheck.sql /tmp/run-precheck.sh /tmp/mb-precheck/
bash /tmp/mb-precheck/run-precheck.sh $DEV_ENV_FILE
EOF
  pg_dev "alembic 현재 리비전" "SELECT version_num FROM alembic_version" --readonly > "$RUN_DIR/C0-alembic.txt"
  pg_dev "테이블별 정확 행 수" "" --counts > "$RUN_DIR/C0-counts.tsv"
  local inprog legacy pending
  inprog="$(pg_dev "진행 중(in_progress) 세션 수" "SELECT count(*) FROM sessions WHERE status='in_progress'" --readonly)"
  legacy="$(pg_dev "6자리 코드 비종료 세션 수(ready/scheduled/open/in_progress)" "SELECT count(*) FROM sessions WHERE length(access_code)=6 AND status NOT IN ('completed','cancelled') AND is_template=false" --readonly)"
  pending="$(pg_dev "알림 outbox 미발송(pending/failed) 수" "SELECT count(*) FROM notification_outbox WHERE status IN ('pending','failed')" --readonly)"
  if is_dry; then
    note "게이트: in_progress=0, 6자리 코드 비종료 세션=0 (그렇지 않으면 중단). outbox 미발송 수는 기록만."
  else
    printf 'in_progress=%s legacy6_active=%s outbox_pending=%s\n' "$inprog" "$legacy" "$pending" | tee "$RUN_DIR/C0-gates.txt" >&2
    [ "$inprog" = "0" ] || die "진행 중 세션 ${inprog}건 — 종료 후 재실행(점검 진입 불가)"
    [ "$legacy" = "0" ] || die "6자리 코드 비종료 세션 ${legacy}건 — deploy/cutover/ops/cancel-legacy-sessions.sh 절차로 상담사 안내 후 취소하고 재실행"
  fi
  note "기록 파일: $RUN_DIR/C0-{precheck.txt,alembic.txt,counts.tsv,gates.txt}"
}
run_step "C-0" "사전 기록·전제 검증" "$@"
