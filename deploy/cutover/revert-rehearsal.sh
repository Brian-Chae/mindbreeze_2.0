#!/usr/bin/env bash
# 리허설용 임시 설정 되돌리기 (rehearsal-result.md §2·§7 #6)
#  1) GitHub 저장소 변수 PROD_WEB_HOST / PROD_API_HOST 삭제 → deploy-prod 기본값(mindbreeze.looxidlabs.com / api.…) 사용
#  2) SSM CORS_ALLOWED_ORIGINS 에서 리허설 임시 오리진(https://prod-check.mindbreeze.looxidlabs.com 등) 제거
#  3) prod.env 재렌더(엄격) → backend 재시작(CORS 반영) → env 에 임시 오리진 0건 확인
# 실행 시점: **C-8 스모크 통과 후(C-9 내부)**. C-5 의 deploy-prod 스모크가 임시 호스트로 검증하므로 그 전에 돌리면 배포 스모크가 DNS 전환 전 공개 주소를 요구해 실패한다.
# 멱등(이미 되돌려졌으면 '변경 없음'). 사용: bash revert-rehearsal.sh [--dry-run]
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

step_main() {
  local v
  for v in PROD_WEB_HOST PROD_API_HOST; do
    if is_dry; then
      x "저장소 변수 $v 삭제(있을 때만)" gh variable delete "$v" --repo "$GH_REPO"
    elif gh variable get "$v" --repo "$GH_REPO" >/dev/null 2>&1; then
      gh variable delete "$v" --repo "$GH_REPO"; note "삭제: $v"
    else note "$v 이미 없음"; fi
  done
  local o
  for o in "https://$TEMP_WEB_HOST" "https://$TEMP_API_HOST"; do
    x "SSM CORS_ALLOWED_ORIGINS 에서 임시 오리진 제거: $o (없으면 변경 없음)" awsx ssm-remove-cors-origin "$o"
  done
  remote_prod "prod.env 재렌더(엄격) → backend 재시작 → CORS 에 임시 오리진 0건 확인" 300 <<EOF
python3 /opt/mindbreeze/current/deploy/render_env.py --ssm-path /mindbreeze/prod/ --out $PROD_ENV_FILE --region $MB_REGION >/dev/null
chmod 600 $PROD_ENV_FILE
systemctl restart mindbreeze-backend
for i in \$(seq 1 30); do curl -fsS http://127.0.0.1:8000/health/ready >/dev/null 2>&1 && break; sleep 2; done
curl -fsS http://127.0.0.1:8000/health/ready >/dev/null
n=\$(grep -E '^CORS_ALLOWED_ORIGINS=' $PROD_ENV_FILE | grep -c 'prod-check\|prod-api-check' || true)
echo "env 내 임시 오리진 줄: \$n"
[ "\$n" = 0 ]
EOF
  note "임시 DNS 레코드 prod-check / prod-api-check 는 유지(롤백·점검용). 정리는 T-22 에서 판단."
}
run_step "REV" "리허설 임시 설정 원복(저장소 변수·CORS 오리진)" "$@"
