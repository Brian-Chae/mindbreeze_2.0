#!/usr/bin/env bash
# T-13: CloudWatch 경보 · 로그 그룹. 기존 SNS mindbreeze-alerts 재사용(dev 와 공용 토픽).
#  · CWAgent 지표(메모리·디스크) 경보는 만들어 두되 에이전트 설치(Phase C T-14, deploy/aws/cloudwatch-agent.json)까지는 INSUFFICIENT_DATA.
#  · RDS 경보는 리허설 인스턴스(mindbreeze-prod-empty)와 컷오버 후 인스턴스(mindbreeze-prod) 둘 다 선생성.
#  · 업타임(/health/ready) 감시는 서비스 기동(T-15) 이후 생성 — 지금 만들면 상시 오경보.
source "$(dirname "$0")/common.sh"; guard_account
IID="$(load instance_id)"; [[ -n "$IID" ]] || { echo "T-10 선행 필요" >&2; exit 1; }
SNS="arn:aws:sns:$MB_REGION:$MB_ACCOUNT:mindbreeze-alerts"
aws sns get-topic-attributes --topic-arn "$SNS" --query Attributes.TopicArn --output text >/dev/null
TAGS=(--tags Key=project,Value=mindbreeze Key=env,Value=prod)

alarm() { # name metric namespace stat comparison threshold periods dimensions(json-ish k=v ...) [extra args...]
  local name="$1" metric="$2" ns="$3" stat="$4" cmp="$5" thr="$6" per="$7" dims="$8"; shift 8
  aws cloudwatch put-metric-alarm --alarm-name "$name" --metric-name "$metric" --namespace "$ns" --statistic "$stat" \
    --comparison-operator "$cmp" --threshold "$thr" --evaluation-periods "$per" --datapoints-to-alarm "$per" --period 300 \
    --dimensions $dims --treat-missing-data "${TMD:-missing}" --alarm-actions "$SNS" --ok-actions "$SNS" "${TAGS[@]}" "$@"
  log "경보: $name"
}
# EC2
EC2D="Name=InstanceId,Value=$IID"
TMD=breaching alarm mb-prod-ec2-status-instance StatusCheckFailed_Instance AWS/EC2 Maximum GreaterThanOrEqualToThreshold 1 2 "$EC2D"
TMD=breaching alarm mb-prod-ec2-status-system   StatusCheckFailed_System   AWS/EC2 Maximum GreaterThanOrEqualToThreshold 1 2 "$EC2D" \
  --alarm-actions "$SNS" "arn:aws:automate:$MB_REGION:ec2:recover"
alarm mb-prod-ec2-cpu-high CPUUtilization AWS/EC2 Average GreaterThanThreshold 80 3 "$EC2D"
alarm mb-prod-ec2-mem-high mem_used_percent  CWAgent Average GreaterThanThreshold 85 2 "$EC2D"
alarm mb-prod-ec2-disk-high used_percent     CWAgent Average GreaterThanThreshold 80 1 "$EC2D Name=path,Value=/ Name=fstype,Value=ext4"
# RDS (리허설 + 컷오버 후 인스턴스)
for DB in mindbreeze-prod-empty mindbreeze-prod; do
  D="Name=DBInstanceIdentifier,Value=$DB"
  alarm "mb-prod-rds-$DB-cpu"         CPUUtilization       AWS/RDS Average GreaterThanThreshold 80 3 "$D"
  alarm "mb-prod-rds-$DB-storage"     FreeStorageSpace     AWS/RDS Minimum LessThanThreshold 4294967296 1 "$D"      # 20GB 의 20%
  alarm "mb-prod-rds-$DB-connections" DatabaseConnections  AWS/RDS Maximum GreaterThanThreshold 80 2 "$D"
  alarm "mb-prod-rds-$DB-freemem"     FreeableMemory       AWS/RDS Average LessThanThreshold 209715200 3 "$D"       # 200MB
done
# 로그 그룹 (보관 기간 설정)
for G in /mindbreeze/prod/app /mindbreeze/prod/nginx /mindbreeze/prod/system; do
  if ! aws logs describe-log-groups --log-group-name-prefix "$G" --query "logGroups[?logGroupName=='$G'].logGroupName" --output text | grep -q .; then
    aws logs create-log-group --log-group-name "$G" --tags project=mindbreeze,env=prod
  fi
  aws logs put-retention-policy --log-group-name "$G" --retention-in-days 90
done
log "T-13 완료"
