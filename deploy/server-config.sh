#!/usr/bin/env bash
# SDD-210 T-14: 운영 EC2 서버 구성 1회 적용 (서버에서 root 로 실행 — SSM Run Command). 멱등.
# 사용: sudo bash server-config.sh <WEB_HOST> <API_HOST> <PUBLIC_IP>
#   릴리스 산출물의 deploy/ 디렉터리에서 실행한다(템플릿·render.py·apply-config.sh 가 같은 위치에 있어야 함).
#   컷오버 전 리허설은 임시 호스트(prod-check / prod-api-check)로, 컷오버 때 운영 호스트로 같은 스크립트를 다시 실행한다.
# 하는 일: 패키지(coturn)·livekit 바이너리·서비스 계정 → SSM 에서 시크릿 읽어 템플릿 렌더(값 출력 금지) → 인증서(certbot DNS-01)
#   → apply-config.sh → prod.env 렌더 → 주기 작업 timer 설치 후 전부 비활성 → nginx/livekit/coturn/redis 기동 → logrotate·journald 상한.
# 하지 않는 일: 앱 릴리스 설치(= deploy-prod 의 install-release.sh), timer 활성화(컷오버 jobs-ctl.sh enable).
set -euo pipefail
set +x
WEB_HOST="${1:?WEB_HOST}"; API_HOST="${2:?API_HOST}"; PUBLIC_IP="${3:?PUBLIC_IP}"
HERE="$(cd "$(dirname "$0")" && pwd)"
REGION="${AWS_DEFAULT_REGION:-ap-northeast-1}"; export AWS_DEFAULT_REGION="$REGION"
LIVEKIT_VERSION="${LIVEKIT_VERSION:-1.13.10}"   # dev 서버와 동일 버전(2026-10-22 1.8.0→1.13.10: livekit-client 2.19 와 협상 실패 해소)
SSM_PREFIX="/mindbreeze/prod"
[ "$(id -u)" = "0" ] || { echo "root 로 실행하세요" >&2; exit 2; }
log() { echo "[server-config] $*"; }

# ── 1. 패키지·계정·livekit ───────────────────────────────────────────
export DEBIAN_FRONTEND=noninteractive
dpkg -s coturn >/dev/null 2>&1 || { apt-get update -y -qq; apt-get install -y -qq coturn; }
id mindbreeze >/dev/null 2>&1 || useradd --system --create-home --home-dir /home/mindbreeze --shell /usr/sbin/nologin mindbreeze
install -d -o mindbreeze -g mindbreeze /opt/mindbreeze /opt/mindbreeze/releases /opt/mindbreeze/venvs /opt/mindbreeze/incoming /opt/mindbreeze/state
install -d -m 0750 -o root -g mindbreeze /etc/mindbreeze
if ! /usr/local/bin/livekit-server --version 2>/dev/null | grep -q "$LIVEKIT_VERSION"; then
  log "livekit-server $LIVEKIT_VERSION 설치(arm64)"
  tmp="$(mktemp -d)"
  curl -fsSL "https://github.com/livekit/livekit/releases/download/v${LIVEKIT_VERSION}/livekit_${LIVEKIT_VERSION}_linux_arm64.tar.gz" -o "$tmp/lk.tgz"
  tar -xzf "$tmp/lk.tgz" -C "$tmp" livekit-server
  install -m 0755 "$tmp/livekit-server" /usr/local/bin/livekit-server; rm -rf "$tmp"
fi

# ── 2. 렌더 (시크릿은 환경변수로만 전달, 값 출력 없음) ──────────────────
ssm_get() { aws ssm get-parameter --name "$SSM_PREFIX/$1" --with-decryption --query Parameter.Value --output text; }
TOKEN="$(curl -fsS -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60')"
PRIVATE_IP="$(curl -fsS -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/local-ipv4)"
OUT="$(mktemp -d)"; chmod 700 "$OUT"; trap 'rm -rf "$OUT"' EXIT
MB_RENDER_LIVEKIT_API_KEY="$(ssm_get LIVEKIT_API_KEY)" MB_RENDER_LIVEKIT_API_SECRET="$(ssm_get LIVEKIT_API_SECRET)" \
MB_RENDER_TURN_STATIC_AUTH_SECRET="$(ssm_get TURN_STATIC_AUTH_SECRET)" \
  python3 "$HERE/render.py" --out "$OUT" --set "WEB_HOST=$WEB_HOST" --set "API_HOST=$API_HOST" \
    --set "PUBLIC_IP=$PUBLIC_IP" --set "PRIVATE_IP=$PRIVATE_IP" --set "CERT_NAME=$WEB_HOST" >/dev/null
log "템플릿 렌더 완료"

# ── 3. 인증서 (DNS-01, 인스턴스 역할의 Route53 TXT 권한) ───────────────
if [ ! -s "/etc/letsencrypt/live/$WEB_HOST/fullchain.pem" ]; then
  log "인증서 발급: $WEB_HOST, $API_HOST"
  certbot certonly --dns-route53 --non-interactive --agree-tos -m developer@looxidlabs.com \
    --cert-name "$WEB_HOST" -d "$WEB_HOST" -d "$API_HOST" >/dev/null
fi

# ── 4. 설치 (timer 는 설치만) ───────────────────────────────────────
systemctl enable --now redis-server
bash "$HERE/apply-config.sh" "$OUT"
python3 "$HERE/render_env.py" --ssm-path "$SSM_PREFIX/" --out /etc/mindbreeze/prod.env --region "$REGION" --allow-placeholders   # 외부 키 미채움은 경고(키 이름만) — 채운 뒤 재실행
# prod 는 컷오버 전까지 dev 와 같은 대기열·메일을 건드리면 안 된다 → timer 전부 비활성
bash "$HERE/jobs-ctl.sh" disable "$HERE/jobs.tsv" >/dev/null
systemctl enable --now nginx
systemctl restart nginx
systemctl enable --now livekit coturn

# ── 5. 로그 상한 ─────────────────────────────────────────────────────
cat > /etc/logrotate.d/mindbreeze <<'EOF'
/var/log/mindbreeze-*.log {
    daily
    rotate 14
    maxsize 50M
    compress
    delaycompress
    missingok
    notifempty
    copytruncate
}
EOF
install -d /etc/systemd/journald.conf.d
cat > /etc/systemd/journald.conf.d/mindbreeze.conf <<'EOF'
[Journal]
SystemMaxUse=1G
SystemKeepFree=2G
MaxRetentionSec=30day
EOF
systemctl restart systemd-journald
log "완료"
