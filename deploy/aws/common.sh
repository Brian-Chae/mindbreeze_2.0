#!/usr/bin/env bash
# SDD-210 Phase B 공통 함수 — 모든 스크립트가 source 한다. 시크릿 값 하드코딩 금지.
set -euo pipefail

export MB_PROFILE="${MB_PROFILE:-looxid-las}"
export MB_REGION="${MB_REGION:-ap-northeast-1}"
export MB_ACCOUNT="187768779388"
export MB_STATE_DIR="${MB_STATE_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/.state}"   # 식별자 캐시(gitignore)
mkdir -p "$MB_STATE_DIR"

# AWS CLI 래퍼: MB_AWS_PY(파이썬 경로)가 있으면 `python -m awscli`, 없으면 PATH 의 aws.
aws() {
  if [[ -n "${MB_AWS_PY:-}" ]]; then
    env -u PYTHONPATH -u VIRTUAL_ENV "$MB_AWS_PY" -m awscli --profile "$MB_PROFILE" --region "$MB_REGION" "$@"
  else
    command aws --profile "$MB_PROFILE" --region "$MB_REGION" "$@"
  fi
}

TAG_KV='Key=project,Value=mindbreeze Key=env,Value=prod'
TAGS_EC2() { echo "ResourceType=$1,Tags=[{Key=project,Value=mindbreeze},{Key=env,Value=prod},{Key=Name,Value=$2}]"; }
TAGS_JSON_IAM='[{"Key":"project","Value":"mindbreeze"},{"Key":"env","Value":"prod"}]'

log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*" >&2; }
save() { printf '%s' "$2" > "$MB_STATE_DIR/$1"; }       # save NAME VALUE
load() { cat "$MB_STATE_DIR/$1" 2>/dev/null || true; }

# 계정 가드: 다른 계정에서 실수로 실행 방지
guard_account() {
  local a; a="$(aws sts get-caller-identity --query Account --output text)"
  [[ "$a" == "$MB_ACCOUNT" ]] || { echo "계정 불일치: $a" >&2; exit 1; }
}

# 공통 조회기: Name 태그 + env=prod 로 리소스 ID 찾기 (없으면 빈 문자열)
find_ec2() { # find_ec2 <describe-cmd> <jq-path-query> <name>
  aws ec2 "$1" --filters "Name=tag:Name,Values=$3" "Name=tag:env,Values=prod" --query "$2" --output text 2>/dev/null | sed 's/^None$//' || true
}

# ── SSM 비밀값 헬퍼 (값은 변수·파일·명령줄·출력에 남기지 않음: 난수 → python 파이프 → stdin JSON) ──
SSM_PREFIX="/mindbreeze/prod"
param_exists() { aws ssm get-parameter --name "$SSM_PREFIX/$1" --query Parameter.Name --output text >/dev/null 2>&1; }

# ensure_random_param NAME KIND LEN   KIND: alnum | hex | b64url  (boto3 직접 호출 — 값은 어디에도 출력되지 않음)
SECRETS_PY="${MB_AWS_PY:-python3}"
secrets_helper() { env -u PYTHONPATH -u VIRTUAL_ENV "$SECRETS_PY" "$(dirname "${BASH_SOURCE[0]}")/secrets_helper.py" "$@"; }
ensure_random_param() { secrets_helper put-random "$1" "$2" "$3" >&2; }
# ensure_text_param NAME VALUE(비밀 아님) [Type=String] [overwrite=no]
ensure_text_param() { secrets_helper put-text "$1" "$2" "${3:-String}" "${4:-no}" >&2; }
