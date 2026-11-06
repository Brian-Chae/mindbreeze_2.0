cd /opt/mindbreeze/current/backend && set -a && . /etc/mindbreeze/prod.env && set +a
/opt/mindbreeze/venv/bin/python - <<'PY' 2>&1 | cut -c1-300
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
run("feature 보유 참가자(회원/비회원) 수","""select (sp.user_id is not null) member, count(distinct sp.id), sum((select count(*) from eeg_feature_windows w where w.participant_id=sp.id)) from session_participants sp where sp.session_id=:s and exists(select 1 from eeg_feature_windows w where w.participant_id=sp.id) group by 1""")
run("비회원 capture_stream 보유자: feature/raw(v2) 수","""select substr(sp.id::text,1,6), sp.band_connected, (select count(*) from capture_stream cs where cs.participant_id=sp.id), (select count(*) from eeg_feature_windows w where w.participant_id=sp.id), (select count(*) from eeg_raw_chunks r where r.participant_id=sp.id and r.stream_id::text not like 'raw-%'), (select count(*) from eeg_raw_chunks r where r.participant_id=sp.id and r.stream_id::text like 'raw-%') from session_participants sp where sp.session_id=:s and sp.user_id is null and exists(select 1 from capture_stream cs where cs.participant_id=sp.id) order by 1""")
run("iOS 앱 version/ build device_tokens","""select dt.platform, dt.app_version, count(*) from device_tokens dt where dt.revoked_at is null group by 1,2""")
PY
echo "== iOS WebView(Mozilla..Mobile/15E148 no Safari) socket.io 101 / IP수 (앱 WebView 사용자 수 근사)"
grep 'Mobile/15E148"' /tmp/n284.log | grep -v Safari | grep socket.io | awk '{print $1}' | sort -u | wc -l
echo "== iOS WebView biosignal-raw/eeg-raw 200 ack IP수"
grep 'Mobile/15E148"' /tmp/n284.log | grep -v Safari | grep -E "eeg-raw/ack|biosignal-raw/ack" | grep '" 200' | awk '{print $1}' | sort | uniq -c | sort -rn | head -12
