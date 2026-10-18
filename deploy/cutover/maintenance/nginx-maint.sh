#!/usr/bin/env bash
# SDD-210 점검 페이지 — nginx 503 정적 HTML + 관리자 IP 우회. 서버에서 root 로 실행(dev·prod 공용). 멱등.
#
#   nginx-maint.sh on     --admin-ips 1.2.3.4,5.6.7.8 [--site /etc/nginx/sites-enabled/mindbreeze-ssl] [--assets DIR]
#   nginx-maint.sh moved  --admin-ips … --new-url https://mindbreeze.looxidlabs.com [--site …] [--assets DIR]   # 컷오버 후 dev: "새 주소" 안내
#   nginx-maint.sh off    [--site …]          # 점검 해제(점검 설정·페이지 제거). dev 사이트의 include 줄은 남긴다(무해)
#   nginx-maint.sh status
#
# 동작:
#  · server{} 블록(listen 443)에 `include /etc/nginx/mindbreeze-maintenance.d/*.conf;` 가 없으면 한 번 삽입(백업 후 nginx -t, 실패 시 복원).
#    prod 템플릿(deploy/templates/nginx/mindbreeze.conf.tpl)은 이미 포함하고 있다.
#  · http 컨텍스트: /etc/nginx/conf.d/mindbreeze-maint-geo.conf 의 geo 변수 $mb_maint_bypass (관리자 IP=1, 그 외=0)
#  · server 컨텍스트: /etc/nginx/mindbreeze-maintenance.d/10-maintenance.conf — bypass=0 이면 503 + @mb_maint(정적 HTML, Retry-After)
#  · 적용은 `nginx -t` 통과 후 **restart**(reload 는 기존 WebSocket·장기 연결을 유지하므로 쓰기 차단 보장을 위해 재시작).
# 관리자 IP 없이 실행하면 전원 차단(안전한 기본값).
set -euo pipefail
[ "$(id -u)" = "0" ] || { echo "root 로 실행하세요" >&2; exit 2; }

MODE="${1:?on|moved|off|status}"; shift || true
ADMIN_IPS=""; SITE="/etc/nginx/sites-enabled/mindbreeze-ssl"; NEW_URL="https://mindbreeze.looxidlabs.com"
ASSETS="$(cd "$(dirname "$0")" && pwd)"
while [ $# -gt 0 ]; do
  case "$1" in
    --admin-ips) ADMIN_IPS="$2"; shift 2 ;;
    --site) SITE="$2"; shift 2 ;;
    --new-url) NEW_URL="$2"; shift 2 ;;
    --assets) ASSETS="$2"; shift 2 ;;
    *) echo "알 수 없는 옵션: $1" >&2; exit 2 ;;
  esac
done

DROPIN_DIR=/etc/nginx/mindbreeze-maintenance.d
GEO=/etc/nginx/conf.d/mindbreeze-maint-geo.conf
WEBROOT=/var/www/mindbreeze-maintenance
INCLUDE_LINE='include /etc/nginx/mindbreeze-maintenance.d/*.conf;'
STAMP="$(date +%Y%m%d%H%M%S)"; BK=/var/backups/mindbreeze-maint-$STAMP

nginx_apply() { # nginx -t 통과 시에만 재시작. 실패하면 호출자가 복원한다.
  nginx -t >/dev/null 2>&1 || { nginx -t 2>&1 | tail -5 >&2; return 1; }
  systemctl restart nginx
}

