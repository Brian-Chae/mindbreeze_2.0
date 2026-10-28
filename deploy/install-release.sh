#!/usr/bin/env bash
# SDD-210 T-5: 서버측 릴리스 설치·롤백 (SSM Run Command 로 root 실행).
#
#   install-release.sh install  --release-id ID --dir DIR [--allow-destructive]
#   install-release.sh rollback [--to ID]
#   install-release.sh status
#
# install: DIR(= /opt/mindbreeze/incoming/ID, tar.gz·.sha256 가 이미 내려받아져 있음) 의 체크섬 검증 → 릴리스 디렉터리 전개
#   → venv(requirements 해시별 재사용) → alembic upgrade head → current/venv 링크 **원자 전환** → 앱 유닛·timer 동기화
#   → 서비스 재시작 → /health/ready 확인. 어느 단계든 실패하면 전환 이전은 아무것도 바꾸지 않고, 전환 이후는 직전 릴리스로 자동 복귀.
# rollback: previous(또는 --to) 릴리스로 링크·유닛·timer 를 되돌리고 재시작·헬스 확인. **DB 는 자동으로 되돌리지 않는다**(expand 전용 원칙).
#
# 레이아웃: $MB_PREFIX/{releases/<ID>/{dist,backend,deploy,MANIFEST.json}, venvs/<해시>, current, previous, venv, incoming, state}
# 종료 코드: 0 성공 / 10 체크섬 불일치 / 11 파괴적 마이그레이션 미승인 / 12 다른 배포 진행 중 / 13 산출물 형식 오류
#            20 마이그레이션 실패(전환 전, 변경 없음) / 30 헬스 실패(자동 복귀 수행) / 31 복귀도 실패(수동 개입 필요) / 2 사용법
# 테스트 훅(운영에서는 설정하지 않음): MB_PREFIX MB_ETC MB_SYSTEMCTL MB_HEALTH_CMD MB_MIGRATE_CMD MB_VENV_CREATE_CMD MB_HEALTH_TIMEOUT
set -euo pipefail

PREFIX="${MB_PREFIX:-/opt/mindbreeze}"
ETC="${MB_ETC:-/etc}"
SERVICE_USER="${MB_SERVICE_USER:-mindbreeze}"
ENV_FILE="${MB_ENV_FILE:-/etc/mindbreeze/prod.env}"
SYSTEMCTL="${MB_SYSTEMCTL:-systemctl}"
HEALTH_URL="${MB_HEALTH_URL:-http://127.0.0.1:8000/health/ready}"
HEALTH_TIMEOUT="${MB_HEALTH_TIMEOUT:-90}"
KEEP_RELEASES="${MB_KEEP_RELEASES:-5}"
SERVICES=(mindbreeze-backend mindbreeze-stt-worker mindbreeze-report-worker mindbreeze-worker mindbreeze-email-worker mindbreeze-export-worker)

log() { echo "[install-release] $*"; }
die() { local code="$1"; shift; echo "[install-release] 오류: $*" >&2; exit "$code"; }

atomic_link() { # <target> <linkpath> — 심볼릭 링크를 원자적으로 교체
  local target="$1" link="$2" tmp
  tmp="${link}.new.$$"
  ln -sfn "$target" "$tmp"
  mv -Tf "$tmp" "$link" 2>/dev/null || mv -fh "$tmp" "$link"
}

link_target() { [ -L "$1" ] && readlink "$1" || true; }

health_ok() {
  if [ -n "${MB_HEALTH_CMD:-}" ]; then bash -c "$MB_HEALTH_CMD" >/dev/null 2>&1; else curl -fsS --max-time 5 "$HEALTH_URL" >/dev/null 2>&1; fi
}

wait_healthy() {
  local waited=0
  while [ "$waited" -lt "$HEALTH_TIMEOUT" ]; do
    if health_ok; then log "헬스 OK (${waited}s)"; return 0; fi
    sleep 3; waited=$((waited + 3))
  done
  return 1
}

restart_services() {
  "$SYSTEMCTL" daemon-reload
  for s in "${SERVICES[@]}"; do "$SYSTEMCTL" restart "$s" || return 1; done
}

manifest_get() { # <manifest.json> <key>
  python3 -c 'import json,sys; v=json.load(open(sys.argv[1]))[sys.argv[2]]; print(json.dumps(v) if isinstance(v,(list,dict)) else v)' "$1" "$2"
}

