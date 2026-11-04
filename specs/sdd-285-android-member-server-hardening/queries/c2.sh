cd /opt/mindbreeze/current/backend && set -a && . /etc/mindbreeze/prod.env && set +a
/opt/mindbreeze/venv/bin/python - <<'PY' 2>&1 | cut -c1-330
import os
from sqlalchemy import create_engine, text
e = create_engine(os.environ["DATABASE_URL"])
S = "1a74e4c9-a54e-4454-8505-22840922811c"
with e.connect() as c:
    c.execute(text("set transaction read only"))
    print("== 4명+정상1 ledger capture.* (시각 KST, status, code)")
    q="""select substr(sp.id::text,1,6) pid, l.kind, l.status, coalesce(l.code,'-'), (l.created_at at time zone 'Asia/Seoul')::time(0) t
     from session_participants sp join live_command_ledger l on l.session_id=sp.session_id and l.actor_id=sp.user_id
     where sp.session_id=:s and sp.id::text ~ '^(de8312|6a2172|518675|ac1a78)' and l.kind like 'capture.%' order by 1,5"""
    for r in c.execute(text(q),{"s":S}).all(): print(*r)
    print("== 4명 device outbox payload")
    q="""select substr(sp.id::text,1,6) pid, o.event_type, (o.created_at at time zone 'Asia/Seoul')::time(0) t, o.payload::text
     from session_participants sp join live_outbox o on o.session_id=sp.session_id and o.entity_id=sp.id::text and o.domain='device'
     where sp.session_id=:s and sp.id::text ~ '^(de8312|6a2172|518675|ac1a78)' order by 1,3"""
    rows=c.execute(text(q),{"s":S}).all()
    import collections
    cnt=collections.Counter(r[0] for r in rows); print(cnt)
    for r in rows:
        import json;p=json.loads(r[3]);print(r[0],r[1],r[2],p.get('band_state'),p.get('status'),str(p.get('stream_id'))[:8],p.get('generation'),p.get('state_reason'))
        
    print("== 4명 capture_stream 개시/종료")
    q="""select substr(sp.id::text,1,6), cs.generation, cs.status, cs.close_reason, (cs.opened_at at time zone 'Asia/Seoul')::time(0), (cs.closed_at at time zone 'Asia/Seoul')::time(0), cs.lease_expires_at at time zone 'Asia/Seoul'
     from session_participants sp join capture_stream cs on cs.participant_id=sp.id where sp.session_id=:s and sp.id::text ~ '^(de8312|6a2172|518675|ac1a78)'"""
    for r in c.execute(text(q),{"s":S}).all(): print(*r)
    print("== 4명 ledger result(start)")
    q="""select substr(sp.id::text,1,6), l.result::text from session_participants sp join live_command_ledger l on l.session_id=sp.session_id and l.actor_id=sp.user_id where sp.session_id=:s and l.kind='capture.start' and l.status='applied' and sp.id::text ~ '^(de8312|518675)'"""
    for r in c.execute(text(q),{"s":S}).all(): print(*r)
PY
