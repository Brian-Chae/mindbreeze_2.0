#!/usr/bin/env bash
# T-12 검증 (V-1.25) — 이름·타입만 출력, 값은 절대 출력하지 않음
source "$(dirname "$0")/common.sh"
aws ssm describe-parameters --parameter-filters Key=Path,Values=/mindbreeze/prod,Option=Recursive \
  --query 'Parameters[].[Name,Type,KeyId]' --output text > "$MB_STATE_DIR/params.tsv"
echo "총 $(wc -l < "$MB_STATE_DIR/params.tsv")개 / SecureString $(awk '$2=="SecureString"' "$MB_STATE_DIR/params.tsv" | wc -l)개 / 타입≠SecureString $(awk '$2!="SecureString"' "$MB_STATE_DIR/params.tsv" | wc -l)개 / CMK 사용 $(grep -c "$(load kms_key_id)" "$MB_STATE_DIR/params.tsv")개"
echo "-- 이름: $(awk '{sub("/mindbreeze/prod/","",$1);print $1}' "$MB_STATE_DIR/params.tsv" | sort | tr '\n' ' ')"
echo "-- 자리표시 상태(외부 키, 값 '미채움'):"
for n in $(awk '{sub("/mindbreeze/prod/","",$1);print $1}' "$MB_STATE_DIR/params.tsv"); do
  v="$(aws ssm get-parameter --name /mindbreeze/prod/$n --with-decryption --query Parameter.Value --output text)"; [[ "$v" == PLACEHOLDER-FILL-ME ]] && printf '%s ' "$n"
done; echo
echo "== 서버(인스턴스 역할) 읽기 권한 / 교차 접근"
bash "$(dirname "$0")/ssm-run.sh" 'export AWS_DEFAULT_REGION=ap-northeast-1; echo ssm_read_count=$(aws ssm get-parameters-by-path --path /mindbreeze/prod --recursive --with-decryption --query "Parameters[].Name" --output text 2>&1 | wc -w); echo prod_bucket_ls=$(aws s3 ls s3://mindbreeze-prod/ >/dev/null 2>&1 && echo OK || echo FAIL); echo releases_ls=$(aws s3 ls s3://mindbreeze-prod-releases/ >/dev/null 2>&1 && echo OK || echo FAIL); aws s3 ls s3://mindbreeze-dev/ 2>&1 | head -1 | cut -c1-120; echo dev_bucket=$(aws s3 ls s3://mindbreeze-dev/ >/dev/null 2>&1 && echo ACCESSIBLE || echo DENIED)'
