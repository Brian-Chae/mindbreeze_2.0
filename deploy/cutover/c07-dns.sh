#!/usr/bin/env bash
# C-7 DNS 전환 (되돌릴 수 있는 마지막 지점): Route53 에 운영 A 레코드 신규 추가(TTL 60) → 전파·HTTPS 확인.
#  · 기존 레코드는 건드리지 않는다: CREATE 만 사용(이미 있으면 실패 = 안전), 전후 존 전체 비교로 '추가 2건 외 변경 0' 증명.
#  · 시간 가드: T+${DNS_DEADLINE_MIN}분을 넘기면 이 단계를 시작하지 않는다(점검창 한도 ${MAINT_LIMIT_MIN}분 내 스모크·해제 시간 확보) → 롤백 판단.
#  · 레코드: mindbreeze.looxidlabs.com / api.mindbreeze.looxidlabs.com  A → prod EIP
# 사용: bash c07-dns.sh [--dry-run]     (MB_ALLOW_OVERRUN=1 로 시간 가드 무시 — 반드시 Brian 판단)
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

dump_zone() { aws route53 list-resource-record-sets --hosted-zone-id "$ZONE_ID" --output json | python3 -c '
import json, sys
for r in sorted(json.load(sys.stdin)["ResourceRecordSets"], key=lambda r: (r["Name"], r["Type"])):
    print(json.dumps(r, sort_keys=True))'; }

step_main() {
  guard_prod_account
  if ! is_dry; then
    local el; el="$(elapsed_min)"
    if [ "$el" -ge "$DNS_DEADLINE_MIN" ] && [ "${MB_ALLOW_OVERRUN:-0}" != "1" ]; then
      die "T+${el}분 ≥ ${DNS_DEADLINE_MIN}분 — DNS 전환 시작 불가(점검창 ${MAINT_LIMIT_MIN}분). rollback.sh 로 dev 복귀 판단"
    fi
  else
    note "시간 가드: T+${DNS_DEADLINE_MIN}분 이상이면 중단(MB_ALLOW_OVERRUN=1 로만 우회)"
  fi

  # DNS 를 바꾸기 전에 prod 가 운영 호스트명·인증서로 정상인지 확인 (--resolve 로 DNS 우회)
  chk_pre_dns() {
    curl -fsS --max-time 15 --resolve "$API_HOST:443:$PROD_EIP" "https://$API_HOST/health/ready" >/dev/null && \
    curl -fsS --max-time 15 -o /dev/null --resolve "$WEB_HOST:443:$PROD_EIP" "https://$WEB_HOST/"
  }
  pre "DNS 전환 전 prod 직접 확인(--resolve 로 EIP 지정): https://$API_HOST/health/ready · https://$WEB_HOST/ (인증서 유효 포함)" chk_pre_dns

  local batch; batch="$(python3 - "$WEB_HOST" "$API_HOST" "$PROD_EIP" <<'PY'
import json, sys
web, api, ip = sys.argv[1:4]
print(json.dumps({"Comment": "SDD-210 C-7 cutover: public prod records", "Changes": [
  {"Action": "CREATE", "ResourceRecordSet": {"Name": h + ".", "Type": "A", "TTL": 60, "ResourceRecords": [{"Value": ip}]}} for h in (web, api)]}))
PY
)"
  if is_dry; then
    note "전후 존 전체 덤프 비교(추가 2건, 변경/삭제 0건이어야 함)"
    x "Route53 변경(CREATE ×2, TTL 60)" aws route53 change-resource-record-sets --hosted-zone-id "$ZONE_ID" --change-batch "$batch"
    x "전파 대기(INSYNC)" aws route53 wait resource-record-sets-changed --id "<change-id>"
    x "공개 DNS 확인" dig +short "$WEB_HOST" @8.8.8.8
    x "공개 DNS 확인" dig +short "$API_HOST" @8.8.8.8
    x "HTTPS 헬스(DNS 경유)" curl -fsS "https://$API_HOST/health/ready"
    return 0
  fi
  dump_zone > "$RUN_DIR/C7-zone-before.jsonl"
  local cid; cid="$(aws route53 change-resource-record-sets --hosted-zone-id "$ZONE_ID" --change-batch "$batch" --query ChangeInfo.Id --output text)"
  state_set dns_switched "$(date -u +%FT%TZ)"; state_set dns_change_id "$cid"
  aws route53 wait resource-record-sets-changed --id "$cid"
  dump_zone > "$RUN_DIR/C7-zone-after.jsonl"
  python3 - "$RUN_DIR/C7-zone-before.jsonl" "$RUN_DIR/C7-zone-after.jsonl" <<'PY' || die "존 변경 검증 실패(추가 2건 외 변경 존재)"
import sys
b, a = set(open(sys.argv[1])), set(open(sys.argv[2]))
print(f"removed/changed: {len(b - a)}  added: {len(a - b)}")
sys.exit(0 if len(b - a) == 0 and len(a - b) == 2 else 1)
PY
  local h i ok
  for h in "$WEB_HOST" "$API_HOST"; do
    ok=0
    for i in $(seq 1 30); do
      [ "$(dig +short "$h" @8.8.8.8 | head -1)" = "$PROD_EIP" ] && { ok=1; break; }; sleep 4
    done
    [ "$ok" = 1 ] || die "공개 DNS 에서 $h 가 $PROD_EIP 로 해석되지 않음(2분 대기)"
  done
  local j; ok=0
  for j in $(seq 1 20); do curl -fsS --max-time 10 "https://$API_HOST/health/ready" >/dev/null 2>&1 && { ok=1; break; }; sleep 3; done
  [ "$ok" = 1 ] || die "DNS 경유 HTTPS 헬스 실패"
  note "DNS 전환 완료: $WEB_HOST, $API_HOST → $PROD_EIP (TTL 60)"
}
run_step "C-7" "DNS 전환(Route53 신규 A 레코드 TTL 60)" "$@"
