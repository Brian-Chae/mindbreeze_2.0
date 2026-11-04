cd /opt/mindbreeze/current/backend && set -a && . /etc/mindbreeze/prod.env && set +a
/opt/mindbreeze/venv/bin/python - <<'PY' 2>&1 | cut -c1-300
import os
from sqlalchemy import create_engine, text
e = create_engine(os.environ["DATABASE_URL"])
S = "1a74e4c9-a54e-4454-8505-22840922811c"
with e.connect() as c:
    c.execute(text("set transaction read only"))
    print("== 분석행 시간범위/원시청크 시간범위(KST) 부분실패·정상")
    q="""select substr(sp.id::text,1,6) pid,
     (select min(w.created_at at time zone 'Asia/Seoul')::time(0) from eeg_feature_windows w where w.participant_id=sp.id) f_min,
     (select max(w.created_at at time zone 'Asia/Seoul')::time(0) from eeg_feature_windows w where w.participant_id=sp.id) f_max,
     (select min(r.created_at at time zone 'Asia/Seoul')::time(0) from eeg_raw_chunks r where r.participant_id=sp.id) r_min,
     (select max(r.created_at at time zone 'Asia/Seoul')::time(0) from eeg_raw_chunks r where r.participant_id=sp.id) r_max,
     (select max(l.created_at at time zone 'Asia/Seoul')::time(0) from live_command_ledger l where l.session_id=sp.session_id and l.actor_id=sp.user_id and l.kind='capture.renew') renew_max,
     (select max(l.created_at at time zone 'Asia/Seoul')::time(0) from live_command_ledger l where l.session_id=sp.session_id and l.actor_id=sp.user_id and l.kind='capture.start' and l.status='applied') start_max,
     (select count(*) from live_command_ledger l where l.session_id=sp.session_id and l.actor_id=sp.user_id and l.status='rejected') rej,
     (select string_agg(distinct l.code,',') from live_command_ledger l where l.session_id=sp.session_id and l.actor_id=sp.user_id and l.status='rejected') rej_codes,
     (select count(*) from live_outbox o where o.session_id=sp.session_id and o.entity_id=sp.id::text and o.domain='device') dev_evt,
     (select count(*) from eeg_raw_chunks r where r.participant_id=sp.id and r.signal_type='eeg') raw_eeg
     from session_participants sp where sp.session_id=:s and sp.user_id is not null and sp.id::text ~ '^(6ecab3|bc8a88|94234b|879091|b5eed5|14b252|de8312|6a2172|518675|ac1a78)' order by 1"""
    for r in c.execute(text(q),{"s":S}).all(): print(*r)
    print("== 정상 6명 최초 device 이벤트 시각 vs capture.start 시각")
    q="""select substr(sp.id::text,1,6), (select min(o.created_at at time zone 'Asia/Seoul')::time(0) from live_outbox o where o.entity_id=sp.id::text and o.domain='device' and o.payload->>'band_state' is not null),
     (select min(l.created_at at time zone 'Asia/Seoul')::time(0) from live_command_ledger l where l.actor_id=sp.user_id and l.session_id=sp.session_id and l.kind='capture.start' and l.status='applied')
     from session_participants sp where sp.session_id=:s and sp.user_id is not null and sp.id::text ~ '^(14b252|c364c0|f36261|352d27|df551b|b5eed5)'"""
    for r in c.execute(text(q),{"s":S}).all(): print(*r)
    print("== 정상 6: 첫 분석행 시각 vs 첫 start")
PY
