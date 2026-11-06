cd /opt/mindbreeze/current/backend && set -a && . /etc/mindbreeze/prod.env && set +a
/opt/mindbreeze/venv/bin/python - <<'PY' 2>&1 | cut -c1-300
import os
from sqlalchemy import create_engine, text
e = create_engine(os.environ["DATABASE_URL"])
S = "1a74e4c9-a54e-4454-8505-22840922811c"
with e.connect() as c:
    c.execute(text("set transaction read only"))
    q="""select substr(sp.id::text,1,6) pid, sp.eeg_collection_consented eeg_c, sp.consent_audio aud, sp.band_connected band, sp.is_waitlisted wl,
      (select string_agg(distinct dt.platform||'/'||coalesce(dt.app_version,'-'),',') from device_tokens dt where dt.user_id=sp.user_id) plat,
      (select count(*) from capture_stream cs where cs.participant_id=sp.id) ncs,
      (select count(*) from live_command_ledger l where l.session_id=sp.session_id and l.actor_id=sp.user_id and l.kind='capture.start' and l.status='applied') st_ok,
      (select count(*) from live_command_ledger l where l.session_id=sp.session_id and l.actor_id=sp.user_id and l.kind='capture.start' and l.status='rejected') st_rej,
      (select count(*) from live_command_ledger l where l.session_id=sp.session_id and l.actor_id=sp.user_id and l.kind='capture.renew') renew,
      (select count(*) from live_command_ledger l where l.session_id=sp.session_id and l.actor_id=sp.user_id and l.kind='capture.reanchor') rean,
      (select count(*) from eeg_feature_windows w where w.participant_id=sp.id) feat,
      (select feature from session_ingest_expected x where x.participant_id=sp.id) exp_feat,
      (select count(*) from eeg_raw_chunks r where r.participant_id=sp.id) raw,
      (select count(*) from refresh_tokens rt where rt.user_id=sp.user_id and rt.issued_at>='2026-11-04 00:00+09') logins
      from session_participants sp where sp.session_id=:s and sp.user_id is not null order by feat desc, raw desc"""
    rows=c.execute(text(q),{"s":S}).all()
    print("pid eeg_c aud band wl plat ncs st_ok st_rej renew rean feat exp raw logins")
    for r in rows: print(*r)
PY
