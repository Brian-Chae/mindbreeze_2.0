#!/usr/bin/env bash
# SDD-306 3단계 전용 — dev 서버에 100명 대응 구성을 적용/롤백한다. (감독의 "코드 배포 완료" 신호 후에만 실행. 운영(prod) 금지.)
# 사용: sudo bash scale-100-apply.sh apply  [REST_PORTS=8001,8002,8003,8004]
#       sudo bash scale-100-apply.sh rollback
# 적용 전 /etc/nginx 와 서비스 파일을 /home/ubuntu/backup-1105/ 에 백업한다. 시크릿은 다루지 않는다.
set -euo pipefail
BK=/home/ubuntu/backup-1105
SRC="${MB_RELEASE_DIR:-/home/ubuntu/mindbreeze_2.0}"   # dev 체크아웃(릴리스 디렉터리)
REST_PORTS="${REST_PORTS:-8001,8002,8003,8004}"
WEB_HOST="${WEB_HOST:?WEB_HOST 필요}"; API_HOST="${API_HOST:?API_HOST 필요}"
MODE="${1:-}"
log() { echo "[scale-100] $*"; }

backup() {
  mkdir -p "$BK/nginx" "$BK/systemd"
  cp -a /etc/nginx/. "$BK/nginx/"
  cp -a /etc/systemd/system/mindbreeze-backend*.service "$BK/systemd/" 2>/dev/null || true
  [ -d /etc/systemd/system/mindbreeze-backend.service.d ] && cp -a /etc/systemd/system/mindbreeze-backend.service.d "$BK/systemd/" || true
  log "백업 완료: $BK"
}

apply() {
  [ -d "$BK/nginx" ] || backup
  # nginx.conf 메인 컨텍스트: 동시 연결·파일 한도 상향(사이트 템플릿 밖)
  grep -q 'worker_rlimit_nofile' /etc/nginx/nginx.conf || sed -i '1i worker_rlimit_nofile 65535;' /etc/nginx/nginx.conf
  sed -i -E 's/worker_connections[[:space:]]+[0-9]+;/worker_connections 4096;/' /etc/nginx/nginx.conf
  # 사이트 설정·REST 인스턴스 유닛은 render.py 로 만든다(dev 흔적 허용)
  TMP="$(mktemp -d)"
  python3 "$SRC/deploy/render.py" --out "$TMP" --allow-dev-markers --only app \
    --set "PREFIX=${PREFIX:-$SRC}" --set "SERVICE_USER=${SERVICE_USER:-ubuntu}" --set "ENV_FILE=${ENV_FILE:-$SRC/backend/.env.dev}" \
    --set "REST_PORTS=$REST_PORTS" >/dev/null
  log "렌더 완료 — 유닛 설치 후 nginx 사이트 설정은 서버의 기존 dev 설정에 mb_socket/mb_rest 블록을 반영해 별도 확인(기존 dev 설정은 템플릿 렌더물이 아님)"
  install -m 0644 "$TMP/etc/systemd/system/mindbreeze-backend-rest@.service" /etc/systemd/system/
  systemctl daemon-reload
  for port in ${REST_PORTS//,/ }; do systemctl enable --now "mindbreeze-backend-rest@$port"; done
  nginx -t
  systemctl reload nginx
  curl -fsS http://127.0.0.1:8000/health/ready >/dev/null && log "/health/ready 200"
}

rollback() {
  [ -d "$BK/nginx" ] || { echo "백업 없음: $BK" >&2; exit 1; }
  for u in $(systemctl list-units 'mindbreeze-backend-rest@*.service' --no-legend | awk '{print $1}'); do systemctl disable --now "$u" || true; done
  rm -f /etc/systemd/system/mindbreeze-backend-rest@.service
  cp -a "$BK/nginx/." /etc/nginx/
  [ -f "$BK/systemd/mindbreeze-backend.service" ] && cp -a "$BK/systemd/mindbreeze-backend.service" /etc/systemd/system/ || true
  systemctl daemon-reload
  nginx -t && systemctl reload nginx
  systemctl restart mindbreeze-backend
  log "롤백 완료"
}

case "$MODE" in
  apply) backup; apply ;;
  rollback) rollback ;;
  *) echo "사용: $0 apply|rollback" >&2; exit 2 ;;
esac
