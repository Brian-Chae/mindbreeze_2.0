#!/usr/bin/env bash
# V-1.5(외부 포트: 22·8000·7880 타임아웃, 80/443 은 SG 개방이라 '연결 거부(리스너 없음)'), V-1.13/1.14(EC2→RDS 5432·SSL)
source "$(dirname "$0")/common.sh"; IP="$(load eip_ip)"; H="$(load rds_empty_endpoint)"
for p in 22 8000 7880 5432 80 443; do
  if nc -z -G 4 "$IP" $p 2>/dev/null; then r=OPEN; else r="closed/timeout"; fi
  printf 'external %s:%s => %s\n' "$IP" $p "$r"
done
echo "-- RDS 외부(5432) 접근 시도:"; nc -z -G 4 "$H" 5432 2>&1 && echo OPEN || echo "closed/timeout(사설 IP)"
bash "$(dirname "$0")/ssm-run.sh" "echo tcp5432=\$(timeout 5 bash -c 'echo > /dev/tcp/$H/5432' 2>&1 && echo OK || echo FAIL); echo | timeout 8 openssl s_client -starttls postgres -connect $H:5432 2>/dev/null | grep -E 'Protocol|Verification|Cipher is' | head -3; getent hosts $H | cut -d' ' -f1"
