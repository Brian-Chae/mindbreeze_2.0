#!/usr/bin/env bash
# SDD-246 T01 — 계약 전체 검증 진입점. T12 의 scripts/sdd246/check-contracts 가 이 스크립트를 호출한다.
# dev .env·DB·네트워크를 읽지 않는다(합성 입력만). 실패하면 첫 실패 단계의 종료코드로 끝난다.
#   환경변수: BACKEND_PY  backend venv python (기본: <repo>/backend/venv/bin/python, 없으면 python3)
#             SKIP_ORACLE=1  vitest 기반 TS oracle 단계 생략(빠른 확인용; 최종 인수에는 쓰지 말 것)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
V1="$HERE/biosignal-golden/v1"
PY="${BACKEND_PY:-$REPO/backend/venv/bin/python}"
[ -x "$PY" ] || PY="$(command -v python3)"

step() { printf '\n== %s\n' "$1"; }

step "1/6 session-live-v2 schema·fixture (node --test)"
node --test "$HERE/session-live-v2/validate.test.mjs" "$HERE/session-live-v2/wire-compat.test.mjs"

step "2/6 measurement-bridge·core ABI schema·fixture (node --test)"
node --test "$HERE/measurement-bridge/validate.test.mjs"

step "3/6 biosignal-golden 바이트 정본: 독립 산술·struct·결정성 (python unittest)"
python3 -I "$V1/tools/verify_packets.py" "$V1"

step "4/6 소비자 공통 decode 계약 (node --test, Buffer 디코더)"
node --test "$V1/consumers/decode-conformance.test.mjs"

step "5/6 golden manifest 해시·소스 고정 (G1 미충족 유지 확인)"
python3 -I "$V1/tools/build_manifest.py" check "$REPO"

if [ "${SKIP_ORACLE:-0}" = "1" ]; then
  step "6/6 TS oracle 생략(SKIP_ORACLE=1) — 최종 인수 증거로 사용 금지"
else
  step "6/6 TS oracle(정본: 제품과 같은 biquad 경로) + GF04 + legacy_fallback 대조"
  (cd "$REPO/frontend" && npx vitest run --config ../contracts/biosignal-golden/v1/oracle/vitest.oracle.config.mjs)
  (cd "$REPO/frontend" && ORACLE_FILTER=legacy_fallback npx vitest run --config ../contracts/biosignal-golden/v1/oracle/vitest.oracle.config.mjs)
fi
printf '\n계약 검증 완료 (G1 실측 골든은 여전히 미충족 — manifest.status 참고)\n'
