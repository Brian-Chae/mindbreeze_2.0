#!/usr/bin/env bash
# 6자리 코드 비종료 세션(precheck Q3: 진행 1·준비 2·예정 2 = 5건) 정리 절차 — **이 스크립트를 이번 작업에서 실행하지 않았다.**
#
# 절차 (Brian 승인: 컷오버 전날 상담사 안내 → 점검 직전 취소)
#   D-1 (10/21)  1. `list` 로 대상·호스트(마스킹 이메일)·예정 시각 확인 → 해당 상담사에게 개별 안내
#                   (docs/컷오버_공지문_초안.md '상담사용 – 6자리 코드 클래스 안내' 사용. 새 4자리 코드로 클래스를 다시 만들어야 한다는 안내)
#   D-day 01:30~01:50 (점검 시작 10~30분 전, c00 실행 전)
#                2. `list` 재확인 → 진행 중(in_progress) 세션이 있으면 상담사 종료를 기다림(종료 못 하면 점검 시작 보류)
#                3. `cancel --execute` : 앱의 취소 로직으로 처리 → 참가자에게 취소 알림 발송(워커가 아직 가동 중이므로 정상 전달)
#                4. `list` 로 0건 확인 → 그 후 c00-record.sh (게이트가 0건 아니면 중단)
#   취소는 dev 데이터 변경이므로 점검창 밖(c00 이전)에만 수행. 감사 기록: dev 서버 /home/ubuntu/cutover-backup/legacy-cancel-<RUN_ID>.tsv
#
# 사용: bash cancel-legacy-sessions.sh list|cancel [--execute] [--dry-run]
source "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

MODE="${1:-list}"; EXEC=""
for _a in "$@"; do [ "$_a" = "--execute" ] && EXEC="--execute"; done
[ "$MODE" = "list" ] || [ "$MODE" = "cancel" ] || { echo "usage: $0 list|cancel [--execute] [--dry-run]" >&2; exit 2; }

step_main() {
  dev_put "$CUT_DIR/lib/pgrun.py" "$CUT_DIR/ops/cancel_legacy_sessions.py" /tmp/
  # 환경은 cron 과 동일 방식으로 필요한 변수만 추출(.env.dev 전체 source 금지 — 공백·꺾쇠 값이 셸을 깨뜨림)
  remote_dev "6자리 코드 비종료 세션 $MODE ${EXEC:+(실행)}" <<EOF
set -euo pipefail
mkdir -p /home/ubuntu/cutover-backup
cd $DEV_BASE/backend
export DATABASE_URL=\$(grep -E '^DATABASE_URL=' ./.env.dev | head -1 | cut -d= -f2-)
export REDIS_URL=\$(grep -E '^REDIS_URL=' ./.env.dev | head -1 | cut -d= -f2-)
rc=0
install -m 0644 /tmp/cancel_legacy_sessions.py ./cancel_legacy_sessions.tmp.py
./venv/bin/python ./cancel_legacy_sessions.tmp.py $MODE $EXEC --audit-file /home/ubuntu/cutover-backup/legacy-cancel-$RUN_ID.tsv || rc=\$?
rm -f ./cancel_legacy_sessions.tmp.py
exit \$rc
EOF
}
run_step "OPS" "6자리 코드 세션 $MODE ${EXEC:+(--execute)}" "$@"
