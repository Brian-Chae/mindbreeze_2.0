#!/usr/bin/env bash
# SDD-210 T-3: 주기 작업 실패 알림. 사용: notify-job-failure.sh <job-name>
# journald 에 err 로 기록하고, ALERT_SNS_TOPIC_ARN 이 설정돼 있으면 SNS 로 발행한다(실패해도 무시).
set -u
JOB="${1:-unknown}"
MSG="[MIND BREEZE] 주기 작업 실패: ${JOB} ($(hostname), $(date -u +%FT%TZ)) — journalctl -u mindbreeze-job@${JOB} 확인"
logger -p user.err -t mindbreeze-job-failed "$MSG"
if [ -n "${ALERT_SNS_TOPIC_ARN:-}" ] && command -v aws >/dev/null 2>&1; then
  aws sns publish --topic-arn "$ALERT_SNS_TOPIC_ARN" --subject "MIND BREEZE job failed: ${JOB}" --message "$MSG" >/dev/null 2>&1 || true
fi
exit 0
