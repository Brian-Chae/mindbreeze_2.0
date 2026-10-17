#!/usr/bin/env bash
# ssm-run.sh '<셸 명령>'  — prod 인스턴스에서 AWS-RunShellScript 로 읽기/시험 명령 실행 후 결과 출력(비밀 출력 금지).
source "$(dirname "$0")/common.sh"; IID="$(load instance_id)"
CID="$(aws ssm send-command --instance-ids "$IID" --document-name AWS-RunShellScript --parameters "$(python3 -c 'import json,sys;print(json.dumps({"commands":[sys.argv[1]]}))' "$1")" --timeout-seconds 600 --query Command.CommandId --output text)"
for _ in $(seq 1 90); do
  S="$(aws ssm get-command-invocation --command-id "$CID" --instance-id "$IID" --query Status --output text 2>/dev/null || echo Pending)"
  case "$S" in Success|Failed|Cancelled|TimedOut) break;; esac; sleep 4
done
aws ssm get-command-invocation --command-id "$CID" --instance-id "$IID" --query '[Status,StandardOutputContent,StandardErrorContent]' --output text
