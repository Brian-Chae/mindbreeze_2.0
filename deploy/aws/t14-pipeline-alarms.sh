#!/usr/bin/env bash
# SDD-212 T7: 종료 파이프라인 적체 경보 (CloudWatch → SNS mindbreeze-alerts). *** AWS 변경 — 승인 전 실행 금지 ***
#  · 실행 조건: Brian 의 명시 승인 + 환경 변수 MB_PIPELINE_ALARMS_APPROVED=yes
#  · 선행: 서버가 MindBreeze/Pipeline 지표를 게시해야 한다(PIPELINE_METRICS_CLOUDWATCH_ENABLED=true).
#    EC2 역할(mb-prod-ec2-role)의 cloudwatch:PutMetricData 허용 여부를 먼저 확인한다
#    (CloudWatchAgentServerPolicy 에 포함돼 있을 수 있음 — 부족하면 deploy/aws/pipeline-metrics-policy.json 을 인라인 정책으로 추가).
#  · 임계(D-4 추천안): 최장 대기 = 몰림 목표(45분)의 2/3 = 1800초, 줄별 대기 건수 20건.
#  · t13-monitoring.sh 와 분리해 두었다 — t13 재실행이 신규 경보를 만들지 않게 한다.
source "$(dirname "$0")/common.sh"; guard_account
[[ "${MB_PIPELINE_ALARMS_APPROVED:-}" == "yes" ]] || { echo "승인 전 실행 금지: MB_PIPELINE_ALARMS_APPROVED=yes 필요" >&2; exit 1; }
SNS="arn:aws:sns:$MB_REGION:$MB_ACCOUNT:mindbreeze-alerts"
aws sns get-topic-attributes --topic-arn "$SNS" --query Attributes.TopicArn --output text >/dev/null
TAGS=(--tags Key=project,Value=mindbreeze Key=env,Value=prod)
NS="MindBreeze/Pipeline"

alarm() { # name metric stat comparison threshold periods dimensions
  local name="$1" metric="$2" stat="$3" cmp="$4" thr="$5" per="$6" dims="${7:-}"
  aws cloudwatch put-metric-alarm --alarm-name "$name" --metric-name "$metric" --namespace "$NS" --statistic "$stat" \
    --comparison-operator "$cmp" --threshold "$thr" --evaluation-periods "$per" --datapoints-to-alarm "$per" --period 60 \
    ${dims:+--dimensions $dims} --treat-missing-data notBreaching --alarm-actions "$SNS" --ok-actions "$SNS" "${TAGS[@]}"
  log "경보: $name"
}
alarm mb-prod-pipeline-oldest-wait OldestWaitSeconds Maximum GreaterThanThreshold 1800 3
alarm mb-prod-pipeline-queue-stt    QueueLength Maximum GreaterThanThreshold 20 3 "Name=Queue,Value=stt"
alarm mb-prod-pipeline-queue-report QueueLength Maximum GreaterThanThreshold 20 3 "Name=Queue,Value=report"
log "T-14 완료"