ensure_include() {
  [ -f "$SITE" ] || { echo "사이트 설정 없음: $SITE" >&2; exit 3; }
  if grep -qF "$INCLUDE_LINE" "$SITE"; then echo "include 이미 있음"; return 0; fi
  mkdir -p "$BK"; cp -a "$SITE" "$BK/site.conf"
  python3 - "$SITE" "$INCLUDE_LINE" <<'PY'
import re, sys
path, inc = sys.argv[1], sys.argv[2]
src = open(path, encoding="utf-8").read()
n_ins = 0
# 최상위 server { … } 블록을 중괄호 깊이로 찾아, listen 443 이 있는 블록의 server_name 줄 뒤에 include 삽입
def blocks(s):
    pos = 0
    while True:
        m = re.compile(r"(?m)^[ \t]*server\s*\{").search(s, pos)
        if not m: break
        depth, j = 0, m.end() - 1
        while j < len(s):
            if s[j] == "{": depth += 1
            elif s[j] == "}":
                depth -= 1
                if depth == 0: break
            j += 1
        yield m.start(), j + 1
        pos = j + 1
res, last = [], 0
for a, b in blocks(src):
    blk = src[a:b]
    res.append(src[last:a]); last = b
    if re.search(r"listen\s+[^;]*443", blk) and "mindbreeze-maintenance.d" not in blk:
        blk, k = re.subn(r"(?m)^([ \t]*)(server_name[^;]*;)", lambda mm: mm.group(1) + mm.group(2) + "\n" + mm.group(1) + inc, blk, count=1)
        n_ins += k
    res.append(blk)
res.append(src[last:])
if n_ins == 0:
    sys.exit("server_name 이 있는 443 server 블록을 찾지 못함")
open(path, "w", encoding="utf-8").write("".join(res))
print(f"include 삽입: {n_ins}개 블록")
PY
  mkdir -p "$DROPIN_DIR"
  if ! nginx_apply; then cp -a "$BK/site.conf" "$SITE"; echo "nginx -t 실패 → 사이트 설정 복원" >&2; exit 4; fi
}

write_geo() {
  { echo "# SDD-210 점검 모드 관리자 우회 IP (자동 생성)"; echo "geo \$mb_maint_bypass {"; echo "    default 0;"
    local ip; IFS=',' read -r -a arr <<< "$ADMIN_IPS"
    for ip in ${arr[@]+"${arr[@]}"}; do ip="$(echo "$ip" | tr -d ' ')"; [ -n "$ip" ] && echo "    $ip 1;"; done
    echo "}"; } > "$GEO"
}

case "$MODE" in
  on|moved)
    ensure_include
    page=index.html; [ "$MODE" = "moved" ] && page=moved.html
    [ -f "$ASSETS/$page" ] || { echo "점검 페이지 없음: $ASSETS/$page" >&2; exit 3; }
    mkdir -p "$WEBROOT" "$DROPIN_DIR" "$BK"
    [ -f "$GEO" ] && cp -a "$GEO" "$BK/geo.conf" || true
    [ -f "$DROPIN_DIR/10-maintenance.conf" ] && cp -a "$DROPIN_DIR/10-maintenance.conf" "$BK/10-maintenance.conf" || true
    sed "s#@@NEW_URL@@#$NEW_URL#g" "$ASSETS/$page" > "$WEBROOT/index.html"
    chmod 644 "$WEBROOT/index.html"
    write_geo
    cat > "$DROPIN_DIR/10-maintenance.conf" <<EOF
# SDD-210 점검 모드 (nginx-maint.sh $MODE) — 관리자 IP 가 아니면 503
if (\$mb_maint_bypass = 0) { return 503; }
error_page 503 @mb_maint;
location @mb_maint {
    root $WEBROOT;
    rewrite ^ /index.html break;
    add_header Retry-After 3600 always;
    add_header Cache-Control "no-store" always;
}
EOF
    if ! nginx_apply; then
      rm -f "$DROPIN_DIR/10-maintenance.conf" "$GEO"
      [ -f "$BK/geo.conf" ] && cp -a "$BK/geo.conf" "$GEO"
      [ -f "$BK/10-maintenance.conf" ] && cp -a "$BK/10-maintenance.conf" "$DROPIN_DIR/10-maintenance.conf"
      nginx_apply || true
      echo "점검 모드 적용 실패 → 이전 상태로 복원" >&2; exit 4
    fi
    echo "점검 모드 on ($MODE) — 관리자 우회 IP: ${ADMIN_IPS:-없음(전원 차단)}"
    ;;
  off)
    rm -f "$DROPIN_DIR/10-maintenance.conf" "$GEO"
    nginx_apply || { echo "nginx -t 실패 — 수동 확인 필요" >&2; exit 4; }
    echo "점검 모드 off"
    ;;
  status)
    if [ -f "$DROPIN_DIR/10-maintenance.conf" ]; then echo "maintenance=on"; else echo "maintenance=off"; fi
    grep -cF "$INCLUDE_LINE" "$SITE" 2>/dev/null | sed 's/^/include_lines=/' || true
    ;;
  *) echo "usage: $0 on|moved|off|status" >&2; exit 2 ;;
esac
