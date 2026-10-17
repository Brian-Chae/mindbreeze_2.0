#!/usr/bin/env bash
# SDD-210 T-14: CloudWatch 에이전트 설치·구성 (서버 root, 멱등). 사용: bash cw-install.sh <cloudwatch-agent.json 경로>
set -euo pipefail
CFG="${1:?cloudwatch-agent.json}"
if ! dpkg -s amazon-cloudwatch-agent >/dev/null 2>&1; then
  curl -fsSL https://amazoncloudwatch-agent-ap-northeast-1.s3.ap-northeast-1.amazonaws.com/ubuntu/arm64/latest/amazon-cloudwatch-agent.deb -o /tmp/cwa.deb
  dpkg -i /tmp/cwa.deb >/dev/null; rm -f /tmp/cwa.deb
fi
install -d /opt/aws/amazon-cloudwatch-agent/etc
# cwagent 사용자가 로그를 읽도록(nginx 로그는 adm 그룹, syslog 도 adm)
usermod -aG adm cwagent 2>/dev/null || true
/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -c "file:$CFG" -s >/dev/null
systemctl is-active amazon-cloudwatch-agent
