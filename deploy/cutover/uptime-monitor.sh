#!/usr/bin/env bash
# SDD-210 업타임 감시 (V-1.32): 운영 도메인 /health/ready 를 Route53 health check 로 감시하고 CloudWatch 경보로 알린다.
#  · 실제 생성은 **DNS 전환 후(C-8 스모크 통과 뒤)** 에만 실행한다 — 서비스가 연결되기 전에 만들면 상시 오경보.
#  · Route53 health check 지표(AWS/Route53 HealthCheckStatus)는 us-east-1 에만 게시된다. CloudWatch 경보는 같은 리전의 SNS 만 호출할 수 있으므로
#    us-east-1 에 SNS 토픽 `mindbreeze-alerts-use1` 을 만들고, 기존 `mindbreeze-alerts`(ap-northeast-1)의 이메일 구독자를 같은 주소로 구독시킨다.
#    ※ 새 구독은 수신자가 확인 메일의 'Confirm subscription' 을 눌러야 활성화된다(사용자 작업).
#  · 대안(채택하지 않음): CloudWatch Synthetics canary(ap-northeast-1) — 아티팩트 버킷·IAM·런타임 코드가 필요해 단순성 우선으로 보류. 필요 시 별건.
#  · 태그 project=mindbreeze,env=prod. 1.0 리소스 무접촉.
#
#   uptime-monitor.sh create [--dry-run]   생성(멱등)
#   uptime-monitor.sh status               현재 상태 조회
#   uptime-monitor.sh test-alarm           경보 시험 발화(set-alarm-state → 실제 알림 발송됨. Brian 확인 후)
#   uptime-monitor.sh delete [--dry-run]   감시 제거(롤백 시)
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

CMD="${1:-create}"
TOPIC_NAME="mindbreeze-alerts-use1"
TOPIC_ARN="arn:aws:sns:us-east-1:$MB_ACCOUNT:$TOPIC_NAME"
CHECKS="api-ready:$API_HOST:/health/ready web-root:$WEB_HOST:/"   # <이름>:<FQDN>:<경로>

hc_id() { # 이름 → health check id (Name 태그로 조회)
  local id
  for id in $(aws route53 list-health-checks --query 'HealthChecks[].Id' --output text); do
    if [ "$(aws route53 list-tags-for-resource --resource-type healthcheck --resource-id "$id" --query "ResourceTagSet.Tags[?Key=='Name'].Value | [0]" --output text)" = "mb-prod-$1" ]; then echo "$id"; return 0; fi
  done
  return 0
}

