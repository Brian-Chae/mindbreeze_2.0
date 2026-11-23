import os, sqlalchemy as sa
e=sa.create_engine(os.environ["DATABASE_URL"].replace("+asyncpg",""))
SIDS={"body":"caca439c-bee5-49b4-9413-b405f07e5f16","mind":"a7f4ce51-002c-4de0-b7c6-be744b6cba66"}
with e.connect() as c:
    c.execute(sa.text("SET TRANSACTION READ ONLY"))
    for nm,sid in SIDS.items():
        print("##",nm)
        q="""select row_number() over (order by p.entered_at) n,
          (select count(*) from capture_stream s where s.participant_id=p.id) caps,
          (select string_agg(distinct parser_profile_id,',') from eeg_raw_chunks r where r.participant_id=p.id) profs,
          (select count(*) from eeg_feature_windows f where f.participant_id=p.id) feats,
          (select count(*) from eeg_raw_chunks r where r.participant_id=p.id and r.signal_type='eeg') eegc,
          (select to_char(min(opened_at at time zone 'Asia/Seoul'),'HH24:MI:SS')||'~'||coalesce(to_char(max(closed_at at time zone 'Asia/Seoul'),'HH24:MI:SS'),'open')||' '||string_agg(coalesce(close_reason,'-'),'|') from capture_stream s where s.participant_id=p.id) cap
          from session_participants p where p.session_id=:s and p.entered_at is not null order by p.entered_at"""
        for r in c.execute(sa.text(q),{"s":sid}).all():
            if r[1]!=1 or r[4]>0 and r[3]<100 or (r[2] and 'web' in r[2]): print(tuple(str(x) for x in r))
        print("caps>1 summary", c.execute(sa.text("select count(*) filter (where n>1), count(*) from (select participant_id,count(*) n from capture_stream where session_id=:s group by 1) t"),{"s":sid}).first())
