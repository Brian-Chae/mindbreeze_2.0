#!/usr/bin/env bash
# SDD-210 컷오버 런북 진입 스크립트 — C-0 ~ C-10 을 순서대로 실행한다.
#  · 단계 사이 확인 프롬프트 **없음**. 중단 조건(= 단계 실패, 전제·게이트 불일치, 점검창 시간 가드) 이 발생할 때만 멈춘다.
#  · 멈추면 어느 단계에서 어떤 구간(A/B/C)인지 출력한다. 롤백은 사람이 판단해 `rollback.sh` 를 실행한다(자동 롤백 없음).
#  · 정본: specs/sdd-210-prod-environment/plan.md §6 · rehearsal-result.md. 일정: 2026-10-22(목) 02:00~03:00 KST (점검창 60분).
#
# 사용:
#   bash cutover.sh --dry-run                 # 전체 단계의 명령·전제조건만 출력(AWS·SSH·SSM·gh 호출 없음)
#   bash cutover.sh                           # 실제 실행 (환경변수 필요: 아래)
#   bash cutover.sh --from C-5                # 재개 (중단된 단계부터. 같은 RUN_ID 자동 사용)
#   bash cutover.sh --only C-4b [--dry-run]   # 단일 단계 / --to C-3 : 해당 단계까지
#   bash cutover.sh --list                    # 단계 목록
#
# 실제 실행 필수 환경변수(비밀 아님):
#   MB_ADMIN_IPS=<관리자 공인 IP,쉼표>   점검 중 우회 IP(운영자 로컬 IP 포함 — C-8 스모크가 점검 모드 prod 에 접속)
#   MB_RELEASE_ID=<release-build ID>       C-5 에 배포할 확정 릴리스(리허설 통과 산출물과 동일 SHA 계열)
#   MB_ACK_RESEARCH_KEY_BACKUP=1 MB_ACK_PRIVACY_POLICY=1 MB_ACK_NOTICE_D1=1   (사전 완료 선언)
# 선택: MB_SMOKE_EMAIL / MB_SMOKE_PASSWORD_FILE (C-8 API 스모크 계정), MB_OBSERVE_MIN, MB_MAINT_LIMIT_MIN, MB_ALLOW_OVERRUN=1
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

STEP_IDS=(C-0 C-1 C-2 C-3 C-4 C-4b C-5 C-6 C-7 C-8 C-9 C-10)
STEP_FILES=(c00-record c01-maintenance-on c02-db-restore c03-db-cleanup c04-s3-sync c04b-audio-migrate c05-deploy c06-activate c07-dns c08-smoke c09-release c10-observe)

DRY=0; FROM=""; TO=""; ONLY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    --from) FROM="$2"; shift ;;
    --to) TO="$2"; shift ;;
    --only) ONLY="$2"; shift ;;
    --list) for i in "${!STEP_IDS[@]}"; do printf '%-5s %s.sh\n' "${STEP_IDS[$i]}" "${STEP_FILES[$i]}"; done; exit 0 ;;
    -h|--help) sed -n 2,22p "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "알 수 없는 옵션: $1" >&2; exit 2 ;;
  esac
  shift
done
[ "$DRY" = 1 ] && export MB_DRY_RUN=1
ARGS=(); [ "$DRY" = 1 ] && ARGS=(--dry-run)

# 실행 식별자: 처음 실행 시 생성, --from 재개는 기존 값 재사용
if [ "$DRY" != 1 ]; then
  mkdir -p "$HERE/.run"
  if [ -z "${MB_RUN_ID:-}" ]; then
    if [ -n "$FROM$ONLY" ] && [ -r "$HERE/.run/current-id" ]; then MB_RUN_ID="$(cat "$HERE/.run/current-id")"; else MB_RUN_ID="$(date +%Y%m%d-%H%M)"; fi
  fi
  export MB_RUN_ID
  mkdir -p "$HERE/.run/$MB_RUN_ID"
  exec > >(tee -a "$HERE/.run/$MB_RUN_ID/cutover.log") 2>&1
  echo "RUN_ID=$MB_RUN_ID (로그: deploy/cutover/.run/$MB_RUN_ID/cutover.log)"
fi

idx_of() { local i; for i in "${!STEP_IDS[@]}"; do [ "${STEP_IDS[$i]}" = "$1" ] && { echo "$i"; return 0; }; done; echo "알 수 없는 단계: $1" >&2; return 1; }
START=0; END=$(( ${#STEP_IDS[@]} - 1 ))
[ -n "$FROM" ] && START="$(idx_of "$FROM")"
[ -n "$TO" ] && END="$(idx_of "$TO")"
if [ -n "$ONLY" ]; then START="$(idx_of "$ONLY")"; END="$START"; fi

phase_of() { # 실패 시 롤백 구간 안내
  case "$1" in
    C-0) echo "점검 전 — 변경 없음. 원인 해결 후 재실행" ;;
    C-1|C-2|C-3|C-4|C-4b|C-5|C-6) echo "구간 A(DNS 전환 전) — 롤백: bash rollback.sh (dev 복귀). 시간 여유가 있으면 --from $1 로 재개 가능" ;;
    C-7|C-8) echo "구간 B(DNS 전환 후·점검 해제 전) — 롤백: bash rollback.sh (timer 중지→DNS 레코드 삭제→dev 복귀)" ;;
    *) echo "구간 C(점검 해제 후) — 자동 롤백 금지: 수정 배포/PITR 판단(plan §6)" ;;
  esac
}

if [ "$DRY" = 1 ]; then echo "===== DRY-RUN: 실제 실행 없이 명령·전제조건만 출력 (AWS·SSH·SSM·gh 호출 없음) ====="; fi
for i in $(seq "$START" "$END"); do
  id="${STEP_IDS[$i]}"; f="$HERE/${STEP_FILES[$i]}.sh"
  # 시간 가드: DNS 전환 전 단계에서 점검창 한도 초과 시 중단
  if [ "$DRY" != 1 ] && [ -r "$HERE/.run/$MB_RUN_ID/t0_epoch" ] && [ ! -e "$HERE/.run/$MB_RUN_ID/dns_switched" ]; then
    case "$id" in C-2|C-3|C-4|C-4b|C-5|C-6|C-7)
      el=$(( ($(date +%s) - $(cat "$HERE/.run/$MB_RUN_ID/t0_epoch")) / 60 ))
      limit="${MB_MAINT_LIMIT_MIN:-60}"
      if [ "$el" -ge "$limit" ] && [ "${MB_ALLOW_OVERRUN:-0}" != "1" ]; then
        echo "[중단] T+${el}분 ≥ 점검창 한도 ${limit}분 (다음 단계 $id 진입 전). $(phase_of C-6)"; exit 10
      fi ;;
    esac
  fi
  if ! bash "$f" ${ARGS[@]+"${ARGS[@]}"}; then
    echo ""; echo "[중단] 단계 $id 실패 → $(phase_of "$id")"; exit 1
  fi
done
if [ "$DRY" = 1 ]; then
  echo ""; echo "===== DRY-RUN 완료: 단계 ${STEP_IDS[$START]} ~ ${STEP_IDS[$END]} 의 명령·전제조건 출력 끝 ====="
else
  echo ""; echo "[완료] 단계 ${STEP_IDS[$START]} ~ ${STEP_IDS[$END]} 실행 완료"
fi