# render.py --only app 결과로 앱 유닛·job timer 를 동기화한다. 현재 timer 가 활성이면 새 timer 도 활성, 비활성(컷오버 전)이면 설치만.
sync_units() { # <release_dir>
  local rel="$1" tmp changed=0 timers_active=0 f dst
  tmp="$(mktemp -d)"
  python3 "$rel/deploy/render.py" --only app --out "$tmp" --set "PREFIX=$PREFIX" --set "SERVICE_USER=$SERVICE_USER" --set "ENV_FILE=$ENV_FILE" >/dev/null
  local active_list
  active_list="$("$SYSTEMCTL" list-units 'mindbreeze-job-*.timer' --state=active --no-legend 2>/dev/null || true)"
  case "$active_list" in *mindbreeze-job-*) timers_active=1 ;; esac
  # 렌더에 없는 옛 timer·드롭인 제거
  if [ -d "$ETC/systemd/system" ]; then
    for f in "$ETC"/systemd/system/mindbreeze-job-*.timer; do
      [ -e "$f" ] || continue
      [ -e "$tmp/etc/systemd/system/$(basename "$f")" ] && continue
      log "폐기된 timer 제거: $(basename "$f")"
      "$SYSTEMCTL" disable --now "$(basename "$f")" 2>/dev/null || true
      rm -f "$f"; changed=1
    done
    for f in "$ETC"/systemd/system/mindbreeze-job@*.service.d; do
      [ -e "$f" ] || continue
      [ -e "$tmp/etc/systemd/system/$(basename "$f")" ] || { rm -rf "$f"; changed=1; }
    done
  fi
  while IFS= read -r f; do
    dst="$ETC/${f#$tmp/etc/}"
    mkdir -p "$(dirname "$dst")"
    if ! cmp -s "$f" "$dst" 2>/dev/null; then install -m 0644 "$f" "$dst"; changed=1; fi
  done < <(find "$tmp/etc" -type f | sort)
  rm -rf "$tmp"
  if [ "$changed" = "1" ]; then "$SYSTEMCTL" daemon-reload; fi
  if [ "$timers_active" = "1" ]; then
    for f in "$ETC"/systemd/system/mindbreeze-job-*.timer; do
      [ -e "$f" ] && "$SYSTEMCTL" enable --now "$(basename "$f")" >/dev/null 2>&1 || true
    done
  fi
}

switch_to() { # <release_id> — current·venv 링크 전환(원자), previous 갱신
  local rid="$1" old venv_hash
  venv_hash="$(cat "$PREFIX/releases/$rid/.venv-hash")"
  old="$(link_target "$PREFIX/current")"
  atomic_link "$PREFIX/venvs/$venv_hash" "$PREFIX/venv"
  atomic_link "$PREFIX/releases/$rid" "$PREFIX/current"
  if [ -n "$old" ] && [ "$old" != "$PREFIX/releases/$rid" ]; then atomic_link "$old" "$PREFIX/previous"; fi
}

ensure_data_dirs() {
  local base="${MB_DATA_DIR:-/var/lib/mindbreeze}"
  if [ "$(id -u)" = "0" ] && id "$SERVICE_USER" >/dev/null 2>&1; then
    install -d -m 0750 -o "$SERVICE_USER" -g "$SERVICE_USER" "$base" "$base/audio" "$base/video"
  else
    mkdir -p "$base/audio" "$base/video" 2>/dev/null || true
  fi
}