do_create() {
  local spec name fqdn path id
  note "생성 대상: Route53 health check ×2 (HTTPS 443, 30초 간격, 연속 3회 실패=비정상) + us-east-1 SNS 토픽 + 경보 2개"
  x "us-east-1 SNS 토픽 생성(멱등)" env MB_REGION=us-east-1 bash -c "source '$AWS_DIR/common.sh'; aws sns create-topic --name $TOPIC_NAME --tags Key=project,Value=mindbreeze Key=env,Value=prod --query TopicArn --output text"
  if is_dry; then
    note "기존 토픽(mindbreeze-alerts)의 email 구독자 주소를 조회해 새 토픽에 동일 주소를 구독(주소 비출력, 수신자 확인 메일 클릭 필요)"
  else
    local ep
    for ep in $(aws sns list-subscriptions-by-topic --topic-arn "$SNS_ALERT_ARN" --query "Subscriptions[?Protocol=='email'].Endpoint" --output text); do
      MB_REGION=us-east-1 aws sns subscribe --topic-arn "$TOPIC_ARN" --protocol email --notification-endpoint "$ep" >/dev/null
    done
    note "SNS 이메일 구독 요청 발송 — 수신자가 확인 메일을 눌러야 알림이 도착함"
  fi
  for spec in $CHECKS; do
    name="${spec%%:*}"; fqdn="$(echo "$spec" | cut -d: -f2)"; path="$(echo "$spec" | cut -d: -f3-)"
    if is_dry; then
      x "Route53 health check mb-prod-$name: https://$fqdn$path" aws route53 create-health-check --caller-reference "mb-prod-$name-v1" \
        --health-check-config "Type=HTTPS,FullyQualifiedDomainName=$fqdn,ResourcePath=$path,Port=443,RequestInterval=30,FailureThreshold=3,EnableSNI=true"
      x "태그(Name/project/env)" aws route53 change-tags-for-resource --resource-type healthcheck --resource-id "<id>" --add-tags "Key=Name,Value=mb-prod-$name" Key=project,Value=mindbreeze Key=env,Value=prod
      x "경보 mb-prod-uptime-$name (HealthCheckStatus<1, 2분 연속, 데이터 없음=이상)" env MB_REGION=us-east-1 aws cloudwatch put-metric-alarm --alarm-name "mb-prod-uptime-$name" \
        --namespace AWS/Route53 --metric-name HealthCheckStatus --dimensions "Name=HealthCheckId,Value=<id>" --statistic Minimum --period 60 --evaluation-periods 2 \
        --datapoints-to-alarm 2 --threshold 1 --comparison-operator LessThanThreshold --treat-missing-data breaching --alarm-actions "$TOPIC_ARN" --ok-actions "$TOPIC_ARN" \
        --tags Key=project,Value=mindbreeze Key=env,Value=prod
      continue
    fi
    id="$(hc_id "$name")"
    if [ -z "$id" ]; then
      id="$(aws route53 create-health-check --caller-reference "mb-prod-$name-v1-$(date +%s)" \
        --health-check-config "Type=HTTPS,FullyQualifiedDomainName=$fqdn,ResourcePath=$path,Port=443,RequestInterval=30,FailureThreshold=3,EnableSNI=true" \
        --query HealthCheck.Id --output text)"
      aws route53 change-tags-for-resource --resource-type healthcheck --resource-id "$id" \
        --add-tags "Key=Name,Value=mb-prod-$name" Key=project,Value=mindbreeze Key=env,Value=prod >/dev/null
      log "health check 생성: mb-prod-$name"
    else log "health check 존재: mb-prod-$name (건너뜀)"; fi
    MB_REGION=us-east-1 aws cloudwatch put-metric-alarm --alarm-name "mb-prod-uptime-$name" --namespace AWS/Route53 --metric-name HealthCheckStatus \
      --dimensions "Name=HealthCheckId,Value=$id" --statistic Minimum --period 60 --evaluation-periods 2 --datapoints-to-alarm 2 --threshold 1 \
      --comparison-operator LessThanThreshold --treat-missing-data breaching --alarm-actions "$TOPIC_ARN" --ok-actions "$TOPIC_ARN" \
      --tags Key=project,Value=mindbreeze Key=env,Value=prod
    log "경보 설정: mb-prod-uptime-$name"
  done
}

case "$CMD" in
  create) guard_prod_account; do_create ;;
  status)
    guard_account
    for spec in $CHECKS; do name="${spec%%:*}"; id="$(hc_id "$name")"; echo "mb-prod-$name id=${id:-없음}"; done
    MB_REGION=us-east-1 aws cloudwatch describe-alarms --alarm-name-prefix mb-prod-uptime- --query 'MetricAlarms[].[AlarmName,StateValue]' --output text
    ;;
  test-alarm)
    guard_account
    MB_REGION=us-east-1 aws cloudwatch set-alarm-state --alarm-name mb-prod-uptime-api-ready --state-value ALARM --state-reason "SDD-210 시험 발화"
    echo "시험 발화 완료 — 구독 확인된 수신자에게 알림이 가야 함(곧 자동으로 OK 로 복귀)"
    ;;
  delete)
    guard_prod_account
    for spec in $CHECKS; do
      name="${spec%%:*}"
      x "경보 삭제 mb-prod-uptime-$name" env MB_REGION=us-east-1 bash -c "source '$AWS_DIR/common.sh'; aws cloudwatch delete-alarms --alarm-names mb-prod-uptime-$name"
      if ! is_dry; then id="$(hc_id "$name")"; [ -n "$id" ] && aws route53 delete-health-check --health-check-id "$id"; fi
    done
    ;;
  *) echo "usage: $0 create|status|test-alarm|delete [--dry-run]" >&2; exit 2 ;;
esac
