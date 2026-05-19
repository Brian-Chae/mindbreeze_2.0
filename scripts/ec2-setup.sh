#!/bin/bash
# ──────────────────────────────────────────────
# MIND BREEZE 2.0 — EC2 초기 세팅 (dev 서버)
# 실행: ssh -i key.pem ubuntu@<EC2_IP> 'bash -s' < scripts/ec2-setup.sh
# ──────────────────────────────────────────────
set -e

echo "🚀 MIND BREEZE 2.0 — EC2 Dev 서버 초기 세팅"

# 1. 시스템 업데이트 + 필수 패키지
sudo apt-get update -y
sudo apt-get upgrade -y
sudo apt-get install -y ca-certificates curl gnupg lsb-release unzip git

# 2. Docker 설치
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update -y
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker ubuntu
echo "✅ Docker 설치 완료"

# 3. 프로젝트 디렉토리
mkdir -p /home/ubuntu/mindbreeze/{frontend/dist,docker/nginx}
echo "✅ 디렉토리 생성 완료"

# 4. GitHub Actions 용 deploy 키 안내
echo ""
echo "📌 다음 단계:"
echo "  1. GitHub Secrets 등록:"
echo "     - EC2_DEV_HOST: <이 EC2의 퍼블릭 IP 또는 DNS>"
echo "     - EC2_SSH_KEY:  SSH 개인키 전체 내용"
echo "  2. Route 53 DNS 레코드 추가:"
echo "     - dev.mindbreeze.looxidlabs.com     → 이 EC2 IP"
echo "     - dev-api.mindbreeze.looxidlabs.com → 이 EC2 IP"
echo "  3. Security Group 인바운드 규칙: 80, 443 (SSH는 IP 제한)"
echo ""
echo "🎉 EC2 세팅 완료!"