write_state() { # <event> <release_id> <previous_id>
  mkdir -p "$PREFIX/state"
  python3 - "$PREFIX/state/last_deploy.json" "$1" "$2" "$3" <<'PY'
import json, sys, datetime
path, event, rid, prev = sys.argv[1:5]
json.dump({"event": event, "release_id": rid, "previous": prev,
           "at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}, open(path, "w"), indent=2)
PY
}

prune() {
  local keep cur prev r n=0
  cur="$(basename "$(link_target "$PREFIX/current")" 2>/dev/null || true)"
  prev="$(basename "$(link_target "$PREFIX/previous")" 2>/dev/null || true)"
  # 최신순(디렉터리명이 시각순 ID)
  for r in $(ls -1 "$PREFIX/releases" 2>/dev/null | sort -r); do
    n=$((n + 1))
    if [ "$n" -le "$KEEP_RELEASES" ] || [ "$r" = "$cur" ] || [ "$r" = "$prev" ]; then continue; fi
    log "오래된 릴리스 삭제: $r"; rm -rf "$PREFIX/releases/$r" "$PREFIX/incoming/$r"
  done
  # 어떤 릴리스도 참조하지 않는 venv 삭제
  for r in "$PREFIX"/venvs/*; do
    [ -d "$r" ] || continue
    if ! grep -qsx "$(basename "$r")" "$PREFIX"/releases/*/.venv-hash 2>/dev/null; then log "미사용 venv 삭제: $(basename "$r")"; rm -rf "$r"; fi
  done
}

do_rollback_to() { # <release_id> <사유> — 링크·유닛·재시작·헬스 (DB 변경 없음)
  local rid="$1" why="$2" cur_id
  [ -d "$PREFIX/releases/$rid" ] || die 13 "롤백 대상 릴리스가 서버에 없음: $rid"
  [ -d "$PREFIX/venvs/$(cat "$PREFIX/releases/$rid/.venv-hash")" ] || die 13 "롤백 대상 venv 가 없음: $rid"
  cur_id="$(basename "$(link_target "$PREFIX/current")" 2>/dev/null || true)"
  log "롤백($why): ${cur_id:-없음} → $rid  (DB 는 되돌리지 않음)"
  switch_to "$rid"
  sync_units "$PREFIX/releases/$rid"
  restart_services || true
  if wait_healthy; then write_state "rollback" "$rid" "$cur_id"; return 0; fi
  return 1
}

cmd_install() {
  local rid="" dir="" allow_destructive=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --release-id) rid="$2"; shift 2 ;;
      --dir) dir="$2"; shift 2 ;;
      --allow-destructive) allow_destructive=1; shift ;;
      *) die 2 "알 수 없는 인자: $1" ;;
    esac
  done
  [[ "$rid" =~ ^[0-9]{8}-[0-9]{6}-[0-9a-f]{7}$ ]] || die 2 "release-id 형식 오류"
  [ -d "$dir" ] || die 2 "--dir 가 없음"
  local tgz="$dir/mindbreeze-$rid.tar.gz"
  [ -f "$tgz" ] && [ -f "$tgz.sha256" ] || die 13 "산출물/체크섬 파일 없음"

  mkdir -p "$PREFIX/releases" "$PREFIX/venvs" "$PREFIX/incoming" "$PREFIX/state"
  # 오디오·영상 청크 폴백 저장소 — 없으면 업로드가 PermissionError 500 이 된다(2026-10-28 운영 장애). 배포마다 멱등 보장.
  ensure_data_dirs
  if command -v flock >/dev/null 2>&1; then
    exec 9>"$PREFIX/state/deploy.lock"
    flock -n 9 || die 12 "다른 배포가 진행 중"
  fi

  # 1) 체크섬 — 불일치면 아무것도 전개하지 않는다 (V-3.6)
  local expected actual
  expected="$(cut -d' ' -f1 "$tgz.sha256")"
  actual="$( (sha256sum "$tgz" 2>/dev/null || shasum -a 256 "$tgz") | cut -d' ' -f1)"
  [ "$expected" = "$actual" ] || die 10 "체크섬 불일치 — 설치 중단"
  log "체크섬 OK"

  # 2) 전개 (이미 같은 ID 가 있으면 재사용: 동일 산출물이므로)
  local rel="$PREFIX/releases/$rid"
  if [ ! -d "$rel" ]; then
    local tmp="$PREFIX/releases/.tmp-$rid-$$"
    rm -rf "$tmp"; mkdir -p "$tmp"
    tar -xzf "$tgz" -C "$tmp"
    [ -f "$tmp/MANIFEST.json" ] && [ -d "$tmp/dist" ] && [ -d "$tmp/backend/app" ] || { rm -rf "$tmp"; die 13 "산출물 구조 오류"; }
    [ "$(manifest_get "$tmp/MANIFEST.json" release_id)" = "$rid" ] || { rm -rf "$tmp"; die 13 "MANIFEST release_id 불일치"; }
    mv "$tmp" "$rel"
  fi
  local manifest="$rel/MANIFEST.json"

  # 3) 파괴적 마이그레이션 확인 (V-3.8)
  if [ "$(manifest_get "$manifest" destructive_migrations)" = "True" ] && [ "$allow_destructive" != "1" ]; then
    die 11 "파괴적 마이그레이션 포함 — --allow-destructive(워크플로 confirm_destructive) 필요"
  fi

  # 4) venv — requirements 해시별 재사용, 전환 전에 완료
  local req_hash venv
  req_hash="$(manifest_get "$manifest" requirements_sha256)"
  venv="$PREFIX/venvs/$req_hash"
  echo "$req_hash" > "$rel/.venv-hash"
  if [ ! -f "$venv/.ok" ]; then
    log "venv 생성 ($req_hash)"
    rm -rf "$venv"
    if [ -n "${MB_VENV_CREATE_CMD:-}" ]; then MB_VENV="$venv" MB_REQ="$rel/backend/requirements.txt" bash -c "$MB_VENV_CREATE_CMD"
    else python3 -m venv "$venv" && "$venv/bin/pip" install -q --upgrade pip && "$venv/bin/pip" install -q -r "$rel/backend/requirements.txt"; fi
    touch "$venv/.ok"
  else
    log "venv 재사용 ($req_hash)"
  fi
  chown -R "$SERVICE_USER":"$SERVICE_USER" "$rel" 2>/dev/null || true

  # 5) 마이그레이션 (전환 전). 실패하면 링크·서비스는 그대로.
  log "alembic upgrade head"
  if [ -n "${MB_MIGRATE_CMD:-}" ]; then
    MB_RELEASE_DIR="$rel" MB_VENV="$venv" bash -c "$MB_MIGRATE_CMD" || die 20 "마이그레이션 실패 — 전환하지 않음(코드·서비스 변경 없음)"
  else
    systemd-run --quiet --wait --pipe --collect -p "User=$SERVICE_USER" -p "EnvironmentFile=$ENV_FILE" \
      -p "WorkingDirectory=$rel/backend" "$venv/bin/alembic" upgrade head || die 20 "마이그레이션 실패 — 전환하지 않음(코드·서비스 변경 없음)"
  fi

  # 6) 원자 전환 + 유닛 동기화 + 재시작 + 헬스, 실패 시 자동 복귀
  local prev_id
  prev_id="$(basename "$(link_target "$PREFIX/current")" 2>/dev/null || true)"
  switch_to "$rid"
  sync_units "$rel"
  restart_services || log "경고: 일부 서비스 재시작 실패"
  if wait_healthy; then
    write_state "install" "$rid" "$prev_id"
    prune
    log "RESULT=OK release=$rid previous=${prev_id:-none}"
    return 0
  fi
  log "헬스 실패 — 직전 릴리스로 자동 복귀"
  if [ -n "$prev_id" ] && do_rollback_to "$prev_id" "헬스 실패 자동 복귀"; then
    die 30 "새 릴리스 헬스 실패 → $prev_id 로 복귀 완료"
  fi
  die 31 "복귀 실패 또는 직전 릴리스 없음 — 수동 개입 필요"
}

