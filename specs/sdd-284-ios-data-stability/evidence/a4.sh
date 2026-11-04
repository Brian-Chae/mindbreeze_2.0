[ -f /tmp/n284.log ] || { cat /var/log/nginx/access.log /var/log/nginx/access.log.1 | grep "04/Nov/2026:0[1-2]:" > /tmp/n284.log; }
python3 - <<'PY'
import re,collections
c=collections.Counter(); first={}
for l in open('/tmp/n284.log'):
    if 'CFNetwork' not in l: continue
    m=re.search(r'\[(\d+/\w+/\d+):(\d\d):(\d\d):(\d\d) \+0000\] "(\w+) (\S+) HTTP/[\d.]+" (\d+)',l)
    if not m: continue
    d,h,mi,s,meth,p,st=m.groups()
    p=re.sub(r'[0-9a-f]{8}-[0-9a-f-]{27}','ID',p).split('?')[0]
    kst=f"{(int(h)+9)%24:02d}:{int(mi)//10*10:02d}"
    c[(kst,p.replace('/api/v1/sessions/ID/',''),st)]+=1
for k,v in sorted(c.items()): print(v,k)
PY
echo "== IP 수 (iOS native)"
grep CFNetwork /tmp/n284.log | awk '{print $1}' | sort | uniq -c | sort -rn | head -12
echo "== features/batch iOS 요청 시각/IP/바이트"
grep CFNetwork /tmp/n284.log | grep features/batch | awk '{print $1,$4,$9,$10}' | head -20
