#!/usr/bin/env bash
# SDD-210 T-3: 주기 작업 timer 일괄 제어 (컷오버 실행 주체 전환용, plan R9).
# 사용: jobs-ctl.sh enable|disable|status [jobs.tsv 경로]
#   enable  : enabled=1 인 timer 를 활성화·시작
#   disable : 모든 mindbreeze-job-*.timer 를 중지·비활성화(진행 중 작업은 끝까지 실행)
set -euo pipefail
CMD="${1:?enable|disable|status}"
HERE="$(cd "$(dirname "$0")" && pwd)"
TSV="${2:-$HERE/jobs.tsv}"
mapfile -t ENABLED < <(awk -F'\t' 'NR>1 && $1!~/^#/ && $5=="1" {print $1}' "$TSV")
mapfile -t ALL < <(awk -F'\t' 'NR>1 && $1!~/^#/ {print $1}' "$TSV")
case "$CMD" in
  enable)  for n in "${ENABLED[@]}"; do sudo systemctl enable --now "mindbreeze-job-${n}.timer"; done
           echo "활성화: ${#ENABLED[@]}개" ;;
  disable) for n in "${ALL[@]}"; do sudo systemctl disable --now "mindbreeze-job-${n}.timer" 2>/dev/null || true; done
           echo "비활성화: ${#ALL[@]}개 시도" ;;
  status)  systemctl list-timers 'mindbreeze-job-*' --no-pager ;;
  *) echo "usage: $0 enable|disable|status" >&2; exit 2 ;;
esac
