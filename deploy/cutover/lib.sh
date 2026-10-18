#!/usr/bin/env bash
# SDD-210 컷오버 공통 라이브러리 — 각 단계 스크립트가 source 한다.
#  · 모든 실행 명령은 x/remote_*/pg_* 래퍼를 거친다 → --dry-run(MB_DRY_RUN=1)이면 AWS·SSH·SSM·gh 호출 없이 명령만 출력.
#  · 시크릿 값은 어떤 출력·파일·명령줄에도 싣지 않는다(DB 비밀번호는 SSM→boto3 직접).
#  · macOS 기본 bash 3.2 호환(mapfile·연관배열 미사용).
set -euo pipefail

CUT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$CUT_DIR/../.." && pwd)"
AWS_DIR="$CUT_DIR/../aws"

# ── 인자/모드 ──────────────────────────────────────────────
MB_DRY_RUN="${MB_DRY_RUN:-0}"
for _a in "$@"; do [ "$_a" = "--dry-run" ] && MB_DRY_RUN=1; done
export MB_DRY_RUN
is_dry() { [ "$MB_DRY_RUN" = "1" ]; }
# 관리자 우회 IP 목록: MB_ADMIN_IPS 가 없으면 deploy/cutover/admin-ips.txt(한 줄에 IP/CIDR 하나, # 주석)를 쉼표로 합쳐 사용.
if [ -z "${MB_ADMIN_IPS:-}" ] && [ -r "$CUT_DIR/admin-ips.txt" ]; then
  MB_ADMIN_IPS="$(sed -e 's/#.*//' -e 's/[[:space:]]//g' "$CUT_DIR/admin-ips.txt" | grep -v '^$' | paste -sd, - || true)"
  export MB_ADMIN_IPS
fi
if is_dry; then   # dry-run 표시용 기본값(실제 실행에서는 반드시 직접 지정)
  : "${MB_ADMIN_IPS:=<관리자IP>}" "${MB_RELEASE_ID:=<릴리스ID>}" "${MB_ACK_RESEARCH_KEY_BACKUP:=1}" "${MB_ACK_PRIVACY_POLICY:=1}" "${MB_ACK_NOTICE_D1:=1}"
  export MB_ADMIN_IPS MB_RELEASE_ID MB_ACK_RESEARCH_KEY_BACKUP MB_ACK_PRIVACY_POLICY MB_ACK_NOTICE_D1
fi

# ── 실행 기록 디렉터리(.run/<RUN_ID>) — dry-run 은 임시 디렉터리 ──
if is_dry; then
  RUN_ID="DRYRUN"
  RUN_DIR="${TMPDIR:-/tmp}/mb-cutover-dryrun"
  rm -rf "$RUN_DIR" 2>/dev/null || true
else
  if [ -z "${MB_RUN_ID:-}" ] && [ -r "$CUT_DIR/.run/current-id" ]; then MB_RUN_ID="$(cat "$CUT_DIR/.run/current-id")"; fi
  RUN_ID="${MB_RUN_ID:-$(date +%Y%m%d-%H%M)}"
  RUN_DIR="$CUT_DIR/.run/$RUN_ID"
fi
mkdir -p "$RUN_DIR"
export RUN_ID RUN_DIR MB_RUN_ID="$RUN_ID"
if ! is_dry; then mkdir -p "$CUT_DIR/.run"; printf '%s' "$RUN_ID" > "$CUT_DIR/.run/current-id"; fi

# AWS 래퍼(common.sh): MB_AWS_PY 가 있으면 `python -m awscli --profile looxid-las --region ap-northeast-1`
if [ -z "${MB_AWS_PY:-}" ]; then
  for _p in "$REPO_ROOT/backend/venv/bin/python" "/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/backend/venv/bin/python"; do
    [ -x "$_p" ] && { MB_AWS_PY="$_p"; break; }
  done
fi
export MB_AWS_PY="${MB_AWS_PY:-python3}"
export MB_STATE_DIR="$RUN_DIR"          # common.sh 의 save/load 가 실행 기록 디렉터리를 쓴다
# shellcheck source=../aws/common.sh
source "$AWS_DIR/common.sh"

