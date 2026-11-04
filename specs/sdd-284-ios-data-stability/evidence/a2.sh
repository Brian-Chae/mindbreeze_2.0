ls /var/log/nginx/ | head; 
cd /opt/mindbreeze/current/backend && set -a && . /etc/mindbreeze/prod.env && set +a
/opt/mindbreeze/venv/bin/python - <<'PY' 2>&1 | cut -c1-500
import os
from sqlalchemy import create_engine, text
e = create_engine(os.environ["DATABASE_URL"])
S = "1a74e4c9-a54e-4454-8505-22840922811c"
with e.connect() as c:
    c.execute(text("set transaction read only"))
    print("== 94234b 원시 청크 요약 (stream/signal)")
    q="""select left(r.stream_id::text,8) st, r.signal_type, count(*), min(r.chunk_index), max(r.chunk_index), count(distinct r.chunk_index), min(r.created_at at time zone 'Asia/Seoul'), max(r.created_at at time zone 'Asia/Seoul'), sum(case when r.verified_at is not null then 1 else 0 end), min(r.play_group_id::text) is null
      from eeg_raw_chunks r where r.participant_id::text like '94234b%' group by 1,2 order by 1,2"""
    for r in c.execute(text(q)).all(): print(tuple(str(v) for v in r))
    print("== 94234b biosignal_artifacts kinds")
    q="""select a.kind, a.signal, count(*), min(a.created_at at time zone 'Asia/Seoul'), max(a.created_at at time zone 'Asia/Seoul') from biosignal_artifacts a join biosignal_streams b on a.stream_id=b.id where b.participant_id::text like '94234b%' group by 1,2"""
    try:
        for r in c.execute(text(q)).all(): print(tuple(str(v) for v in r))
    except Exception as ex: print("ERR",str(ex)[:300])
    print("== 94234b 시간대별 원시 청크 분포(분)")
    q="""select to_char(date_trunc('hour', r.created_at at time zone 'Asia/Seoul'),'HH24')||':'||(extract(minute from r.created_at at time zone 'Asia/Seoul')::int/10*10)::text, count(*) from eeg_raw_chunks r where r.participant_id::text like '94234b%' group by 1 order by 1"""
    for r in c.execute(text(q)).all(): print(tuple(str(v) for v in r))
PY
