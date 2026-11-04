cd /opt/mindbreeze/current/backend && set -a && . /etc/mindbreeze/prod.env && set +a
/opt/mindbreeze/venv/bin/python - <<'PY' 2>&1 | cut -c1-400
import os
from sqlalchemy import create_engine, text
e = create_engine(os.environ["DATABASE_URL"])
S = "1a74e4c9-a54e-4454-8505-22840922811c"
with e.connect() as c:
    c.execute(text("set transaction read only"))
    q="""select substr(sp.id::text,1,6) pid, sp.band_connected bc, sp.is_waitlisted wl, sp.eeg_collection_consented eeg,
      (select string_agg(distinct dt.platform||'/'||coalesce(dt.app_version,''),',') from device_tokens dt where dt.user_id=sp.user_id) plat,
      (select count(*) from capture_stream cs where cs.participant_id=sp.id) ncs,
      (select count(*) from eeg_feature_windows w where w.participant_id=sp.id) feat,
      (select count(*) from eeg_raw_chunks r where r.participant_id=sp.id) raw,
      (select string_agg(distinct r.signal_type,',') from eeg_raw_chunks r where r.participant_id=sp.id) sigs,
      (select min(created_at at time zone 'Asia/Seoul') from eeg_raw_chunks r where r.participant_id=sp.id) rmin,
      (select max(created_at at time zone 'Asia/Seoul') from eeg_raw_chunks r where r.participant_id=sp.id) rmax
      from session_participants sp where sp.session_id=:s and sp.user_id is not null
      and exists(select 1 from device_tokens dt where dt.user_id=sp.user_id and dt.platform='ios') order by 1"""
    print("pid bc wl eeg plat ncs feat raw sigs rmin rmax")
    for r in c.execute(text(q),{"s":S}).all(): print(tuple(str(v) for v in r))
    print("== iOS 사용자 capture_stream")
    q="""select substr(sp.id::text,1,6), cs.generation, cs.status, cs.opened_at at time zone 'Asia/Seoul', cs.closed_at at time zone 'Asia/Seoul', cs.final_sequences::text
      from session_participants sp join capture_stream cs on cs.participant_id=sp.id where sp.session_id=:s and sp.user_id is not null
      and exists(select 1 from device_tokens dt where dt.user_id=sp.user_id and dt.platform='ios') order by 1,2"""
    for r in c.execute(text(q),{"s":S}).all(): print(tuple(str(v)[:60] for v in r))
    print("== iOS 사용자 live_command_ledger (actor 기준)")
    q="""select substr(sp.id::text,1,6), l.kind, l.status, l.code, count(*), min(l.created_at at time zone 'Asia/Seoul'), max(l.created_at at time zone 'Asia/Seoul')
      from session_participants sp join live_command_ledger l on l.actor_id=sp.user_id and l.session_id=sp.session_id where sp.session_id=:s and sp.user_id is not null
      and exists(select 1 from device_tokens dt where dt.user_id=sp.user_id and dt.platform='ios') group by 1,2,3,4 order by 1,2"""
    try:
        for r in c.execute(text(q),{"s":S}).all(): print(tuple(str(v) for v in r))
    except Exception as ex: print("ERR",str(ex)[:250])
    print("== 전체 회원 플랫폼별 합계")
    q="""select coalesce((select min(dt.platform) from device_tokens dt where dt.user_id=sp.user_id),'none') p, count(*), sum((band_connected)::int),
      sum(((select count(*) from capture_stream cs where cs.participant_id=sp.id)>0)::int),
      sum(((select count(*) from eeg_feature_windows w where w.participant_id=sp.id)>0)::int),
      sum(((select count(*) from eeg_raw_chunks r where r.participant_id=sp.id)>0)::int)
      from session_participants sp where sp.session_id=:s and sp.user_id is not null group by 1"""
    print("platform n bandconn hasStream hasFeat hasRaw")
    for r in c.execute(text(q),{"s":S}).all(): print(tuple(str(v) for v in r))
PY
