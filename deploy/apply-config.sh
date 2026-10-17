#!/usr/bin/env bash
# SDD-210 T-3: render.py 결과 트리를 서버 루트에 설치한다 (서버에서 root 로 실행, T-14 에서 사용).
# 사용: sudo bash apply-config.sh <렌더 출력 디렉터리>
# - timer 는 설치만 하고 활성화하지 않는다(컷오버 전까지 비활성 — R9). 활성화는 jobs-ctl.sh enable.
# - nginx 는 `nginx -t` 통과 시에만 reload 한다. 실패하면 이전 파일을 복원한다.
set -euo pipefail
SRC="${1:?렌더 출력 디렉터리}"
[ "$(id -u)" = "0" ] || { echo "root 로 실행하세요" >&2; exit 2; }
[ -d "$SRC/etc" ] || { echo "렌더 결과(etc/)가 없음: $SRC" >&2; exit 2; }
STAMP="$(date +%Y%m%d%H%M%S)"
BK="/var/backups/mindbreeze-config-$STAMP"
mkdir -p "$BK"

backup_install() { # 상대경로 모드 소유자:그룹
  local rel="$1" mode="$2" owner="$3"
  local dst="/$rel"
  if [ -e "$dst" ]; then mkdir -p "$BK/$(dirname "$rel")"; cp -a "$dst" "$BK/$rel"; fi
  install -D -m "$mode" -o "${owner%%:*}" -g "${owner##*:}" "$SRC/$rel" "$dst"
}

# 시크릿 포함 설정
getent group livekit >/dev/null 2>&1 || groupadd --system livekit
backup_install etc/livekit/livekit.yaml 0600 root:root
getent group turnserver >/dev/null 2>&1 && TURN_GRP=turnserver || TURN_GRP=root
backup_install etc/turnserver.conf 0640 root:"$TURN_GRP"

# nginx
backup_install etc/nginx/sites-available/mindbreeze.conf 0644 root:root
ln -sfn /etc/nginx/sites-available/mindbreeze.conf /etc/nginx/sites-enabled/mindbreeze.conf
mkdir -p /etc/nginx/mindbreeze-maintenance.d /var/www/certbot
if ! nginx -t 2>/dev/null; then
  echo "nginx -t 실패 — 이전 설정 복원" >&2
  [ -e "$BK/etc/nginx/sites-available/mindbreeze.conf" ] && cp -a "$BK/etc/nginx/sites-available/mindbreeze.conf" /etc/nginx/sites-available/mindbreeze.conf \
    || rm -f /etc/nginx/sites-enabled/mindbreeze.conf
  exit 3
fi

# systemd 유닛·timer·drop-in
( cd "$SRC" && find etc/systemd/system -type f ) | while read -r rel; do backup_install "$rel" 0644 root:root; done
systemctl daemon-reload

# 상시 서비스는 enable 만(기동은 릴리스 설치 단계). timer 는 enable 하지 않는다.
for svc in mindbreeze-backend mindbreeze-worker mindbreeze-email-worker mindbreeze-export-worker livekit coturn; do
  systemctl enable "$svc" 2>/dev/null || true
done
systemctl restart livekit coturn || true
systemctl reload nginx || true
echo "설치 완료 (백업: $BK). timer 는 비활성 상태 — 컷오버 시 jobs-ctl.sh enable"
