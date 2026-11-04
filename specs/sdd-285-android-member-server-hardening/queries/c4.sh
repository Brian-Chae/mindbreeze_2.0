echo "== nginx 로그 파일"; ls -la /var/log/nginx/ | head
echo "== socket.io 요청 상태코드 분포 (11/4 01:00~02:30 UTC)"
for f in /var/log/nginx/access.log /var/log/nginx/access.log.1; do [ -f $f ] && cat $f; done | grep "04/Nov/2026:0[1-2]:" | grep -c "socket.io"
for f in /var/log/nginx/access.log /var/log/nginx/access.log.1; do [ -f $f ] && cat $f; done | grep "04/Nov/2026:0[1-2]:" | grep "socket.io" | awk '{print $9}' | sort | uniq -c | sort -rn | head
echo "== socket.io 분당(UTC 01시대) 건수·상태 샘플"
for f in /var/log/nginx/access.log /var/log/nginx/access.log.1; do [ -f $f ] && cat $f; done | grep "04/Nov/2026:0[1-2]:" | grep "socket.io" | awk '{print substr($4,15,5), $9}' | sort | uniq -c | awk '$1>0' | head -60
echo "== 샘플 라인"
for f in /var/log/nginx/access.log /var/log/nginx/access.log.1; do [ -f $f ] && cat $f; done | grep "04/Nov/2026:01:1[3-4]:" | grep "socket.io" | head -3 | cut -c1-300