# ── 환경 상수 (infra-result.md 정본값. 필요 시 환경변수로 덮어씀) ──
WEB_HOST="${MB_WEB_HOST:-mindbreeze.looxidlabs.com}"
API_HOST="${MB_API_HOST:-api.mindbreeze.looxidlabs.com}"
TEMP_WEB_HOST="prod-check.mindbreeze.looxidlabs.com"          # 리허설 임시 호스트(원복 대상)
TEMP_API_HOST="prod-api-check.mindbreeze.looxidlabs.com"
ZONE_ID="Z061081436L4M61L2W9NR"                                # looxidlabs.com
PROD_IID="${MB_PROD_INSTANCE_ID:-i-0487c67fb0db7dcba}"
PROD_EIP="${MB_PROD_EIP:-13.193.100.27}"
PROD_DB_ID="mindbreeze-prod"
PROD_EMPTY_DB_ID="mindbreeze-prod-empty"
RDS_SUBNET_GROUP="mb-prod-db-subnets"
RDS_PARAM_GROUP="mb-prod-pg16"
RDS_SG="${MB_RDS_SG:-sg-0bfde585138899b64}"                   # mb-prod-rds
RDS_CLASS="db.t4g.small"
KMS_ALIAS="alias/mindbreeze-prod"
DEV_DB_ID="mindbreeze-dev"
DEV_HOST="${MB_DEV_HOST:-18.183.86.88}"
DEV_USER="${MB_DEV_USER:-ubuntu}"
DEV_KEY="${MB_DEV_SSH_KEY:-$HOME/.ssh/mindbreeze/mindbreeze-dev-key.pem}"
DEV_BASE="/home/ubuntu/mindbreeze"
DEV_ENV_FILE="$DEV_BASE/backend/.env.dev"
DEV_PY="$DEV_BASE/backend/venv/bin/python"
DEV_SERVICES="mindbreeze-worker mindbreeze-email-worker mindbreeze-export-worker"   # 점검 중 중지(backend·nginx 는 점검 페이지/롤백용으로 유지)
PROD_ENV_FILE="/etc/mindbreeze/prod.env"
PROD_PY="/opt/mindbreeze/venv/bin/python"
GH_REPO="Brian-Chae/mindbreeze_2.0"
MAINT_START_HHMM="02:00"; MAINT_END_HHMM="03:00"; MAINT_DATE="2026-10-22"
MAINT_LIMIT_MIN="${MB_MAINT_LIMIT_MIN:-60}"                    # 점검창 한도(분). 초과 + DNS 전환 전 = 중단·롤백 판단
DNS_DEADLINE_MIN="${MB_DNS_DEADLINE_MIN:-48}"                  # 이 시각(T+분) 이후에는 DNS 전환 단계를 시작하지 않는다
SNS_ALERT_ARN="arn:aws:sns:ap-northeast-1:187768779388:mindbreeze-alerts"

# ── 출력 ───────────────────────────────────────────────────
say() { printf '%s\n' "$*" >&2; }
die() { printf '[중단] %s\n' "$*" >&2; exit 1; }
quote_cmd() { # 사람이 읽기 쉬운 인용(한글 포함 인자도 깨지지 않게 %q 대신 작은따옴표 사용)
  local o="" a q
  for a in "$@"; do
    case "$a" in
      ''|*[!A-Za-z0-9_./:=@%+,-]*) q="'$(printf '%s' "$a" | sed "s/'/'\\\\''/g")'" ;;
      *) q="$a" ;;
    esac
    o="$o $q"
  done
  printf '%s' "${o# }"
}

# x "설명" cmd args…  — 단순 명령 실행(dry-run 이면 출력만)
x() {
  local desc="$1"; shift
  if is_dry; then say "[DRY] $desc"; say "      \$ $(quote_cmd "$@")"; return 0; fi
  log "$desc"; "$@"
}
# pre "전제 설명" cmd args… — 전제조건 검사(실패 시 중단). dry-run 이면 설명만 출력
pre() {
  local desc="$1"; shift
  if is_dry; then say "[전제] $desc"; say "      \$ $(quote_cmd "$@")"; return 0; fi
  log "전제 확인: $desc"; "$@" || die "전제 실패: $desc"
}
# note "설명" — dry-run/실행 모두 한 줄 안내
note() { say "[안내] $*"; }
# stdin 의 스크립트 본문을 dry-run 에서 들여쓰기하여 출력
show_script() { sed 's/^/        | /' >&2; }

