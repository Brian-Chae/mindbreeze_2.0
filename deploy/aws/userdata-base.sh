#!/bin/bash
# T-10 기본 패키지만 설치 (서버 구성·서비스 기동은 Phase C). nginx 는 설치만 하고 비활성(기본 페이지 노출 방지).
set -eux
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y nginx redis-server certbot python3-certbot-dns-route53 python3-venv python3-pip build-essential libpq-dev \
  libcairo2 libpango-1.0-0 libpangocairo-1.0-0 libffi-dev fonts-noto-cjk unzip jq curl
systemctl disable --now nginx
# SSM agent: Ubuntu AMI 기본 snap 설치본 확인
snap list amazon-ssm-agent || snap install amazon-ssm-agent --classic
systemctl enable --now snap.amazon-ssm-agent.amazon-ssm-agent.service || true
snap install aws-cli --classic || true
echo base-ready > /var/tmp/mb-userdata-done
