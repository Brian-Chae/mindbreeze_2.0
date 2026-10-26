#!/usr/bin/env bash
# C-5 릴리스 확정 배포: deploy-prod 워크플로 실행 → GitHub 환경(production) 승인 대기 → 설치·헬스·스모크·관찰.
#  · 승인(Required reviewers)은 Brian 이 GitHub Actions 화면에서 이 시점에 직접 Approve 한다(컷오버 승인과 별개). 스크립트는 대기만 한다(프롬프트 없음, 최대 MB_APPROVAL_WAIT_MIN분).
#  · ENVIRONMENT=production · RETENTION_SWEEP_ENABLED=false · RESEARCH_EXPORT_ENABLED=false 는 prod.env(정적 값)로 보장됨 → 아래에서 재확인.
#  · 리허설 임시 설정(PROD_WEB_HOST/PROD_API_HOST 저장소 변수=prod-check 호스트, CORS 의 prod-check 오리진)은 **이 단계에서는 유지**한다:
#    deploy-prod 의 공개 스모크가 'DNS 전환 전' 임시 호스트로 검증되기 때문. 원복은 C-8 통과 후 revert-rehearsal.sh (C-9 에서 실행).
# 사용: bash c05-deploy.sh [--dry-run]
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

OBSERVE_MIN="${MB_OBSERVE_MIN:-2}"            # 점검창 절약: 기본 5분 → 2분 (이후 C-10 에서 30분 관찰)
APPROVAL_WAIT_MIN="${MB_APPROVAL_WAIT_MIN:-20}"

step_main() {
  need_env MB_RELEASE_ID
  local rid="$MB_RELEASE_ID"

  # 전제: 임시 호스트 변수가 설정돼 있어야 스모크가 DNS 전환 전에도 동작
  chk_temp_vars() {
    [ "$(gh variable get PROD_WEB_HOST --repo "$GH_REPO" 2>/dev/null)" = "$TEMP_WEB_HOST" ] && \
    [ "$(gh variable get PROD_API_HOST --repo "$GH_REPO" 2>/dev/null)" = "$TEMP_API_HOST" ]
  }
  pre "저장소 변수 PROD_WEB_HOST/PROD_API_HOST = 리허설 임시 호스트(스모크가 DNS 전환 전 검증하도록)" chk_temp_vars

  # 파괴적 마이그레이션 표시 여부는 MANIFEST 로 판정 (컷오버 DB 는 이미 head 이므로 실제 적용은 없음)
  local destructive="false"
  if ! is_dry; then
    destructive="$(aws s3 cp "s3://mindbreeze-prod-releases/releases/$rid/MANIFEST.json" - --only-show-errors | python3 -c 'import json,sys; print("true" if json.load(sys.stdin).get("destructive_migrations") else "false")')"
    note "MANIFEST destructive_migrations=$destructive (DB 는 이미 head 이므로 마이그레이션 적용 없음)"
  fi
  local started; started="$(date -u +%FT%TZ)"
  x "deploy-prod 워크플로 실행 (환경 승인 대기에 들어감)" gh workflow run deploy-prod.yml --repo "$GH_REPO" --ref "${MB_WORKFLOW_REF:-develop}" \
      -f "release_id=$rid" -f "reason=SDD-210 컷오버 C-5 ($RUN_ID)" -f "confirm_destructive=$destructive" -f "observe_minutes=$OBSERVE_MIN"
  if is_dry; then
    note "실행 ID 조회 → GitHub Actions 에서 production 환경 Approve 대기(최대 ${APPROVAL_WAIT_MIN}분) → 완료 폴링(gh run view) → conclusion=success 아니면 중단"
    remote_prod "배포 후 서버 상태 확인(current 릴리스·서비스 active·prod.env 정적 값)" <<EOF
bash /opt/mindbreeze/current/deploy/install-release.sh status
for s in mindbreeze-backend mindbreeze-stt-worker mindbreeze-report-worker mindbreeze-worker mindbreeze-email-worker mindbreeze-export-worker nginx redis-server livekit coturn; do printf '%s=%s\n' \$s "\$(systemctl is-active \$s)"; done
grep -E '^(ENVIRONMENT|RETENTION_SWEEP_ENABLED|RESEARCH_EXPORT_ENABLED|ENABLE_DEV_ROLE_SIMULATION)=' $PROD_ENV_FILE
curl -fsS http://127.0.0.1:8000/health/ready
EOF
    return 0
  fi

  # 실행 ID 찾기(디스패치 직후 생성)
  local run_id="" i
  for i in $(seq 1 30); do
    sleep 4
    run_id="$(gh run list --repo "$GH_REPO" --workflow deploy-prod.yml --event workflow_dispatch --limit 5 --json databaseId,createdAt --jq "[.[] | select(.createdAt >= \"$started\")] | sort_by(.createdAt) | last | .databaseId // empty")"
    [ -n "$run_id" ] && break
  done
  [ -n "$run_id" ] || die "deploy-prod 실행을 찾지 못함"
  state_set deploy_run_id "$run_id"
  say "▶ 승인 필요: https://github.com/$GH_REPO/actions/runs/$run_id  (production 환경 Review deployments → Approve)"
  # 완료 대기(승인 대기 포함)
  local deadline=$(( $(now_epoch) + (APPROVAL_WAIT_MIN + 15) * 60 )) st concl
  while [ "$(now_epoch)" -lt "$deadline" ]; do
    st="$(gh run view "$run_id" --repo "$GH_REPO" --json status --jq .status)"
    [ "$st" = "completed" ] && break
    sleep 10
  done
  concl="$(gh run view "$run_id" --repo "$GH_REPO" --json conclusion --jq .conclusion)"
  [ "$concl" = "success" ] || die "deploy-prod 결과=$concl (run $run_id) — 서버는 install-release 가 자동 복귀했을 수 있음. 로그 확인 후 롤백 판단"
  note "deploy-prod 성공 (run $run_id)"

  remote_prod "배포 후 서버 상태 확인" <<EOF | tee "$RUN_DIR/C5-server-status.txt" >&2
bash /opt/mindbreeze/current/deploy/install-release.sh status
for s in mindbreeze-backend mindbreeze-stt-worker mindbreeze-report-worker mindbreeze-worker mindbreeze-email-worker mindbreeze-export-worker nginx redis-server livekit coturn; do printf '%s=%s\n' \$s "\$(systemctl is-active \$s)"; done
grep -E '^(ENVIRONMENT|RETENTION_SWEEP_ENABLED|RESEARCH_EXPORT_ENABLED|ENABLE_DEV_ROLE_SIMULATION)=' $PROD_ENV_FILE
curl -fsS http://127.0.0.1:8000/health/ready
EOF
  grep -q "^current=.*$rid" "$RUN_DIR/C5-server-status.txt" || die "current 릴리스가 $rid 가 아님"
  ! grep -E '^mindbreeze-.*=(inactive|failed)|^nginx=(inactive|failed)' "$RUN_DIR/C5-server-status.txt" || die "비활성 서비스 있음"
  grep -q '^ENVIRONMENT="production"' "$RUN_DIR/C5-server-status.txt" || die "ENVIRONMENT != production"
  grep -q '^RETENTION_SWEEP_ENABLED="false"' "$RUN_DIR/C5-server-status.txt" && grep -q '^RESEARCH_EXPORT_ENABLED="false"' "$RUN_DIR/C5-server-status.txt" || die "보관/연구 내보내기 플래그가 false 가 아님"
}
run_step "C-5" "prod 릴리스 확정 배포(deploy-prod, Brian 환경 승인)" "$@"
