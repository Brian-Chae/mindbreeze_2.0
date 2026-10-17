#!/usr/bin/env bash
# 백업 파일을 복호화해 SSM 값과 지문이 같은지만 확인 (V-1.27, V-6.5). 키 값은 출력하지 않는다.
set -euo pipefail
IN="${1:?백업 파일 경로}"
PROFILE="${MB_PROFILE:-looxid-las}"; REGION="${MB_REGION:-ap-northeast-1}"
A="$(gpg --decrypt "$IN" 2>/dev/null | tr -d '\n' | shasum -a 256 | cut -c1-12)"
B="$(aws --profile "$PROFILE" --region "$REGION" ssm get-parameter --name /mindbreeze/prod/RESEARCH_ID_KEY_V1 --with-decryption --query Parameter.Value --output text | tr -d '\n' | shasum -a 256 | cut -c1-12)"
[[ "$A" == "$B" && -n "$A" ]] && echo "일치 (지문 $A)" || { echo "불일치!" >&2; exit 1; }
