L="cat /var/log/nginx/access.log /var/log/nginx/access.log.1"
$L 2>/dev/null | grep "04/Nov/2026:0[1-2]:" > /tmp/n284.log; wc -l /tmp/n284.log
echo "== UA 분류 x 경로 x 상태 (iOS: iPhone WebView / CFNetwork 네이티브)"
python3 - <<'PY'
import re,collections
c=collections.Counter()
for l in open('/tmp/n284.log'):
    m=re.search(r'"(?:GET|POST|PUT|PATCH|DELETE) (\S+) HTTP/[\d.]+" (\d+) \d+ "[^"]*" "([^"]*)"',l)
    if not m: continue
    p,st,ua=m.groups()
    if 'iPhone' in ua and 'CFNetwork' not in ua: k='iOS-WebView'
    elif 'CFNetwork' in ua: k='iOS-Native(CFNetwork)'
    elif 'okhttp' in ua: k='Android-native'
    elif 'Android' in ua: k='Android-Web'
    else: continue
    p=re.sub(r'[0-9a-f]{8}-[0-9a-f-]{27}','ID',p).split('?')[0]
    if any(x in p for x in ('features/batch','eeg-raw','ingest-expected','upload','socket.io','auth/','raw/')):
        c[(k,p,st)]+=1
for k,v in sorted(c.items()): print(v,k)
PY
echo "== iOS UA 샘플(고유)"
grep -o '"Mozilla[^"]*iPhone[^"]*"\|"[^"]*CFNetwork[^"]*"' /tmp/n284.log | sort | uniq -c | sort -rn | head -6
