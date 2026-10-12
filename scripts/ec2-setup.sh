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
mkdir -p /home/ubuntu/mindbreeze/{frontend/dist,docker/nginx,backend}
echo "✅ 디렉토리 생성 완료"

# 4. INFRA-10: 백엔드 venv · 환경파일(.env.dev) 준비
#    — 첫 배포 전에도 venv 골격과 .env.dev 자리표시자를 만들어 두면
#      deploy-dev.yml 이 즉시 pip install/서비스 기동으로 이어질 수 있다.
sudo apt-get install -y python3-venv python3-pip
if [ ! -x /home/ubuntu/mindbreeze/backend/venv/bin/python ]; then
  python3 -m venv /home/ubuntu/mindbreeze/backend/venv
  /home/ubuntu/mindbreeze/backend/venv/bin/pip install --upgrade pip
  echo "✅ 백엔드 venv 생성 완료"
fi
if [ ! -f /home/ubuntu/mindbreeze/backend/.env.dev ]; then
  # 배포 전 실제 값(DATABASE_URL/REDIS_URL/JWT_SECRET_KEY 등)을 반드시 채워야 한다.
  echo "# MIND BREEZE 2.0 dev 환경변수(.env.dev) — 배포 전 실제 값을 채우세요." \
    > /home/ubuntu/mindbreeze/backend/.env.dev
  chmod 600 /home/ubuntu/mindbreeze/backend/.env.dev
  echo "⚠️  .env.dev 자리표시자 생성 — 배포 전 값을 채워야 합니다."
fi
# 첫 배포로 requirements.txt 가 이미 반영돼 있으면 의존성을 선반영한다(있을 때만).
if [ -f /home/ubuntu/mindbreeze/backend/requirements.txt ]; then
  /home/ubuntu/mindbreeze/backend/venv/bin/pip install -q -r /home/ubuntu/mindbreeze/backend/requirements.txt
fi

# 5. INFRA-10: systemd 유닛 설치 (backend/deploy/*.service 가 존재할 때)
#    — 첫 배포 전에는 유닛 파일이 없으므로, 첫 배포 후 이 스크립트를 재실행하면 설치된다.
if [ -d /home/ubuntu/mindbreeze/backend/deploy ]; then
  for unit in mindbreeze-worker mindbreeze-email-worker mindbreeze-export-worker; do
    src="/home/ubuntu/mindbreeze/backend/deploy/${unit}.service"
    if [ -f "$src" ]; then
      sudo cp "$src" "/etc/systemd/system/${unit}.service"
      sudo systemctl enable "$unit" 2>/dev/null || true
    fi
  done
  sudo systemctl daemon-reload
  echo "✅ systemd 유닛 설치 완료"
else
  echo "ℹ️  backend/deploy 유닛 파일이 아직 없습니다 — 첫 배포 후 이 스크립트를 재실행하세요."
fi

# 6. GitHub Actions 용 deploy 키 안내
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