# ── 원격 실행 ──────────────────────────────────────────────
SSH_OPTS=(-i "$DEV_KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 -o BatchMode=yes -o ServerAliveInterval=20)
# remote_dev "설명" < 스크립트  — dev 서버에서 bash 실행(stdout 은 그대로 stdout)
remote_dev() {
  local desc="$1" body; body="$(cat)"
  if is_dry; then say "[DRY] dev 서버($DEV_USER@$DEV_HOST): $desc"; printf '%s\n' "$body" | show_script; return 0; fi
  log "dev: $desc"
  printf '%s\n' "$body" | ssh "${SSH_OPTS[@]}" "$DEV_USER@$DEV_HOST" 'bash -s'
}
# dev_put 로컬파일… 원격디렉터리 — scp
dev_put() {
  local dest="${!#}"; local n=$(( $# - 1 ))
  if is_dry; then say "[DRY] scp → dev:$dest ($n 개 파일)"; return 0; fi
  scp "${SSH_OPTS[@]}" -q "${@:1:$n}" "$DEV_USER@$DEV_HOST:$dest"
}
# dev_get 원격파일 로컬경로 — scp (dev → 로컬)
dev_get() {
  if is_dry; then say "[DRY] scp ← dev:$1 → $2"; return 0; fi
  scp "${SSH_OPTS[@]}" -q "$DEV_USER@$DEV_HOST:$1" "$2"
}
# remote_prod "설명" [타임아웃초] < 스크립트 — prod EC2 에서 SSM Run Command(root, bash)
remote_prod() {
  local desc="$1" to="${2:-600}" body; body="$(cat)"
  if is_dry; then say "[DRY] prod 서버($PROD_IID, SSM): $desc"; printf '%s\n' "$body" | show_script; return 0; fi
  log "prod: $desc"
  printf '%s\n' "[ -n \"\$BASH_VERSION\" ] || exec bash \"\$0\" \"\$@\"
set -euo pipefail
$body" | awsx ssm-run "$PROD_IID" "$to"
}
awsx() { env -u PYTHONPATH -u VIRTUAL_ENV MB_PROFILE="$MB_PROFILE" MB_REGION="$MB_REGION" "$MB_AWS_PY" "$CUT_DIR/lib/awsx.py" "$@"; }

# ── DB 질의 (원격 호스트에서 pgrun.py 실행 — 접속 정보는 호스트의 env 파일에서 읽어 출력하지 않음) ──
PGRUN_B64() { base64 < "$CUT_DIR/lib/pgrun.py" | tr -d '\n'; }
_pg_script() { # <py> <env-file> <pgrun 인자…>  (SQL 은 stdin 그대로 전달하도록 here-doc 대신 base64)
  local py="$1" envf="$2" sqlb64="$3"; shift 3
  printf 'set -uo pipefail\nT=$(mktemp); echo %s | base64 -d > "$T.py"\nrc=0; echo %s | base64 -d | %s "$T.py" --env-file %s %s || rc=$?\nrm -f "$T" "$T.py"; exit $rc\n' \
    "$(PGRUN_B64)" "$sqlb64" "$py" "$envf" "$*"
}
# pg_dev "설명" "SQL" [pgrun 옵션…]  /  pg_prod "설명" "SQL" [pgrun 옵션…]
pg_dev() {
  local desc="$1" sql="$2"; shift 2
  if is_dry; then say "[DRY] dev DB 질의: $desc"; printf '%s\n' "$sql" | show_script; return 0; fi
  _pg_script "$DEV_PY" "$DEV_ENV_FILE" "$(printf '%s' "$sql" | base64 | tr -d '\n')" "$@" | remote_dev "$desc"
}
pg_prod() {
  local desc="$1" sql="$2"; shift 2
  if is_dry; then say "[DRY] prod DB 질의: $desc"; printf '%s\n' "$sql" | show_script; return 0; fi
  _pg_script "$PROD_PY" "$PROD_ENV_FILE" "$(printf '%s' "$sql" | base64 | tr -d '\n')" "$@" | remote_prod "$desc" 300
}

# ── 시각·단계 관리 ─────────────────────────────────────────
now_epoch() { date +%s; }
state_set() { printf '%s' "$2" > "$RUN_DIR/$1"; }
state_get() { cat "$RUN_DIR/$1" 2>/dev/null || true; }
state_has() { [ -e "$RUN_DIR/$1" ]; }
elapsed_min() { # T0(점검 시작) 기준 경과 분. T0 가 없으면 0
  local t0; t0="$(state_get t0_epoch)"
  if [ -z "$t0" ]; then echo 0; else echo $(( ($(now_epoch) - t0) / 60 )); fi
}
mark_t0() { state_has t0_epoch || state_set t0_epoch "$(now_epoch)"; }
tplus() { echo "T+$(elapsed_min)분"; }

# 단계 래퍼: run_step "C-1" "제목" — 파일 끝에서 step_main 을 호출(인자는 caller 의 "$@")
run_step() {
  local id="$1" title="$2"
  say ""; say "══ [$id] $title  ($(is_dry && echo DRY-RUN || echo 실행) · $(tplus)) ══"
  local t_begin; t_begin="$(now_epoch)"
  step_main
  if ! is_dry; then
    state_set "done_$id" "$(date -u +%FT%TZ)"
    printf '%s\t%s\t%s\t%ss\n' "$id" "$title" "$(tplus)" "$(( $(now_epoch) - t_begin ))" >> "$RUN_DIR/timeline.tsv"
  fi
  say "══ [$id] 완료 ($(tplus), 단계 소요 $(( $(now_epoch) - t_begin ))초) ══"
}

guard_prod_account() { is_dry && return 0; guard_account; }

# ── prod 점검 모드 (공개 개방 전 사용자 차단 · 관리자 IP 우회) ──
# prod_maint on|off — nginx-maint.sh 와 점검 페이지를 base64 로 전달해 prod 에서 실행(릴리스 포함 여부와 무관)
PROD_SITE="/etc/nginx/sites-enabled/mindbreeze.conf"
prod_maint() {
  local mode="$1" ips; ips="${MB_ADMIN_IPS:-$(state_get admin_ips)}"
  if is_dry; then
    remote_prod "prod 점검 모드 $mode (관리자 IP 우회: ${ips:-<MB_ADMIN_IPS>})" 120 <<EOF
# (nginx-maint.sh · index.html · moved.html 을 base64 로 전달해 /tmp/mb-maint 에 풀어 둔 뒤)
bash /tmp/mb-maint/nginx-maint.sh $mode --admin-ips '$ips' --site $PROD_SITE --assets /tmp/mb-maint --new-url https://$WEB_HOST
EOF
    return 0
  fi
  [ -n "$ips" ] || die "관리자 IP(MB_ADMIN_IPS) 없음"
  local a b c
  a="$(base64 < "$CUT_DIR/maintenance/nginx-maint.sh" | tr -d '\n')"; b="$(base64 < "$CUT_DIR/maintenance/index.html" | tr -d '\n')"; c="$(base64 < "$CUT_DIR/maintenance/moved.html" | tr -d '\n')"
  remote_prod "prod 점검 모드 $mode" 120 <<EOF
D=/tmp/mb-maint; mkdir -p \$D
echo $a | base64 -d > \$D/nginx-maint.sh; echo $b | base64 -d > \$D/index.html; echo $c | base64 -d > \$D/moved.html
bash \$D/nginx-maint.sh $mode --admin-ips '$ips' --site $PROD_SITE --assets \$D --new-url https://$WEB_HOST
EOF
}

# 필수 환경변수
need_env() { local v; for v in "$@"; do if is_dry; then say "[전제] 환경변수 $v 설정"; else [ -n "${!v:-}" ] || die "환경변수 $v 필요"; fi; done; }
