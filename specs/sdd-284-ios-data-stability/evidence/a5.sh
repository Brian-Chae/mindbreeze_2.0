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
run("11:20~11:30 KST(UTC 02:20~02:30) feature 행 생성 참가자","""select substr(participant_id::text,1,6), count(*), min(created_at at time zone 'Asia/Seoul'), max(created_at at time zone 'Asia/Seoul') from eeg_feature_windows where session_id=:s and created_at between '2026-11-04 02:20' and '2026-11-04 02:35' group by 1""")
run("11:25 이후 live_outbox 이벤트 종류","""select domain,event_type,count(*) from live_outbox where session_id=:s and created_at between '2026-11-04 02:20' and '2026-11-04 02:35' group by 1,2 order by 3 desc limit 12""")
run("94234b renew/close/reanchor 시각(KST)","""select l.kind, l.status, l.code, to_char(l.created_at at time zone 'Asia/Seoul','HH24:MI:SS') from live_command_ledger l join session_participants sp on sp.user_id=l.actor_id and sp.session_id=l.session_id where sp.session_id=:s and sp.id::text like '94234b%' and l.kind like 'capture.%' order by l.created_at""")
run("94234b 가 아닌 iOS 푸시 59a1ea/bc2d99 stream, 밴드/동의","""select substr(id::text,1,6), band_connected, eeg_collection_consented, to_char(joined_at at time zone 'Asia/Seoul','HH24:MI') from session_participants where session_id=:s and (id::text like '59a1ea%' or id::text like 'bc2d99%' or id::text like '94234b%')""")
run("iOS 3명 biosignal_streams","""select substr(sp.id::text,1,6), b.signal, count(*) from biosignal_streams b join session_participants sp on sp.id=b.participant_id where sp.session_id=:s and exists(select 1 from device_tokens dt where dt.user_id=sp.user_id and dt.platform='ios') group by 1,2 order by 1,2""")
run("raw_chunks 비회원 포함 전체 중 stream_id like raw- (v1 legacy) 참가자수","""select count(distinct participant_id), count(*) from eeg_raw_chunks where session_id=:s and stream_id::text like 'raw-%'""")
run("v1 legacy raw 참가자 중 회원/비회원, capture_stream 유무","""select (sp.user_id is not null), (select count(*) from capture_stream cs where cs.participant_id=sp.id)>0, count(distinct sp.id) from eeg_raw_chunks r join session_participants sp on sp.id=r.participant_id where r.session_id=:s and r.stream_id::text like 'raw-%' group by 1,2""")
PY
