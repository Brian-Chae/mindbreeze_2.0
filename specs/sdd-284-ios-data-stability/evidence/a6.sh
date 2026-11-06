cd /opt/mindbreeze/current/backend && set -a && . /etc/mindbreeze/prod.env && set +a
/opt/mindbreeze/venv/bin/python - <<'PY' 2>&1 | cut -c1-400
import os
from sqlalchemy import create_engine, text
e = create_engine(os.environ["DATABASE_URL"])
S = "1a74e4c9-a54e-4454-8505-22840922811c"
def run(t,q,p=None):
    print("==",t)
    c=e.connect()
    try:
        c.execute(text("set transaction read only"))
        for r in c.execute(text(q),p or {"s":S}).all(): print("  ",tuple(str(v) for v in r))
    except Exception as ex: print("  ERR",str(ex)[:300])
    finally: c.close()
run("bc8a88 푸시/밴드/스트림","""select substr(sp.id::text,1,6), sp.band_connected, (select string_agg(distinct dt.platform||'/'||coalesce(dt.app_version,''),',') from device_tokens dt where dt.user_id=sp.user_id), (select count(*) from capture_stream cs where cs.participant_id=sp.id), (select count(*) from eeg_feature_windows w where w.participant_id=sp.id), (select count(*) from eeg_raw_chunks r where r.participant_id=sp.id) from session_participants sp where sp.session_id=:s and sp.id::text like 'bc8a88%'""")
run("회원 24: 플랫폼없음 제외, 푸시 플랫폼 + 기록 존재(ledger entry/capture.start)","""select coalesce((select min(dt.platform) from device_tokens dt where dt.user_id=sp.user_id),'none') p,
 (select count(*) from live_command_ledger l where l.actor_id=sp.user_id and l.session_id=sp.session_id and l.kind='capture.start' and l.status='applied')>0 started, count(*) from session_participants sp where sp.session_id=:s and sp.user_id is not null group by 1,2 order by 1,2""")
run("capture.start 적용됐는데 renew 0건 회원","""select substr(sp.id::text,1,6), coalesce((select min(dt.platform) from device_tokens dt where dt.user_id=sp.user_id),'none'),
 (select count(*) from live_command_ledger l where l.actor_id=sp.user_id and l.session_id=sp.session_id and l.kind='capture.renew') renew,
 (select count(*) from eeg_feature_windows w where w.participant_id=sp.id) feat
 from session_participants sp where sp.session_id=:s and sp.user_id is not null and exists(select 1 from live_command_ledger l where l.actor_id=sp.user_id and l.session_id=sp.session_id and l.kind='capture.start' and l.status='applied') order by 2,3""")
run("iOS native(CFNetwork) 로그에 쓰인 세션 (이 회차 소켓)","select 1 where false")
PY
echo "== CFNetwork IP별 요청/경로 (IP→사용자 추정용)"
grep CFNetwork /tmp/n284.log | python3 -c "
import sys,re,collections
c=collections.defaultdict(collections.Counter)
for l in sys.stdin:
    m=re.match(r'(\S+) .*?\[(\d+/\w+/\d+):(\d\d):(\d\d):(\d\d).*?\"(\w+) (\S+) HTTP[^\"]*\" (\d+)',l)
    if not m: continue
    ip=m.group(1);h=int(m.group(3));p=re.sub(r'[0-9a-f]{8}-[0-9a-f-]{27}','ID',m.group(7)).split('?')[0].replace('/api/v1/sessions/ID/','')
    c[ip][p]+=1
for ip,v in c.items(): print(ip[:6]+'…',dict(v))
"
