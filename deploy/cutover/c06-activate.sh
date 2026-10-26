#!/usr/bin/env bash
# C-6 실행 주체 전환: prod 를 운영 호스트명으로 재구성(인증서 DNS-01 선발급) → 주기 작업 timer 활성화 → 워커 가동 확인.
#  · server-config.sh 는 timer 를 전부 disable 하므로 **timer 활성화(jobs-ctl enable)보다 먼저** 실행한다(순서 고정, R9).
#  · 인증서는 DNS-01(Route53 TXT)이라 DNS 전환 전에 발급 가능(R6). 발급 실패 시 DNS 전환 단계로 넘어가지 않는다.
#  · dev 는 C-1 에서 이미 cron·워커 중지 상태 유지(이중 발송 방지).
# 사용: bash c06-activate.sh [--dry-run]
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

step_main() {
  remote_prod "서버 구성을 운영 호스트명으로 재적용(nginx 서버명·livekit/coturn 렌더·인증서 신규 발급, timer 는 disable 상태로 설치)" 1500 <<EOF
cd /opt/mindbreeze/current/deploy
bash server-config.sh $WEB_HOST $API_HOST $PROD_EIP
systemctl restart livekit coturn
nginx -t
openssl x509 -in /etc/letsencrypt/live/$WEB_HOST/fullchain.pem -noout -enddate
for h in $WEB_HOST $API_HOST; do openssl x509 -in /etc/letsencrypt/live/$WEB_HOST/fullchain.pem -noout -ext subjectAltName | grep -q "DNS:\$h"; done
echo "인증서 SAN OK"
EOF
  remote_prod "주기 작업 timer 활성화(jobs.tsv enabled=1) 및 개수 확인, 워커 active 확인" 300 <<EOF
D=/opt/mindbreeze/current/deploy
bash \$D/jobs-ctl.sh enable \$D/jobs.tsv
want=\$(awk -F'\t' 'NR>1 && \$1!~/^#/ && \$5=="1"' \$D/jobs.tsv | wc -l)
have=\$(systemctl list-timers 'mindbreeze-job-*' --no-pager --no-legend | wc -l)
echo "활성 timer: \$have / 기대: \$want"
[ "\$have" = "\$want" ]
for s in mindbreeze-backend mindbreeze-stt-worker mindbreeze-report-worker mindbreeze-worker mindbreeze-email-worker mindbreeze-export-worker nginx livekit coturn; do
  [ "\$(systemctl is-active \$s)" = active ] || { echo "\$s 비활성"; exit 1; }
done
curl -fsS http://127.0.0.1:8000/health/ready >/dev/null && echo "헬스 OK"
EOF
  remote_dev "dev 이중 실행 방지 확인(cron 0줄·워커 inactive)" <<EOF
test "\$(crontab -l 2>/dev/null | grep -vc '^#' || true)" = 0
for s in $DEV_SERVICES; do [ "\$(systemctl is-active \$s || true)" != active ]; done
echo "dev 정지 유지 OK"
EOF
  is_dry || state_set prod_timers_on "$(date -u +%FT%TZ)"

  # 공개 개방(C-7 DNS) 전에 prod 를 점검 모드로 — 사용자는 C-9 전까지 점검 페이지(관리자 IP 만 우회: 스모크용)
  prod_maint on
  is_dry || state_set prod_maintenance_on "$(date -u +%FT%TZ)"
}
run_step "C-6" "prod 구성(운영 호스트·인증서)·timer 활성화·워커 확인" "$@"