cmd_rollback() {
  local to=""
  while [ $# -gt 0 ]; do
    case "$1" in --to) to="$2"; shift 2 ;; *) die 2 "알 수 없는 인자: $1" ;; esac
  done
  if command -v flock >/dev/null 2>&1; then
    mkdir -p "$PREFIX/state"; exec 9>"$PREFIX/state/deploy.lock"
    flock -n 9 || die 12 "다른 배포가 진행 중"
  fi
  if [ -z "$to" ]; then to="$(basename "$(link_target "$PREFIX/previous")" 2>/dev/null || true)"; fi
  [ -n "$to" ] || die 13 "직전 릴리스(previous)가 없음"
  [[ "$to" =~ ^[0-9]{8}-[0-9]{6}-[0-9a-f]{7}$ ]] || die 2 "릴리스 ID 형식 오류"
  if do_rollback_to "$to" "수동 롤백"; then log "RESULT=OK release=$to"; return 0; fi
  die 31 "롤백 후 헬스 실패 — 수동 개입 필요"
}

cmd_status() {
  echo "current=$(basename "$(link_target "$PREFIX/current")" 2>/dev/null || true)"
  echo "previous=$(basename "$(link_target "$PREFIX/previous")" 2>/dev/null || true)"
  echo "available=$(ls -1 "$PREFIX/releases" 2>/dev/null | sort -r | tr '\n' ' ')"
  [ -f "$PREFIX/state/last_deploy.json" ] && cat "$PREFIX/state/last_deploy.json" || true
}

main() {
  local sub="${1:-}"; shift || true
  case "$sub" in
    install) cmd_install "$@" ;;
    rollback) cmd_rollback "$@" ;;
    status) cmd_status ;;
    *) die 2 "사용법: install-release.sh install|rollback|status ..." ;;
  esac
}
main "$@"
