#!/usr/bin/env bash
# T-11: 임시 호스트명 2개에 대해 certbot DNS-01(Route53, 인스턴스 역할) 스테이징 dry-run — 인증서/설정 파일을 남기지 않음
D="$(dirname "$0")"
bash "$D/ssm-run.sh" 'export AWS_DEFAULT_REGION=ap-northeast-1; certbot certonly --dns-route53 --dry-run --non-interactive --agree-tos --register-unsafely-without-email --cert-name mb-prod-drycheck -d prod-check.mindbreeze.looxidlabs.com -d prod-api-check.mindbreeze.looxidlabs.com 2>&1 | tail -12; rm -rf /etc/letsencrypt/renewal/mb-prod-drycheck.conf /etc/letsencrypt/live/mb-prod-drycheck /etc/letsencrypt/archive/mb-prod-drycheck; echo getid=$(aws sts get-caller-identity --query Arn --output text 2>&1 | sed "s/:assumed-role\/\([^/]*\)\/.*/ role=\1/")'
