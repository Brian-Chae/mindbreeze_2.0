#!/usr/bin/env bash
# C-4 S3 동기화: mindbreeze-dev 의 eeg-raw/·video/ → mindbreeze-prod (복사만, dev 원본 무변경). 리허설 2,866개/2.19GB 약 40초.
# `_server-archive-20261010/` 은 dev 보관본이라 복사하지 않는다. 객체 수·총 바이트 일치 + 샘플 5건 해시 대조.
# 실행 주체: 운영자 로컬(looxid-las 프로파일 — dev·prod 버킷 모두 접근 가능한 brian.chae).
# 사용: bash c04-s3-sync.sh [--dry-run]
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

SRC_BUCKET="mindbreeze-dev"; DST_BUCKET="mindbreeze-prod"
PREFIXES="eeg-raw/ video/"

# 접두사 요약: "<객체수> <바이트>"
summ() { aws s3 ls "s3://$1/$2" --recursive --summarize | awk '/Total Objects:/{o=$3} /Total Size:/{s=$3} END{print o+0, s+0}'; }

step_main() {
  guard_prod_account
  local p
  for p in $PREFIXES; do
    x "sync s3://$SRC_BUCKET/$p → s3://$DST_BUCKET/$p" aws s3 sync "s3://$SRC_BUCKET/$p" "s3://$DST_BUCKET/$p" --only-show-errors --no-progress
  done
  if is_dry; then
    note "검증: 접두사별 객체 수·총 바이트 dev == prod (불일치 시 중단)"
    note "샘플 5건: 각 접두사 앞쪽 객체를 스트리밍 sha256 으로 dev/prod 대조 (불일치 시 중단)"
    return 0
  fi
  local a b
  for p in $PREFIXES; do
    a="$(summ "$SRC_BUCKET" "$p")"; b="$(summ "$DST_BUCKET" "$p")"
    echo "$p dev=[$a] prod=[$b]" | tee -a "$RUN_DIR/C4-s3-verify.txt" >&2
    [ "$a" = "$b" ] || die "S3 불일치: $p dev=[$a] prod=[$b]"
  done
  # 샘플 해시 대조 (5건)
  local keys k n=0 h1 h2
  keys="$(aws s3api list-objects-v2 --bucket "$SRC_BUCKET" --prefix eeg-raw/ --max-items 3 --query 'Contents[].Key' --output text; aws s3api list-objects-v2 --bucket "$SRC_BUCKET" --prefix video/ --max-items 2 --query 'Contents[].Key' --output text)"
  for k in $keys; do
    [ "$k" = "None" ] && continue
    h1="$(aws s3 cp "s3://$SRC_BUCKET/$k" - --only-show-errors | shasum -a 256 | cut -c1-16)"
    h2="$(aws s3 cp "s3://$DST_BUCKET/$k" - --only-show-errors | shasum -a 256 | cut -c1-16)"
    [ "$h1" = "$h2" ] || die "샘플 해시 불일치: $k"
    n=$((n + 1))
  done
  note "샘플 해시 일치 ${n}건"
  [ "$n" -ge 1 ] || die "샘플 검증 대상 없음"
}
run_step "C-4" "S3 동기화(eeg-raw·video) 및 대조" "$@"
