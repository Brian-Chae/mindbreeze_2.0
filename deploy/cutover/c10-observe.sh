#!/usr/bin/env bash
# C-10 관찰 30분 (점검창 밖) — 오류율·큐 적체·경보·실패 유닛 확인 후 컷오버 완료 선언.
#  · 30초마다 /health/ready, 5분마다 서버 점검(backend 오류 줄·실패 유닛·Redis 큐 길이) + CloudWatch 경보(ALARM) 조회.
#  · 연속 3회 헬스 실패 또는 ALARM 발생 시 중단(롤백 아님 — 점검 해제 후이므로 수정 배포/PITR 판단: plan §6).
#  · 수동 스모크(Google 로그인·화상·실시간 EEG·음성→리포트·메일)는 이 시간에 병행한다(c08-smoke.sh 헤더 참고).
# 사용: bash c10-observe.sh [--dry-run]     MB_OBSERVE_FINAL_MIN(기본 30)
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

MIN="${MB_OBSERVE_FINAL_MIN:-30}"
chk_alarms() { # prod 경보 중 ALARM 상태 개수
  local n1 n2
  n1="$(aws cloudwatch describe-alarms --alarm-name-prefix mb-prod- --state-value ALARM --query 'length(MetricAlarms)' --output text)"
  n2="$(MB_REGION=us-east-1 aws cloudwatch describe-alarms --alarm-name-prefix mb-prod-uptime- --state-value ALARM --query 'length(MetricAlarms)' --output text)"
  echo $(( n1 + n2 ))
}

step_main() {
  guard_prod_account
  note "관찰 ${MIN}분: 30초 간격 헬스 · 5분 간격 서버/경보 점검"
  remote_prod "서버 점검(backend 오류 줄·실패 유닛·Redis 큐·timer 수) — 5분마다 반복되는 항목" 120 <<'EOF'
echo "backend 오류 줄(최근 5분): $(journalctl -u mindbreeze-backend --since '-5min' --no-pager 2>/dev/null | grep -ciE ' (ERROR|CRITICAL) |Traceback' || true)"
echo "실패 유닛: $(systemctl --failed --no-legend 'mindbreeze-*' | wc -l)"
echo "celery 큐 길이: $(redis-cli llen celery 2>/dev/null || echo n/a)"
echo "활성 timer: $(systemctl list-timers 'mindbreeze-job-*' --no-pager --no-legend | wc -l)"
EOF
  if is_dry; then
    x "경보 ALARM 개수 조회(ap-northeast-1 mb-prod-* + us-east-1 mb-prod-uptime-*)" chk_alarms
    note "완료 시: state COMPLETE 기록 + timeline.tsv 요약 출력. 이후 T-21(dev 비식별화)·T-22(48시간 관찰) 진행"
    return 0
  fi
  local end=$(( $(now_epoch) + MIN * 60 )) bad=0 tick=0 a out
  while [ "$(now_epoch)" -lt "$end" ]; do
    if curl -fsS --max-time 10 "https://$API_HOST/health/ready" >/dev/null 2>&1; then bad=0; else bad=$((bad + 1)); say "헬스 실패 ${bad}회"; fi
    [ "$bad" -ge 3 ] && die "관찰 중 헬스 연속 3회 실패 — 수정 배포/PITR 판단(plan §6 롤백 기준)"
    if [ $((tick % 10)) -eq 0 ]; then
      a="$(chk_alarms)"; [ "$a" = "0" ] || die "CloudWatch ALARM ${a}건 — 경보 확인"
      out="$(remote_prod "서버 점검" 120 <<'EOF2'
echo "backend 오류 줄(최근 5분): $(journalctl -u mindbreeze-backend --since '-5min' --no-pager 2>/dev/null | grep -ciE ' (ERROR|CRITICAL) |Traceback' || true)"
echo "실패 유닛: $(systemctl --failed --no-legend 'mindbreeze-*' | wc -l)"
echo "celery 큐 길이: $(redis-cli llen celery 2>/dev/null || echo n/a)"
EOF2
)"
      printf '[%s] %s\n' "$(date +%H:%M)" "$(echo "$out" | tr '\n' ' ')" | tee -a "$RUN_DIR/C10-observe.log" >&2
      echo "$out" | grep -q '실패 유닛: 0' || die "실패한 mindbreeze 유닛 존재"
    fi
    tick=$((tick + 1)); sleep 30
  done
  state_set COMPLETE "$(date -u +%FT%TZ)"
  say ""; say "컷오버 완료 선언 — 단계별 소요(timeline.tsv):"; column -t -s "$(printf '\t')" "$RUN_DIR/timeline.tsv" >&2 || cat "$RUN_DIR/timeline.tsv" >&2
}
run_step "C-10" "관찰 ${MIN}분 후 컷오버 완료 선언" "$@"
