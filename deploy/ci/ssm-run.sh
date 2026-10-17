#!/usr/bin/env bash
# SDD-210 T-5: SSM Run Command 로 스크립트를 실행하고 완료까지 기다린다 (OIDC 자격으로 aws CLI 사용).
# 사용: ssm-run.sh <instance-id> <timeout-sec> <script-file>
# 종료 코드: 원격 스크립트의 ResponseCode(0이면 성공). 호출 실패·시간 초과 등은 1.
# 원격 stdout/stderr 는 그대로 출력한다(스크립트가 값/시크릿을 출력하지 않아야 한다 — install-release.sh 는 출력하지 않음).
set -euo pipefail
IID="${1:?instance-id}"; TIMEOUT="${2:?timeout}"; SCRIPT="${3:?script-file}"
AWS="${MB_AWS:-aws}"
[[ "$IID" =~ ^i-[0-9a-f]{8,17}$ ]] || { echo "instance-id 형식 오류" >&2; exit 1; }
[[ "$TIMEOUT" =~ ^[0-9]+$ ]] || { echo "timeout 형식 오류" >&2; exit 1; }
PARAMS="$(python3 -c 'import json,sys; print(json.dumps({"commands": open(sys.argv[1]).read().splitlines(), "executionTimeout": [sys.argv[2]]}))' "$SCRIPT" "$TIMEOUT")"
CID="$($AWS ssm send-command --instance-ids "$IID" --document-name AWS-RunShellScript \
  --comment "mindbreeze deploy ${GITHUB_RUN_ID:-manual}" --timeout-seconds 60 --parameters "$PARAMS" \
  --query 'Command.CommandId' --output text)"
echo "SSM CommandId: $CID"
DEADLINE=$(( $(date +%s) + TIMEOUT + 60 ))
STATUS=""
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  sleep 5
  STATUS="$($AWS ssm get-command-invocation --command-id "$CID" --instance-id "$IID" --query 'Status' --output text 2>/dev/null || echo Pending)"
  case "$STATUS" in Success|Failed|TimedOut|Cancelled|Cancelling) break ;; esac
done
INV="$($AWS ssm get-command-invocation --command-id "$CID" --instance-id "$IID" --output json)"
python3 - "$INV" <<'PY'
import json, sys
d = json.loads(sys.argv[1])
print("--- stdout ---"); print(d.get("StandardOutputContent", "").rstrip())
err = d.get("StandardErrorContent", "").rstrip()
if err:
    print("--- stderr ---"); print(err)
print(f"SSM_STATUS={d.get('Status')} RESPONSE_CODE={d.get('ResponseCode')}")
PY
CODE="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1]).get("ResponseCode", 1))' "$INV")"
if [ "$STATUS" = "Success" ]; then exit 0; fi
if [[ "$CODE" =~ ^[0-9]+$ ]] && [ "$CODE" -gt 0 ] && [ "$CODE" -lt 256 ]; then exit "$CODE"; fi
exit 1
