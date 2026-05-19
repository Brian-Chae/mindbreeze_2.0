#!/bin/bash
# ──────────────────────────────────────────────
# MIND BREEZE 2.0 — 수동 배포 스크립트 (CI 없이 로컬에서)
# 사용법: ./scripts/deploy-dev.sh <EC2_HOST>
# ──────────────────────────────────────────────
set -e

HOST=${1:?EC2 호스트 주소를 입력하세요 (예: ./scripts/deploy-dev.sh 3.35.xxx.xxx)}

echo "🔨 백엔드 Docker 빌드..."
docker build -t mindbreeze-dev-be -f docker/Dockerfile.backend backend/
docker save mindbreeze-dev-be | gzip > /tmp/be.tar.gz

echo "📦 프론트엔드 빌드..."
cd frontend
cp .env.dev .env
npm ci && npm run build
cd ..

echo "📤 EC2로 전송..."
scp -o StrictHostKeyChecking=no \
    /tmp/be.tar.gz \
    ubuntu@$HOST:/home/ubuntu/mindbreeze/

rsync -avz --delete \
    frontend/dist/ \
    ubuntu@$HOST:/home/ubuntu/mindbreeze/frontend/dist/

rsync -avz \
    docker/docker-compose.dev.yml \
    docker/nginx/ \
    backend/.env.dev \
    ubuntu@$HOST:/home/ubuntu/mindbreeze/

echo "🚀 서비스 재시작..."
ssh ubuntu@$HOST << 'ENDSSH'
cd /home/ubuntu/mindbreeze
docker load < be.tar.gz
docker compose -f docker/docker-compose.dev.yml up -d --build
docker image prune -f
echo "✅ 배포 완료!"
ENDSSH

rm /tmp/be.tar.gz
echo "🎉 완료!"
