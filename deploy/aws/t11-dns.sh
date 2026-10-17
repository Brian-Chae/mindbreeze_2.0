#!/usr/bin/env bash
# T-11: 내부 확인용 임시 호스트명만 생성 (공개 운영 레코드 mindbreeze./api.mindbreeze. 는 T-20 컷오버에서 전환 — 여기서 만들지 않음).
#   prod-check.mindbreeze.looxidlabs.com / prod-api-check.mindbreeze.looxidlabs.com → prod EIP, TTL 60
# 기존 레코드는 변경하지 않는다: CREATE 만 사용(이미 있으면 건너뜀), 전후 전체 레코드 diff 로 '추가만' 검증.
source "$(dirname "$0")/common.sh"; guard_account
ZONE=Z061081436L4M61L2W9NR
EIP="$(load eip_ip)"; [[ -n "$EIP" ]] || { echo "T-10 선행 필요" >&2; exit 1; }
dump() { aws route53 list-resource-record-sets --hosted-zone-id $ZONE --output json | python3 -c '
import json,sys
for r in sorted(json.load(sys.stdin)["ResourceRecordSets"], key=lambda r:(r["Name"],r["Type"])):
    print(json.dumps(r, sort_keys=True))'; }
[[ -f "$MB_STATE_DIR/r53-before.jsonl" ]] || dump > "$MB_STATE_DIR/r53-before.jsonl"
# 공개 운영 레코드 부재 확인
for n in mindbreeze.looxidlabs.com. api.mindbreeze.looxidlabs.com.; do
  if grep -q "\"Name\": \"$n\", \"ResourceRecords\".*\"Type\": \"A\"\|\"Name\": \"$n\".*\"Type\": \"A\"" "$MB_STATE_DIR/r53-before.jsonl"; then echo "경고: $n A 레코드 이미 존재 — 건드리지 않음" >&2; fi
done
for H in prod-check prod-api-check; do
  FQDN="$H.mindbreeze.looxidlabs.com."
  if aws route53 list-resource-record-sets --hosted-zone-id $ZONE --start-record-name "$FQDN" --max-items 1 --query "ResourceRecordSets[?Name=='$FQDN'].Name" --output text | grep -q .; then
    log "존재: $FQDN (건너뜀)"; continue
  fi
  log "CREATE $FQDN → $EIP (TTL 60)"
  aws route53 change-resource-record-sets --hosted-zone-id $ZONE --change-batch "{\"Comment\":\"SDD-210 T-11 prod internal check host\",\"Changes\":[{\"Action\":\"CREATE\",\"ResourceRecordSet\":{\"Name\":\"$FQDN\",\"Type\":\"A\",\"TTL\":60,\"ResourceRecords\":[{\"Value\":\"$EIP\"}]}}]}" --query ChangeInfo.Status --output text
done
dump > "$MB_STATE_DIR/r53-after.jsonl"
echo "== 전후 diff (삭제/변경 0건이어야 함)"
python3 - "$MB_STATE_DIR" <<'PY'
import sys
d=sys.argv[1]; b=set(open(d+'/r53-before.jsonl')); a=set(open(d+'/r53-after.jsonl'))
print("removed/changed:", len(b-a)); print("added:", [l.split('"Name": "')[1].split('"')[0] for l in a-b])
PY
