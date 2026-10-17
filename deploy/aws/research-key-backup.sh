#!/usr/bin/env bash
# 연구 가명 키(RESEARCH_ID_KEY_V1) 오프라인 백업 — Brian 이 본인 터미널에서 실행. (분실 시 동일인 매핑 영구 단절)
# 키는 화면·셸 변수·히스토리·파일 평문 어디에도 나오지 않는다: SSM → (파이프) → gpg 대칭 암호화(암호는 gpg 가 직접 묻는 프롬프트) → 파일.
# 사용: ./research-key-backup.sh /Volumes/<오프라인USB>/mb-research-key-v1.gpg
# 출력: 지문(SHA-256 앞 12자) — 종이/비밀번호관리자에 암호와 별도로 적어 두고, 복원 확인 때 대조.
set -euo pipefail
OUT="${1:?출력 파일 경로(오프라인 매체)를 지정하세요}"
[[ ! -e "$OUT" ]] || { echo "이미 존재: $OUT (덮어쓰기 거부)" >&2; exit 1; }
PROFILE="${MB_PROFILE:-looxid-las}"; REGION="${MB_REGION:-ap-northeast-1}"
umask 077
aws --profile "$PROFILE" --region "$REGION" ssm get-parameter --name /mindbreeze/prod/RESEARCH_ID_KEY_V1 --with-decryption \
  --query Parameter.Value --output text | tr -d '\n' | tee >(shasum -a 256 | cut -c1-12 > "${OUT}.fp") \
  | gpg --symmetric --cipher-algo AES256 --armor --output "$OUT"
echo "백업 완료: $OUT"
sleep 1
echo "지문(12자, 별도 보관): $(cat "${OUT}.fp")"
sleep 1; rm -f "${OUT}.fp"
echo "다음: ./research-key-backup-verify.sh '$OUT' 로 복호화 대조(키는 출력되지 않고 지문만 비교)."
